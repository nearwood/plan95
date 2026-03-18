/* eslint-disable @typescript-eslint/no-explicit-any */
import { WindowHeader, Button, Toolbar, Frame, WindowContent, MenuList, MenuListItem, Separator, TextInput } from 'react95';
import Cookies from 'js-cookie';

import { usePokerRoom } from './useRoom';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { PlayingCard } from './PlayingCard';
import { POKER_VALUES } from './pokerValues';

interface RoomState {
  phase: 'voting' | 'revealed';
  votes: Record<string, string | null>;
}

interface UserData {
  [socketId: string]: { name: string };
}

function PokerRoom() {
  const { roomName } = useParams();
  const savedUsername = Cookies.get('username') || '';
  const { socket: roomSocket, roomId } = usePokerRoom(roomName || '', savedUsername);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [userData, setUserData] = useState<UserData>({});
  const [roomState, setRoomState] = useState<RoomState>({ phase: 'voting', votes: {} });
  const [username, setUsername] = useState(savedUsername);
  const navigate = useNavigate();

  const numUsers = Object.keys(userData).length;
  const mySocketId = roomSocket?.id || '';
  const myVote = roomState.votes[mySocketId] ?? null;
  const votedCount = Object.values(roomState.votes).filter(v => v !== null).length;

  const numericVotes = roomState.phase === 'revealed'
    ? Object.values(roomState.votes)
        .filter((v): v is string => v !== null && v !== '?' && v !== '☕')
        .map(v => parseInt(v))
    : [];
  const average = numericVotes.length > 0
    ? (numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length).toFixed(1)
    : null;

  const setUsernameCallback = useCallback((e: any) => {
    const name = e.target.value;
    setUsername(name);
    Cookies.set('username', name, { path: `poker/${roomName}` });
    roomSocket?.emit('updateUser', roomId, { name });
  }, [roomId, roomName, roomSocket]);

  const handleRoomUpdate = useCallback((data: UserData) => {
    setUserData(data);
  }, []);

  const handleRoomState = useCallback((state: RoomState) => {
    setRoomState(state);
  }, []);

  useEffect(() => {
    roomSocket?.on('roomUpdate', handleRoomUpdate);
    roomSocket?.on('roomState', handleRoomState);
    return () => {
      roomSocket?.off('roomUpdate', handleRoomUpdate);
      roomSocket?.off('roomState', handleRoomState);
    };
  }, [roomSocket, handleRoomUpdate, handleRoomState]);

  const castVote = (value: string) => {
    const newValue = myVote === value ? null : value;
    roomSocket?.emit('castVote', roomId, newValue);
  };

  const revealVotes = () => roomSocket?.emit('revealVotes', roomId);
  const resetVotes = () => roomSocket?.emit('resetVotes', roomId);

  function goToLobby() {
    navigate('/');
  }

  return (<>
    <WindowHeader className='window-title'>
      <span>{roomId} - Planning Poker - plan95</span>
      <Button onClick={goToLobby}>
        <span className='close-icon' />
      </Button>
    </WindowHeader>
    <Toolbar className='toolbar'>
      <Button variant='menu' size='sm'>File</Button>
      <Button variant='menu' size='sm'>Edit</Button>
      <Button variant='menu' size='sm'>Room</Button>
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
    <WindowContent className='windowContent pokerWindow'>
      <p style={{ margin: '0 0 12px' }}>
        My name: <TextInput value={username} onChange={setUsernameCallback} />
      </p>

      {/* Player cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
        {Object.entries(userData).map(([socketId, user]) => {
          const vote = roomState.votes[socketId];
          const hasVoted = vote !== null && vote !== undefined;
          const isMe = socketId === mySocketId;
          return (
            <div key={socketId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              {roomState.phase === 'revealed'
                ? <PlayingCard value={vote ?? undefined} />
                : hasVoted
                  ? <PlayingCard faceDown />
                  : <PlayingCard />
              }
              <span style={{ fontSize: 12, color: '#fff', fontWeight: isMe ? 'bold' : 'normal', textShadow: '1px 1px 0 #000' }}>
                {user.name || '(anon)'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Result */}
      {roomState.phase === 'revealed' && (
        <p style={{ margin: '0 0 12px', color: '#fff', textShadow: '1px 1px 0 #000' }}>
          {average ? <>Average: <strong>{average}</strong></> : 'No numeric votes'}
        </p>
      )}

      {/* Round controls */}
      <div style={{ marginBottom: 12 }}>
        {roomState.phase === 'voting'
          ? <Button onClick={revealVotes} disabled={votedCount === 0}>
              Reveal ({votedCount}/{numUsers})
            </Button>
          : <Button onClick={resetVotes}>New Round</Button>
        }
      </div>

      {/* Card picker */}
      {roomState.phase === 'voting' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {POKER_VALUES.map(value => (
            <PlayingCard
              key={value}
              value={value}
              selected={myVote === value}
              onClick={() => castVote(value)}
            />
          ))}
        </div>
      )}
    </WindowContent>
    <Frame variant='well' className='footer'>
      <span>Users: {numUsers}</span>
      {roomState.phase === 'voting' && numUsers > 0 && votedCount === numUsers && (
        <span> · All voted!</span>
      )}
    </Frame>
  </>);
}

export default PokerRoom;
