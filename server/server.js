import Fastify from 'fastify';
import fastifyIO from "fastify-socket.io";
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { randomUUID, createHmac } from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

function signSession(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(cookie) {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const ATLASSIAN_CLIENT_ID = process.env.ATLASSIAN_CLIENT_ID;
const ATLASSIAN_CLIENT_SECRET = process.env.ATLASSIAN_CLIENT_SECRET;
const ATLASSIAN_REDIRECT_URI = process.env.ATLASSIAN_REDIRECT_URI || 'http://localhost:3218/auth/callback';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const JIRA_SITE_URL = process.env.JIRA_SITE_URL; // e.g. "palmetto.atlassian.net"

const fastify = Fastify({
  logger: true
}).register(fastifyIO, {
  serveClient: false,
  cors: {
    origin: ALLOWED_ORIGIN,
    credentials: true,
  }
}).register(cors, {
  origin: ALLOWED_ORIGIN,
  credentials: true,
}).register(cookie);

function getSession(req) {
  return verifySession(req.cookies?.session);
}

// Resolve a post-login redirect from the OAuth `state` param. Only relative
// in-app paths are honored, to avoid open-redirect to external URLs.
function resolveReturnUrl(state) {
  try {
    const { returnTo } = JSON.parse(Buffer.from(state, 'base64url').toString());
    if (typeof returnTo === 'string' && returnTo) {
      const clean = returnTo.replace(/^\/+/, '');
      if (clean && !clean.startsWith('/') && !clean.includes('://')) {
        return `${APP_URL}/${clean}`;
      }
    }
  } catch {
    // fall through to default
  }
  return APP_URL;
}

// --- Auth routes ---

fastify.get('/auth/login', async (req, reply) => {
  // Carry the desired return path through OAuth via the `state` param, which
  // Atlassian round-trips back to the callback unchanged.
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '';
  const state = Buffer.from(JSON.stringify({ nonce: randomUUID(), returnTo })).toString('base64url');
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: ATLASSIAN_CLIENT_ID,
    scope: 'read:me read:jira-work offline_access',
    redirect_uri: ATLASSIAN_REDIRECT_URI,
    state,
    response_type: 'code',
    prompt: 'consent',
  });
  return reply.redirect(`https://auth.atlassian.com/authorize?${params}`);
});

