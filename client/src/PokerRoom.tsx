import { WindowHeader, Button, Toolbar, Frame, WindowContent, MenuList, MenuListItem, Separator } from 'react95';


import { usePokerRoom } from './useRoom';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';


function Card({ name }: { name: string }) {
  return (
    <div className='card'>
      <div className='card-header'>
        <span>{name}</span>
      </div>
      <div className='card-content'>
        <span>blah</span>
      </div>
    </div>
  );
}

//TODO lots of useCallbacks
function PokerRoom() {
  const { roomId } = useParams();
  const roomSocket = usePokerRoom(roomId || '');
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const navigate = useNavigate();

  const roomJoined = useCallback((id: string) => {
    console.log('roomJoined', id);
    setUserCount(userCount + 1);
  }, [userCount]);

  const roomLeft = useCallback((id: string) => {
    console.log('roomLeft', id);
    setUserCount(userCount - 1);
  }, [userCount]);

  useEffect(() => {
    roomSocket?.on('roomJoined', roomJoined);
    roomSocket?.on('roomLeft', roomLeft);

    return () => {
      roomSocket?.off('roomJoined', roomJoined);
      roomSocket?.off('roomLeft', roomLeft);
    };
  }, [roomJoined, roomLeft, roomSocket, userCount]);

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
        Poker Room
      </p>
    </WindowContent>
    <Frame variant='well' className='footer'>
      <span>Users: {userCount}</span>
    </Frame>
  </>
  );
}

export default PokerRoom;
