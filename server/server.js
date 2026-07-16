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
    scope: 'read:me read:jira-work write:jira-work offline_access',
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

const userData = {};      // nsRoom -> userId -> { name, picture }
const roomState = {};     // nsRoom -> { phase, votes: { userId: value }, issue }
const liveSockets = {};   // nsRoom -> userId -> Set<socketId>
const removalTimers = {}; // nsRoom -> userId -> Timeout

// Rooms are partitioned per Atlassian site (cloudId): the same room name in two
// different instances maps to distinct server-side state and broadcast channels,
// so a stale/guessed URL can never leak one tenant's issues or votes to another.
// A null byte can't appear in a cloudId (UUID) or a generated room name, so it's
// a safe separator for round-tripping the raw name back out (rawRoom).
const ROOM_SEP = '\u0000';
const roomKey = (cloudId, room) => `${cloudId}${ROOM_SEP}${room}`;
const rawRoom = (nsRoom) => nsRoom.slice(nsRoom.indexOf(ROOM_SEP) + 1);

// The cloudId that first opened a given room name. Joins from a different instance
// are refused (see joinRoom / POST /issue), giving a single, explicit owner per
// name on top of the physical partition above. Released when the room empties.
const roomOwners = {}; // room name -> cloudId

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
  // This route has no socket join to gate it, so enforce room ownership here too:
  // a user can only load issues into a room their own instance owns. Otherwise an
  // issue from one tenant could be broadcast into another tenant's room.
  if (roomOwners[room] && roomOwners[room] !== cloudId) {
    return reply.code(403).send({ error: "You don't have access to this room" });
  }

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

  roomOwners[room] = roomOwners[room] || cloudId;
  const nsRoom = roomKey(cloudId, room);
  const state = getRoom(nsRoom);
  state.issue = issue;
  fastify.io.to(nsRoom).emit('roomState', state);
  return reply.send({ ok: true });
});