fastify.get('/auth/callback', async (req, reply) => {
  const { code, error, state } = req.query;

  if (error || !code) {
    return reply.redirect(`${APP_URL}?auth_error=1`);
  }

  // Exchange code for token
  const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: ATLASSIAN_CLIENT_ID,
      client_secret: ATLASSIAN_CLIENT_SECRET,
      code,
      redirect_uri: ATLASSIAN_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    fastify.log.error('Token exchange failed: ' + await tokenRes.text());
    return reply.redirect(`${APP_URL}?auth_error=1`);
  }

  const { access_token } = await tokenRes.json();

  // Get user identity
  const meRes = await fetch('https://api.atlassian.com/me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const me = await meRes.json();

  // Get accessible Jira sites
  const sitesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const sites = await sitesRes.json();

  // Pick the team's configured site, not just the first one the user happens to have.
  const want = JIRA_SITE_URL?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const site = want
    ? sites?.find((s) => s.url.replace(/^https?:\/\//, '').replace(/\/$/, '') === want)
    : sites?.[0];

  if (!site) {
    // The user authenticated fine but can't reach the team's Jira instance.
    fastify.log.warn(`User ${me.email} has no access to ${want ?? 'any Jira site'}`);
    return reply.redirect(`${APP_URL}?auth_error=no_jira_access`);
  }
  const cloudId = site.id;

  const sessionCookie = signSession({
    token: access_token,
    cloudId,
    user: {
      accountId: me.account_id,
      name: me.name,
      email: me.email,
      picture: me.picture,
    },
  });

  return reply
    .setCookie('session', sessionCookie, {
      path: '/',
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 60 * 60 * 8, // 8 hours
    })
    .redirect(resolveReturnUrl(state));
});

fastify.get('/auth/me', async (req, reply) => {
  const session = getSession(req);
  if (!session) return reply.code(401).send({ error: 'Unauthenticated' });
  return reply.send(session.user);
});

fastify.post('/auth/logout', async (req, reply) => {
  return reply.clearCookie('session', { path: '/' }).send({ ok: true });
});

// --- Room & voting state ---

// Keep a user's presence and vote alive this long after their socket drops, so
// a reconnect (e.g. Cloud Run's ~5min request timeout) restores them seamlessly.
const RECONNECT_GRACE_MS = 10_000;

const userData = {};      // room -> userId -> { name, picture }
const roomState = {};     // room -> { phase, votes: { userId: value }, issue }
const liveSockets = {};   // room -> userId -> Set<socketId>
const removalTimers = {}; // room -> userId -> Timeout

function getRoom(room) {
  if (!roomState[room]) {
    roomState[room] = { phase: 'voting', votes: {}, issue: null };
  }
  return roomState[room];
}

// Stable identity for a connection: the authenticated Atlassian accountId, which
// survives reconnects (socket.id does not). Falls back to socket.id if unauthenticated.
function userIdFromSocket(socket) {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const sessionCookie = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  const session = verifySession(sessionCookie ? decodeURIComponent(sessionCookie) : null);
  return session?.user?.accountId || socket.id;
}

function trackSocket(room, userId, socketId) {
  liveSockets[room] = liveSockets[room] || {};
  liveSockets[room][userId] = liveSockets[room][userId] || new Set();
  liveSockets[room][userId].add(socketId);
  // A connection arrived — cancel any pending removal from a recent drop.
  if (removalTimers[room]?.[userId]) {
    clearTimeout(removalTimers[room][userId]);
    delete removalTimers[room][userId];
  }
}

// Drop a socket for a user. The user is only removed once they have no live
// sockets left: immediately on an intentional leave, or after a grace window on
// a disconnect (so reconnects keep their vote).
function untrackSocket(room, userId, socketId, { immediate } = {}) {
  const set = liveSockets[room]?.[userId];
  if (!set) return;
  set.delete(socketId);
  if (set.size > 0) return; // still connected elsewhere (e.g. another tab)

  const remove = () => {
    if (liveSockets[room]?.[userId]?.size > 0) return; // reconnected during grace
    delete liveSockets[room]?.[userId];
    delete userData[room]?.[userId];
    delete getRoom(room).votes[userId];
    if (removalTimers[room]) delete removalTimers[room][userId];
    fastify.io.to(room).emit("roomUpdate", userData[room] || {});
    fastify.io.to(room).emit("roomState", getRoom(room));
  };

  if (immediate) {
    remove();
  } else {
    removalTimers[room] = removalTimers[room] || {};
    removalTimers[room][userId] = setTimeout(remove, RECONNECT_GRACE_MS);
  }
}

fastify.ready().then(() => {
  fastify.io.on("connection", (socket) => {
    socket.data.userId = userIdFromSocket(socket);
    console.info('Socket connected', socket.id, 'user', socket.data.userId);

    socket.on("message", (message) => {
      console.info('Socket message:', message);
    });

    socket.on("disconnect", (reason) => {
      console.info('Socket disconnect', reason);
    });

    socket.on("disconnecting", (reason) => {
      console.info('Socket disconnecting', reason);

      for (const room of socket.rooms) {
        if (room !== socket.id) {
          // Keep the user's vote/presence through the grace window in case this
          // is a transient drop and they reconnect.
          untrackSocket(room, socket.data.userId, socket.id);
        }
      }
    });

    socket.on("joinRoom", (room, username, picture) => {
      console.info(`user ${username} wants room: ${room}`);
      const userId = socket.data.userId;
      socket.join(room);
      trackSocket(room, userId, socket.id);

      userData[room] = userData[room] || {};
      userData[room][userId] = { name: username, picture: picture || null };
      fastify.io.to(socket.id).emit("roomUpdate", userData[room]);
      socket.to(room).emit("roomUpdate", userData[room]);

      const state = getRoom(room);
      // Preserve an existing vote across reconnects; only initialize on first join.
      if (!(userId in state.votes)) state.votes[userId] = null;
      fastify.io.to(socket.id).emit("roomState", state);
      socket.to(room).emit("roomState", state);

      console.log(`${Object.keys(userData[room]).length} users in ${room}`);
    });

    socket.on("leaveRoom", (room) => {
      console.info('socket leaving room:', room);
      socket.leave(room);
      // Intentional leave — remove now (unless the user still has another tab open).
      untrackSocket(room, socket.data.userId, socket.id, { immediate: true });

      console.log(`${Object.keys(userData[room] || {}).length} users in ${room}`);
    });

    socket.on("updateUser", (room, data) => {
      console.info('updateUser', room, data);
      const userId = socket.data.userId;
      userData[room] = userData[room] || {};
      userData[room][userId] = {
        ...userData[room][userId],
        ...data,
      };
      fastify.io.to(socket.id).emit("roomUpdate", userData[room]);
      socket.to(room).emit("roomUpdate", userData[room]);
    });

    socket.on("castVote", (room, value) => {
      const state = getRoom(room);
      state.votes[socket.data.userId] = value;
      fastify.io.to(room).emit("roomState", state);
    });

    socket.on("revealVotes", (room) => {
      const state = getRoom(room);
      state.phase = 'revealed';
      fastify.io.to(room).emit("roomState", state);
    });

    socket.on("resetVotes", (room) => {
      const state = getRoom(room);
      state.phase = 'voting';
      Object.keys(state.votes).forEach(id => {
        state.votes[id] = null;
      });
      fastify.io.to(room).emit("roomState", state);
    });

    socket.on("loadIssue", async (room, input) => {
      // Accept bare key (PROJ-123) or full Jira URL
      const key = input.match(/([A-Z][A-Z0-9_]+-\d+)/)?.[1];
      if (!key) {
        socket.emit("issueError", "Invalid issue key or URL");
        return;
      }

      const cookieHeader = socket.handshake.headers.cookie || '';
      const sessionCookie = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
      const session = verifySession(sessionCookie ? decodeURIComponent(sessionCookie) : null);
      if (!session) {
        socket.emit("issueError", "Not authenticated");
        return;
      }

      const { token, cloudId } = session;
      const res = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${key}?fields=summary,description`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
      );

      if (!res.ok) {
        socket.emit("issueError", `Could not load ${key}`);
        return;
      }

      const data = await res.json();
      const issue = {
        key: data.key,
        summary: data.fields.summary,
        description: data.fields.description ?? null,
      };

      const state = getRoom(room);
      state.issue = issue;
      fastify.io.to(room).emit("roomState", state);
    });
  });
});

try {
  await fastify.listen({ port: process.env.PORT || 3218, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
