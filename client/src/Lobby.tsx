import { useNavigate, useOutletContext } from 'react-router-dom';
import { WindowHeader, Button, Frame, WindowContent } from 'react95';
import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';
import { useSocket } from './socketContext';
import type { User } from './useAuth';
import { SiteSelector } from './SiteSelector';
import { MenuBar } from './MenuBar';

function Lobby() {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const { user } = useOutletContext<{ user: User }>();

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
    <MenuBar inLobby />
    <WindowContent className='windowContent'>
      <Button onClick={createRoom}>Create Room</Button>
    </WindowContent>
    <Frame variant='well' className='footer'>
      {!connected && <span>Connecting...</span>}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <SiteSelector />
        <span>{user.name}</span>
      </div>
    </Frame>
  </>);
}

export default Lobby;
