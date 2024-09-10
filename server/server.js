import Fastify from 'fastify';
import fastifyIO from "fastify-socket.io";
import cors from '@fastify/cors';

const fastify = Fastify({
  logger: true
}).register(fastifyIO, {
  serveClient: false,
  cors: {
    origin: '*' //"http://localhost:5173"
  }
}).register(cors, {
  origin: '*'
});

// fastify.get('/', async function handler (request, reply) {
//   fastify.io.emit("hello");
// });

const userData = {};

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
          socket.to(room).emit("roomLeft", userData[room]);
        }
      }
    });
  
    socket.on("joinRoom", (room, username) => {
      // TODO create room on server
      console.info(`user ${username} wants room: ${room}`);
      socket.join(room);
      userData[room] = userData[room] || {};
      userData[room][socket.id] = {
        name: username,
      };
      fastify.io.to(socket.id).emit("roomJoined", userData[room]);
      socket.to(room).emit("roomJoined", userData[room]);
      console.log(`${Object.keys(userData[room]).length} users in ${room}`);
    });

    socket.on("leaveRoom", (room) => {
      console.info('socket leaving room:', room);
      socket.leave(room);
      userData[room] = userData[room] || {};
      delete userData[room][socket.id];
      socket.to(room).emit("roomLeft", userData[room]);
      console.log(`${Object.keys(userData[room]).length} users in ${room}`);
    });
  });
});

try {
  await fastify.listen({ port: 3218 });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}