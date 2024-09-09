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
          socket.to(room).emit("roomLeft", socket.id);
        }
      }
    });
  
    socket.on("joinRoom", (room) => {
      console.info('socket wants room:', room);
      socket.join(room);
      socket.to(room).emit("roomJoined", socket.id);
    });

    socket.on("leaveRoom", (room) => {
      console.info('socket leaving room:', room);
      socket.to(room).emit("roomLeft", socket.id);
      socket.leave(room);
    });
  });
});

try {
  await fastify.listen({ port: 3218 });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}