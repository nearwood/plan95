import { useEffect } from 'react';
import { useSocket } from './socketContext';
import { Socket } from 'socket.io-client';

export const enum RoomType {
  POKER = 'poker',
};

export const enum WebsocketClientEvents {
  WS_JOINROOM = 'joinRoom',
  WS_LEAVEROOM = 'leaveRoom',
};

export interface RoomHookResponse {
  socket: Socket | null;
  roomId: string;
}

export const useRoom = (type: RoomType, name: string, username: string): RoomHookResponse => {
  const { socket, rooms, updateRooms } = useSocket();

  const roomId = `${type}:${name}`;

  useEffect(() => {
    if (!socket) {
      return (): void => {};
    }

    /** Rejoin rooms after a reconnection */
    const rejoinRooms = (): void => {
      Object.keys(rooms).forEach((roomName) => {
        socket.emit(WebsocketClientEvents.WS_JOINROOM, roomName, username);
      });
    };

    // If this is the first time using this room, setup event listeners
    if (!rooms[roomId]) {
      rooms[roomId] = 1;
      if (socket.connected) {
        socket.emit(WebsocketClientEvents.WS_JOINROOM, roomId, username);
      }
      socket.on('connect', rejoinRooms);
    } else {
      rooms[roomId] += 1;
    }

    updateRooms(rooms);

    return (): void => {
      // If this is the last hook using this room, leave the room
      if (rooms[roomId] <= 1) {
        socket.emit(WebsocketClientEvents.WS_LEAVEROOM, roomId, username);
        delete rooms[roomId];
        socket.off('connect', rejoinRooms);
      } else {
        rooms[roomId] -= 1;
      }
      updateRooms(rooms);
    };
  }, [name, roomId, rooms, socket, type, updateRooms, username]);

  return { socket, roomId };
};

export const usePokerRoom = (roomId: string, username: string): RoomHookResponse => useRoom(RoomType.POKER, roomId, username);
