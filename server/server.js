import Fastify from 'fastify';
import fastifyIO from "fastify-socket.io";
import cors from '@fastify/cors';

const fastify = Fastify({
  logger: true
}).register(fastifyIO, {
  serveClient: false,
  cors: {
    origin: '*'
  }
}).register(cors, {
  origin: '*'
});

const userData = {};
const roomState = {};

function getRoom(room) {
  if (!roomState[room]) {
    roomState[room] = { phase: 'voting', votes: {} };
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

    socket.on("joinRoom", (room, username) => {
      console.info(`user ${username} wants room: ${room}`);
      socket.join(room);

      userData[room] = userData[room] || {};
      userData[room][socket.id] = { name: username };
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
  });
});

try {
  await fastify.listen({ port: 3218 });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
