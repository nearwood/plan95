import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';

let socket: Socket;
const rooms = {};
const host = 'ws://localhost:3218';

export interface RoomReference {
  [key: string]: number;
}

export interface SocketIOContext {
  socket: Socket;
  rooms: RoomReference;
  updateRooms: (rooms: RoomReference) => void;
}

export interface Props {
  children: React.ReactNode;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SocketContext = createContext({ socket, rooms, updateRooms: (_newRooms: RoomReference) => { } });
SocketContext.displayName = 'SocketContext';
export { SocketContext };

export const useSocket = (): SocketIOContext => useContext(SocketContext);

export const SocketProvider: React.FC<Props> = ({ children }) => {
  const [socketState, setSocketState] = useState(socket);
  const [roomsState, setRoomState] = useState({});

  const updateRooms = useCallback((newRooms: any) => {
    setRoomState(newRooms);
  }, []);

  const socketContext = useMemo(() => ({ socket: socketState, rooms: roomsState, updateRooms }), [socketState, roomsState, updateRooms]);
  useEffect(() => {
    if (socket) {
      socket.disconnect();
    }

    socket = io(host, {
      transports: ['websocket'],
    });

    setSocketState(socket);
    socket.on('connect', () => {
      console.debug(`SocketIO connected: ${socket.id}`);
    });

    socket.on('disconnect', () => {
      console.debug('SocketIO disconnected');
    });

    // Sent any valid 'dispatch' event through redux.
    socket.onAny((event, type, data) => {
      console.debug(`Socket ${socket.id} got event: ${event} with type: ${type} and data: ${data}`);
    });
  }, []);

  return (
    <SocketContext.Provider value={socketContext}>
      {children}
    </SocketContext.Provider>
  );
};
