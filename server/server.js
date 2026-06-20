import Fastify from 'fastify';
import fastifyIO from "fastify-socket.io";
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { randomUUID, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

// The session cookie now carries a long-lived refresh token, so encrypt it
// (AES-256-GCM, authenticated) rather than merely signing it. The key is
// derived once from SESSION_SECRET at startup.
const SESSION_KEY = scryptSync(SESSION_SECRET, 'plan95-session', 32);

// Persistent login: cookie lives 30 days, well beyond the ~1h access token,
// which we silently refresh using the stored refresh token.
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // seconds
const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh a minute before expiry

// `SameSite=None` requires `Secure`, which browsers won't set/send over plain
// http://localhost. In dev fall back to lax+insecure so the session cookie works
// over HTTP; in production keep the cross-site-safe none+secure pair.
const IS_PROD = process.env.NODE_ENV === 'production';

const sessionCookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: IS_PROD ? 'none' : 'lax',
  secure: IS_PROD,
  maxAge: SESSION_MAX_AGE,
};

function sealSession(data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString('base64url')).join('.');
}

function openSession(cookie) {
  if (!cookie) return null;
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', SESSION_KEY, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    return null;
  }
}

// The session spans two encrypted cookies because the Atlassian access and
// refresh tokens together exceed the ~4096-byte per-cookie limit:
//   session_at -> { token, expiresAt }                  (the access token)
//   session    -> { refreshToken, cloudId, sites, user } (refresh token + identity)
const ACCESS_COOKIE = 'session_at';
const CONTEXT_COOKIE = 'session';

function writeSession(reply, session) {
  const { token, expiresAt, refreshToken, cloudId, sites, user } = session;
  reply.setCookie(ACCESS_COOKIE, sealSession({ token, expiresAt }), sessionCookieOptions);
  reply.setCookie(CONTEXT_COOKIE, sealSession({ refreshToken, cloudId, sites, user }), sessionCookieOptions);
}

// Reassemble the session from both cookies. Returns null when the context cookie
// (refresh token + identity) is missing; a missing/expired access cookie is fine,
// since ensureFreshToken will mint a new access token from the refresh token.
function readSession(req) {
  const context = openSession(req.cookies?.[CONTEXT_COOKIE]);
  if (!context) return null;
  const access = openSession(req.cookies?.[ACCESS_COOKIE]) ?? {};
  return { ...context, token: access.token, expiresAt: access.expiresAt };
}

function clearSession(reply) {
  reply.clearCookie(ACCESS_COOKIE, { path: '/' });
  reply.clearCookie(CONTEXT_COOKIE, { path: '/' });
}

// Return a session whose access token is valid, refreshing it via the stored
// refresh token if it has (nearly) expired. Returns { session, changed } so the
// caller can re-set the cookie when the token (and rotated refresh token) moved,
// or null when the refresh token is no longer valid (full re-login required).
async function ensureFreshToken(session) {
  if (session.expiresAt && Date.now() < session.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return { session, changed: false };
  }
  if (!session.refreshToken) return null;

  const res = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: ATLASSIAN_CLIENT_ID,
      client_secret: ATLASSIAN_CLIENT_SECRET,
      refresh_token: session.refreshToken,
    }),
  });

  if (!res.ok) {
    fastify.log.warn('Token refresh failed: ' + await res.text());
    return null;
  }

  const data = await res.json();
  const next = {
    ...session,
    token: data.access_token,
    // Atlassian rotates refresh tokens; fall back to the prior one if omitted.
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return { session: next, changed: true };
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const ATLASSIAN_CLIENT_ID = process.env.ATLASSIAN_CLIENT_ID;
const ATLASSIAN_CLIENT_SECRET = process.env.ATLASSIAN_CLIENT_SECRET;
const ATLASSIAN_REDIRECT_URI = process.env.ATLASSIAN_REDIRECT_URI || 'http://localhost:3218/auth/callback';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

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

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

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

  // A distributed app serves whatever sites the user can reach. Keep them all and
  // default the active one to the first; the user can switch via POST /auth/site.
  const availableSites = (Array.isArray(sites) ? sites : []).map((s) => ({
    id: s.id,
    url: s.url,
    name: s.name,
  }));

  if (availableSites.length === 0) {
    // The user authenticated fine but can't reach any Jira instance.
    fastify.log.warn(`User ${me.email} has access to no Jira sites`);
    return reply.redirect(`${APP_URL}?auth_error=no_jira_access`);
  }

  writeSession(reply, {
    token: access_token,
    refreshToken: refresh_token,
    expiresAt: Date.now() + (expires_in ?? 3600) * 1000,
    cloudId: availableSites[0].id,
    sites: availableSites,
    user: {
      accountId: me.account_id,
      name: me.name,
      email: me.email,
      picture: me.picture,
    },
  });

  return reply.redirect(resolveReturnUrl(state));
});

