import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { WindowHeader, Button, Toolbar, Frame, WindowContent, MenuList, MenuListItem, Separator } from 'react95';
import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';
import { useSocket } from './socketContext';
import type { User } from './useAuth';

function Lobby() {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const { user, logout } = useOutletContext<{ user: User; logout: () => void }>();
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);

  function createRoom() {
    const roomName = uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: '-',
    });
    navigate(`/poker/${roomName}`);
  }

  return (<>
    <WindowHeader className='window-title'>
      <span>Planning Poker - plan95</span>
    </WindowHeader>
    <Toolbar className='toolbar'>
      <Button variant='menu' size='sm'>File</Button>
      <Button variant='menu' size='sm'>Edit</Button>
      <Button variant='menu' size='sm' disabled>Room</Button>
      <Button variant='menu' size='sm' onClick={() => setHelpMenuOpen(!helpMenuOpen)}>
        Help
        {helpMenuOpen && <MenuList
          style={{ position: 'absolute', top: 24, zIndex: 9999 }}
          onClick={() => setHelpMenuOpen(false)}
        >
          <MenuListItem size='sm' disabled>Copy link</MenuListItem>
          <MenuListItem size='sm' disabled>Twitter</MenuListItem>
          <Separator />
          <MenuListItem size='sm'>About</MenuListItem>
        </MenuList>}
      </Button>
    </Toolbar>
    <WindowContent className='windowContent'>
      <Button onClick={createRoom}>Create Room</Button>
    </WindowContent>
    <Frame variant='well' className='footer'>
      <span>{connected ? `${user.name} · ` : 'Connecting... · '}</span>
      <Button size='sm' onClick={logout}>Logout</Button>
    </Frame>
  </>);
}

export default Lobby;