// Save a round's winning point value back to the room's loaded issue. This is a
// plain request/response (no roomState broadcast) since the result is local to
// whoever clicked save, unlike loading an issue which is shared room state.
fastify.post('/issue/points', async (req, reply) => {
  const session = readSession(req);
  if (!session) return reply.code(401).send({ error: 'Unauthenticated' });

  const fresh = await ensureFreshToken(session);
  if (!fresh) {
    clearSession(reply);
    return reply.code(401).send({ error: 'Session expired' });
  }
  if (fresh.changed) writeSession(reply, fresh.session);

  const { room, points } = req.body ?? {};
  if (typeof room !== 'string' || !Number.isFinite(points)) {
    return reply.code(400).send({ error: 'Invalid request' });
  }

  const { token, cloudId } = fresh.session;
  if (roomOwners[room] && roomOwners[room] !== cloudId) {
    return reply.code(403).send({ error: "You don't have access to this room" });
  }

  const nsRoom = roomKey(cloudId, room);
  const state = getRoom(nsRoom);
  if (!state.issue) return reply.code(400).send({ error: 'No issue loaded' });
  const { key } = state.issue;

  // Story Points lives in a per-site custom field ("Story Points" on classic
  // projects, "Story point estimate" on team-managed projects), so resolve its
  // id from this issue's edit screen rather than hardcoding a customfield_XXXXX.
  const metaRes = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${key}/editmeta`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  );
  if (!metaRes.ok) return reply.code(502).send({ error: `Could not load edit metadata for ${key}` });
  const meta = await metaRes.json();
  const fieldId = Object.entries(meta.fields ?? {}).find(([, f]) => /^story point/i.test(f.name))?.[0];
  if (!fieldId) return reply.code(422).send({ error: `${key} has no Story Points field on its edit screen` });

  const putRes = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${key}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [fieldId]: points } }),
    }
  );
  if (putRes.status === 403) {
    return reply.code(403).send({ error: 'No permission to edit this issue — try reconnecting your Jira account' });
  }
  if (!putRes.ok) return reply.code(502).send({ error: `Could not save points to ${key}` });

  return reply.send({ ok: true });
});

// Resolve a connection's identity from its session cookie at handshake time.
// Returns null when there is no valid session so the connection can be refused;
// accountId is a stable id that survives reconnects (socket.id does not), and
// cloudId scopes every room this socket touches to the user's active instance.
function sessionFromSocket(socket) {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const sessionCookie = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  const session = openSession(sessionCookie ? decodeURIComponent(sessionCookie) : null);
  if (!session?.user?.accountId || !session.cloudId) return null;

  // Dev-only: the client assigns each tab a random id (see devUser.ts) to
  // simulate a distinct user from the same real login, so one login + multiple
  // tabs can act as multiple players. cloudId is left untouched so
  // room-ownership checks still pass.
  const devUser = !IS_PROD && socket.handshake.query.devUser;
  const userId = devUser ? `${session.user.accountId}:${devUser}` : session.user.accountId;

  return { userId, cloudId: session.cloudId };
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
    // Last one out releases the room name so another instance can claim it later.
    if (userData[room] && Object.keys(userData[room]).length === 0) {
      delete roomOwners[rawRoom(room)];
    }
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
  // Refuse unauthenticated sockets at the handshake: a connection with no valid
  // session can't join rooms, cast votes, or observe issue broadcasts at all.
  fastify.io.use((socket, next) => {
    const identity = sessionFromSocket(socket);
    if (!identity) return next(new Error('Unauthenticated'));
    socket.data.userId = identity.userId;
    socket.data.cloudId = identity.cloudId;
    next();
  });

  fastify.io.on("connection", (socket) => {
    console.info('Socket connected', socket.id, 'user', socket.data.userId);
    // Scope every client-supplied room name to this socket's instance, so two
    // tenants using the same name never share state. socket.rooms then holds
    // these namespaced keys, which disconnecting/leaveRoom feed straight back.
    const key = (room) => roomKey(socket.data.cloudId, room);

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

    socket.on("joinRoom", (room, username, picture, cursorImage) => {
      console.info(`user ${username} wants room: ${room}`);
      const { userId, cloudId } = socket.data;
      // A room name is owned by the first instance to open it; refuse joins from a
      // different instance so a shared/guessed URL can't cross tenant boundaries.
      if (roomOwners[room] && roomOwners[room] !== cloudId) {
        console.warn(`Denied ${userId} (${cloudId}) join of "${room}" owned by ${roomOwners[room]}`);
        fastify.io.to(socket.id).emit("joinDenied", { room });
        return;
      }
      roomOwners[room] = cloudId;

      const nsRoom = key(room);
      socket.join(nsRoom);
      trackSocket(nsRoom, userId, socket.id);

      userData[nsRoom] = userData[nsRoom] || {};
      userData[nsRoom][userId] = { name: username, picture: picture || null, cursorImage: cursorImage || null };
      fastify.io.to(socket.id).emit("roomUpdate", userData[nsRoom]);
      socket.to(nsRoom).emit("roomUpdate", userData[nsRoom]);

      const state = getRoom(nsRoom);
      // Preserve an existing vote across reconnects; only initialize on first join.
      if (!(userId in state.votes)) state.votes[userId] = null;
      fastify.io.to(socket.id).emit("roomState", state);
      socket.to(nsRoom).emit("roomState", state);

      console.log(`${Object.keys(userData[nsRoom]).length} users in ${nsRoom}`);
    });

    socket.on("leaveRoom", (room) => {
      const nsRoom = key(room);
      console.info('socket leaving room:', nsRoom);
      socket.leave(nsRoom);
      // Intentional leave — remove now (unless the user still has another tab open).
      untrackSocket(nsRoom, socket.data.userId, socket.id, { immediate: true });

      console.log(`${Object.keys(userData[nsRoom] || {}).length} users in ${nsRoom}`);
    });

    socket.on("updateUser", (room, data) => {
      const nsRoom = key(room);
      console.info('updateUser', nsRoom, data);
      const userId = socket.data.userId;
      userData[nsRoom] = userData[nsRoom] || {};
      userData[nsRoom][userId] = {
        ...userData[nsRoom][userId],
        ...data,
      };
      fastify.io.to(socket.id).emit("roomUpdate", userData[nsRoom]);
      socket.to(nsRoom).emit("roomUpdate", userData[nsRoom]);
    });

    // Pure relay for the mouse-follower effect: not persisted, since a stale
    // position is meaningless after a reconnect. pos is { x, y } as fractions of
    // the table's box, or null when the sender's mouse left it. socket.to (not
    // fastify.io.to) so it never echoes back to the sender, who already renders
    // their own cursor locally.
    socket.on("cursorMove", (room, pos) => {
      const nsRoom = key(room);
      socket.to(nsRoom).emit("cursorUpdate", socket.data.userId, pos);
    });

    socket.on("castVote", (room, value) => {
      const nsRoom = key(room);
      const state = getRoom(nsRoom);
      state.votes[socket.data.userId] = value;
      fastify.io.to(nsRoom).emit("roomState", state);
    });

    socket.on("revealVotes", (room) => {
      const nsRoom = key(room);
      const state = getRoom(nsRoom);
      state.phase = 'revealed';
      fastify.io.to(nsRoom).emit("roomState", state);
    });

    socket.on("resetVotes", (room) => {
      const nsRoom = key(room);
      const state = getRoom(nsRoom);
      state.phase = 'voting';
      Object.keys(state.votes).forEach(id => {
        state.votes[id] = null;
      });
      fastify.io.to(nsRoom).emit("roomState", state);
    });
  });
});

try {
  await fastify.listen({ port: process.env.PORT || 3218, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