fastify.get('/auth/me', async (req, reply) => {
  const session = readSession(req);
  if (!session) return reply.code(401).send({ error: 'Unauthenticated' });

  const fresh = await ensureFreshToken(session);
  if (!fresh) {
    clearSession(reply);
    return reply.code(401).send({ error: 'Session expired' });
  }
  if (fresh.changed) writeSession(reply, fresh.session);
  return reply.send({
    ...fresh.session.user,
    sites: fresh.session.sites ?? [],
    cloudId: fresh.session.cloudId,
  });
});

// Switch the active Jira site for this user's session.
fastify.post('/auth/site', async (req, reply) => {
  const session = readSession(req);
  if (!session) return reply.code(401).send({ error: 'Unauthenticated' });

  const { cloudId } = req.body ?? {};
  const site = session.sites?.find((s) => s.id === cloudId);
  if (!site) return reply.code(400).send({ error: 'Unknown site' });

  session.cloudId = cloudId;
  writeSession(reply, session);
  return reply.send({ cloudId });
});

fastify.post('/auth/logout', async (req, reply) => {
  clearSession(reply);
  return reply.send({ ok: true });
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

// Load a Jira issue into a room. This lives on HTTP (not the websocket) so it can
// refresh the access token and re-set the session cookie on its way through; the
// resulting issue is broadcast to the room over socket.io like any other update.
fastify.post('/issue', async (req, reply) => {
  const session = readSession(req);
  if (!session) return reply.code(401).send({ error: 'Unauthenticated' });

  const fresh = await ensureFreshToken(session);
  if (!fresh) {
    clearSession(reply);
    return reply.code(401).send({ error: 'Session expired' });
  }
  if (fresh.changed) writeSession(reply, fresh.session);

  const { room, input } = req.body ?? {};
  // Accept bare key (PROJ-123) or full Jira URL
  const key = typeof input === 'string' ? input.match(/([A-Z][A-Z0-9_]+-\d+)/)?.[1] : null;
  if (!key) return reply.code(400).send({ error: 'Invalid issue key or URL' });

  const { token, cloudId } = fresh.session;
  const res = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${key}?fields=summary,description`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  );
  if (!res.ok) return reply.code(502).send({ error: `Could not load ${key}` });

  const data = await res.json();
  const issue = {
    key: data.key,
    summary: data.fields.summary,
    description: data.fields.description ?? null,
  };

  const state = getRoom(room);
  state.issue = issue;
  fastify.io.to(room).emit('roomState', state);
  return reply.send({ ok: true });
});

// Stable identity for a connection: the authenticated Atlassian accountId, which
// survives reconnects (socket.id does not). Falls back to socket.id if unauthenticated.
function userIdFromSocket(socket) {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const sessionCookie = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  const session = openSession(sessionCookie ? decodeURIComponent(sessionCookie) : null);
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
  });
});

try {
  await fastify.listen({ port: process.env.PORT || 3218, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
