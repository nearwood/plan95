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

// --- Auth routes ---

fastify.get('/auth/login', async (req, reply) => {
  const state = randomUUID();
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
  const { code, error } = req.query;

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
  const cloudId = sites?.[0]?.id || null;

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
    .redirect(APP_URL);
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

const userData = {};
const roomState = {};

function getRoom(room) {
  if (!roomState[room]) {
    roomState[room] = { phase: 'voting', votes: {}, issue: null };
  }
  return roomState[room];
}

fastify.ready().then(() => {
  fastify.io.on("connection", (socket) => {
    console.info('Socket connected', socket.id);

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
          userData[room] = userData[room] || {};
          delete userData[room][socket.id];
          socket.to(room).emit("roomUpdate", userData[room]);

          const state = getRoom(room);
          delete state.votes[socket.id];
          socket.to(room).emit("roomState", state);
        }
      }
    });

    socket.on("joinRoom", (room, username, picture) => {
      console.info(`user ${username} wants room: ${room}`);
      socket.join(room);

      userData[room] = userData[room] || {};
      userData[room][socket.id] = { name: username, picture: picture || null };
      fastify.io.to(socket.id).emit("roomUpdate", userData[room]);
      socket.to(room).emit("roomUpdate", userData[room]);

      const state = getRoom(room);
      state.votes[socket.id] = null;
      fastify.io.to(socket.id).emit("roomState", state);
      socket.to(room).emit("roomState", state);

      console.log(`${Object.keys(userData[room]).length} users in ${room}`);
    });

    socket.on("leaveRoom", (room) => {
      console.info('socket leaving room:', room);
      socket.leave(room);

      userData[room] = userData[room] || {};
      delete userData[room][socket.id];
      socket.to(room).emit("roomUpdate", userData[room]);

      const state = getRoom(room);
      delete state.votes[socket.id];
      socket.to(room).emit("roomState", state);

      console.log(`${Object.keys(userData[room]).length} users in ${room}`);
    });

    socket.on("updateUser", (room, data) => {
      console.info('updateUser', room, data);
      userData[room] = userData[room] || {};
      userData[room][socket.id] = {
        ...userData[room][socket.id],
        ...data,
      };
      fastify.io.to(socket.id).emit("roomUpdate", userData[room]);
      socket.to(room).emit("roomUpdate", userData[room]);
    });

    socket.on("castVote", (room, value) => {
      const state = getRoom(room);
      state.votes[socket.id] = value;
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
