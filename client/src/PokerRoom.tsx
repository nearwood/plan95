/* eslint-disable @typescript-eslint/no-explicit-any */
import { WindowHeader, Button, Toolbar, Frame, WindowContent, MenuList, MenuListItem, Separator, TextInput, Avatar } from 'react95';
import Cookies from 'js-cookie';

import { usePokerRoom } from './useRoom';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';

const colorFromChars = (str: string) => {
  const hash = str.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
  const color = `hsl(${hash % 360}, 100%, 50%)`;
  return color;
}

function Card({ name }: { name: string }) {
  return (
    <Avatar size={50} style={{ background: colorFromChars(name) }}>
      {name}
    </Avatar>
  );
}

function PokerRoom() {
  const { roomName } = useParams();
  const savedUsername = Cookies.get('username') || '';
  const { socket: roomSocket, roomId } = usePokerRoom(roomName || '', savedUsername);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [userData, setUserData] = useState(null);
  const [username, setUsername] = useState(savedUsername);
  const navigate = useNavigate();

  const numUsers = Object.keys(userData || {}).length;

  const setUsernameCallback = useCallback((e: any) => {
    const name = e.target.value;
    setUsername(name);
    Cookies.set('username', name, { path: `poker/${roomName}` });
    roomSocket.emit('updateUser', roomId, { name });
  }, [roomId, roomName, roomSocket]);

  const roomUpdate = useCallback((data: any) => {
    console.log('roomUpdate', data);
    setUserData(data);
  }, []);

  useEffect(() => {
    roomSocket?.on('roomUpdate', roomUpdate);

    return () => {
      roomSocket?.off('roomUpdate', roomUpdate);
    };
  }, [roomSocket, roomUpdate]);

  function goToLobby() {
    navigate('/');
  }

  return (<>
    <WindowHeader className='window-title'>
      <span>{roomId} - Planning Poker - scrum.lol</span>
      <Button onClick={goToLobby}>
        <span className='close-icon' />
      </Button>
    </WindowHeader>
    <Toolbar className='toolbar'>
      <Button variant='menu' size='sm'>
        File
      </Button>
      <Button variant='menu' size='sm'>
        Edit
      </Button>
      <Button variant='menu' size='sm'>
        Room
      </Button>
      <Button variant='menu' size='sm' onClick={() => setHelpMenuOpen(!helpMenuOpen)}>
        Help
        {helpMenuOpen && <MenuList
          style={{
            position: 'absolute',
            top: 24,
            zIndex: '9999'
          }}
          onClick={() => setHelpMenuOpen(false)}
        >
          <MenuListItem size='sm' disabled>Copy link</MenuListItem>
          <MenuListItem size='sm' disabled>Twitter</MenuListItem>
          <Separator />
          <MenuListItem size='sm'>About</MenuListItem>
        </MenuList>}
      </Button>
    </Toolbar>
    <WindowContent className='windowContent pokerWindow'>
      <p>
        My name: <TextInput value={username} onChange={setUsernameCallback} />
      </p>
      <div className='userList'>
        {Object.entries(userData || {}).map(([key, user]) => (
          <Card key={key} name={user.name} />
        ))}
      </div>
    </WindowContent>
    <Frame variant='well' className='footer'>
      <span>Users: {numUsers}</span>
    </Frame>
  </>
  );
}

export default PokerRoom;
