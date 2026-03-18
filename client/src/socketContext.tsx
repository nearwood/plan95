/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
const rooms = {};
const host = import.meta.env.VITE_SERVER_URL || 'ws://localhost:3218';

export interface RoomReference {
  [key: string]: number;
}

export interface SocketIOContext {
  socket: Socket | null;
  rooms: RoomReference;
  updateRooms: (rooms: RoomReference) => void;
}

export interface Props {
  children: React.ReactNode;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SocketContext = createContext<SocketIOContext>({ socket, rooms, updateRooms: (_newRooms: RoomReference) => { } });
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
      console.debug(`SocketIO connected: ${socket!.id}`);
    });

    socket.on('disconnect', () => {
      console.debug('SocketIO disconnected');
    });

    // Sent any valid 'dispatch' event through redux.
    socket.onAny((event, type, data) => {
      console.debug(`Socket ${socket!.id} got event: ${event} with type: ${type} and data: ${data}`);
    });
  }, []);

  return (
    <SocketContext.Provider value={socketContext}>
      {children}
    </SocketContext.Provider>
  );
};
