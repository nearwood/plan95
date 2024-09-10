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

export const useRoom = (type: RoomType, name: string, username: string): Socket => {
  const { socket, rooms, updateRooms } = useSocket();

  const room = `${type}:${name}`;

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
    if (!rooms[room]) {
      rooms[room] = 1;
      if (socket.connected) {
        socket.emit(WebsocketClientEvents.WS_JOINROOM, room, username);
      }
      socket.on('connect', rejoinRooms);
    } else {
      rooms[room] += 1;
    }

    updateRooms(rooms);

    return (): void => {
      // If this is the last hook using this room, leave the room
      if (rooms[room] <= 1) {
        socket.emit(WebsocketClientEvents.WS_LEAVEROOM, room, username);
        delete rooms[room];
        socket.off('connect', rejoinRooms);
      } else {
        rooms[room] -= 1;
      }
      updateRooms(rooms);
    };
  }, [name, room, rooms, socket, type, updateRooms]);

  return socket;
};

export const usePokerRoom = (roomId: string, username): Socket => useRoom(RoomType.POKER, roomId, username);
