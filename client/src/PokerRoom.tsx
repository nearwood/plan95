/* eslint-disable @typescript-eslint/no-explicit-any */
import { WindowHeader, Button, Frame, WindowContent, TextInput } from 'react95';

import { usePokerRoom } from './useRoom';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { CardHand } from './CardHand';
import { CardPile } from './CardPile';
import { VoteDistribution } from './VoteDistribution';
import { useSocket } from './socketContext';
import type { User } from './useAuth';
import { AvatarStack } from './AvatarStack';
import { SiteSelector } from './SiteSelector';
import { MenuBar } from './MenuBar';
import Markdown from 'react-markdown';
import { convert as adfToMd } from 'adf-to-md';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3218';

interface JiraIssue {
  key: string;
  summary: string;
  description: object | null;
}

interface RoomState {
  phase: 'voting' | 'revealed';
  votes: Record<string, string | null>;
  issue: JiraIssue | null;
}

interface UserData {
  [socketId: string]: { name: string; picture: string | null };
}

function PokerRoom() {
  const { roomName } = useParams();
  const { user } = useOutletContext<{ user: User }>();
  const { socket: roomSocket, roomId } = usePokerRoom(roomName || '', user.name, user.picture);
  const { connected } = useSocket();
  const [userData, setUserData] = useState<UserData>({});
  const [roomState, setRoomState] = useState<RoomState>({ phase: 'voting', votes: {}, issue: null });
  const [issueInput, setIssueInput] = useState('');
  const [issueError, setIssueError] = useState<string | null>(null);
  const navigate = useNavigate();

  const numUsers = Object.keys(userData).length;
  // Identify our own vote by stable account id (survives socket reconnects).
  const myVote = roomState.votes[user.accountId] ?? null;
  const votedCount = Object.values(roomState.votes).filter(v => v !== null).length;

  const numericVotes = roomState.phase === 'revealed'
    ? Object.values(roomState.votes)
        .filter((v): v is string => v !== null && v !== '?' && v !== '☕')
        .map(v => parseInt(v))
    : [];
  const average = numericVotes.length > 0
    ? (numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length).toFixed(1)
    : null;

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

  const loadIssue = async () => {
    setIssueError(null);
    try {
      const res = await fetch(`${SERVER_URL}/issue`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomId, input: issueInput }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setIssueError(data.error || 'Could not load issue');
      }
      // On success the new issue arrives via the roomState socket broadcast.
    } catch {
      setIssueError('Could not load issue');
    }
  };

  function goToLobby() {
    navigate('/');
  }

  return (<>
    <WindowHeader className='window-title'>
      <span>Plan95 - Planning Poker - {roomName}</span>
      <Button onClick={goToLobby}>
        <span className='close-icon' />
      </Button>
    </WindowHeader>
    <MenuBar />
    <WindowContent className='windowContent pokerWindow'>

      {/* Top: Jira panel */}
      <div className='pokerTop'>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <TextInput
            value={issueInput}
            onChange={(e: any) => setIssueInput(e.target.value)}
            onKeyDown={(e: any) => e.key === 'Enter' && loadIssue()}
            placeholder='PROJ-123 or Jira URL'
            style={{ flex: 1 }}
          />
          <Button onClick={loadIssue} disabled={!issueInput}>Load</Button>
        </div>
        {roomState.issue && (
          <div>
            <strong>{roomState.issue.key}: {roomState.issue.summary}</strong>
            {roomState.issue.description && (
              <div className='issueDescription'>
                <Markdown>{adfToMd(roomState.issue.description).result}</Markdown>
              </div>
            )}
          </div>
        )}
        {issueError && <p style={{ color: '#ff4444', margin: '4px 0 0', fontSize: 12 }}>{issueError}</p>}
      </div>

      {/* Bottom: Poker table */}
      <div className='pokerBottom'>

        {/* Avatar stack */}
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end', paddingRight: 10 }}>
          <AvatarStack userData={userData} />
        </div>

        {/* Card pile + vote distribution */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {roomState.phase === 'revealed' && (
            <VoteDistribution votes={roomState.votes} userData={userData} />
          )}
          <CardPile userData={userData} roomState={roomState} />
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
        <div style={{ marginTop: 'auto' }}>
          <CardHand myVote={myVote} onVote={castVote} />
        </div>
      </div>
    </WindowContent>
    <Frame variant='well' className='footer'>
      {connected
        ? <><span>Users: {numUsers}</span>{roomState.phase === 'voting' && numUsers > 0 && votedCount === numUsers && <span> · All voted!</span>}</>
        : <span>Connecting...</span>
      }
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <SiteSelector />
        <span>{user.name}</span>
      </div>
    </Frame>
  </>);
}

export default PokerRoom;
