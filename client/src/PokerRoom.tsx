/* eslint-disable @typescript-eslint/no-explicit-any */
import { WindowHeader, Button, Frame, WindowContent, TextInput } from 'react95';

import { usePokerRoom } from './useRoom';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CardHand } from './CardHand';
import { CardPile } from './CardPile';
import { VoteDistribution } from './VoteDistribution';
import { useSocket } from './socketContext';
import type { User } from './useAuth';
import { AvatarStack } from './AvatarStack';
import { SiteSelector } from './SiteSelector';
import { MenuBar } from './MenuBar';
import { CursorFollower } from './CursorFollower';
import { getDevUser } from './devUser';
import Markdown from 'react-markdown';
import { convert as adfToMd } from 'adf-to-md';

import cursorRed from './assets/cursors/red.png';
import cursorTeal from './assets/cursors/teal.png';
import cursorOrange from './assets/cursors/orange.png';
import cursorPurple from './assets/cursors/purple.png';
import cursorCoffee from './assets/cursors/coffee.svg';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3218';

// Each session's follower image is a random pick made once at load; duplicates
// across users are fine, so there's nothing to coordinate server-side.
const CURSOR_IMAGES = [cursorRed, cursorTeal, cursorOrange, cursorPurple, cursorCoffee];

// Caps how often we broadcast our position (not how often we render our own
// follower, which stays instant/local).
const CURSOR_EMIT_INTERVAL_MS = 40;

interface CursorPos {
  x: number;
  y: number;
}

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
  [socketId: string]: { name: string; picture: string | null; cursorImage?: string | null };
}

function PokerRoom() {
  const { roomName } = useParams();
  const { user } = useOutletContext<{ user: User }>();
  const [cursorImage] = useState(() => CURSOR_IMAGES[Math.floor(Math.random() * CURSOR_IMAGES.length)]);
  const { socket: roomSocket, roomId } = usePokerRoom(roomName || '', user.name, user.picture, cursorImage);
  const { connected } = useSocket();
  const [userData, setUserData] = useState<UserData>({});
  const [roomState, setRoomState] = useState<RoomState>({ phase: 'voting', votes: {}, issue: null });
  const [issueInput, setIssueInput] = useState('');
  const [issueError, setIssueError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [ownCursor, setOwnCursor] = useState<CursorPos | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, CursorPos>>({});
  const lastCursorEmitRef = useRef(0);
  const cursorHiddenRef = useRef(false);
  const roundControlsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const numUsers = Object.keys(userData).length;
  // Identify our own vote by stable account id (survives socket reconnects).
  // devUser mirrors the server's dev-only identity suffix (see sessionFromSocket)
  // so multiple tabs under one real login act as distinct players locally too.
  const devUser = getDevUser();
  const myAccountId = devUser ? `${user.accountId}:${devUser}` : user.accountId;
  const myVote = roomState.votes[myAccountId] ?? null;
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

  // The server refuses joins to a room owned by a different Atlassian instance.
  const handleJoinDenied = useCallback(() => {
    setDenied(true);
  }, []);

  const handleCursorUpdate = useCallback((userId: string, pos: CursorPos | null) => {
    setRemoteCursors(prev => {
      if (!pos) {
        if (!(userId in prev)) return prev;
        const next = { ...prev };
        delete next[userId];
        return next;
      }
      return { ...prev, [userId]: pos };
    });
  }, []);

  useEffect(() => {
    roomSocket?.on('roomUpdate', handleRoomUpdate);
    roomSocket?.on('roomState', handleRoomState);
    roomSocket?.on('joinDenied', handleJoinDenied);
    roomSocket?.on('cursorUpdate', handleCursorUpdate);
    return () => {
      roomSocket?.off('roomUpdate', handleRoomUpdate);
      roomSocket?.off('roomState', handleRoomState);
      roomSocket?.off('joinDenied', handleJoinDenied);
      roomSocket?.off('cursorUpdate', handleCursorUpdate);
    };
  }, [roomSocket, handleRoomUpdate, handleRoomState, handleJoinDenied, handleCursorUpdate]);

  // A user can vanish (disconnect, tab close) without ever sending a final
  // cursorMove(null), so prune any follower whose owner is no longer present.
  useEffect(() => {
    setRemoteCursors(prev => {
      let changed = false;
      const next: Record<string, CursorPos> = {};
      for (const [userId, pos] of Object.entries(prev)) {
        if (userData[userId]) {
          next[userId] = pos;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [userData]);

  const handleTableMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Below the reveal/new-round button is the card-picking zone: hide the
    // follower there so nobody can watch you home in on a card before you vote.
    const controlsBottom = roundControlsRef.current?.getBoundingClientRect().bottom;
    if (controlsBottom !== undefined && e.clientY >= controlsBottom) {
      if (!cursorHiddenRef.current) {
        cursorHiddenRef.current = true;
        setOwnCursor(null);
        roomSocket?.emit('cursorMove', roomId, null);
      }
      return;
    }
    cursorHiddenRef.current = false;

    const rect = e.currentTarget.getBoundingClientRect();
    const pos = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    setOwnCursor(pos);

    const now = Date.now();
    if (now - lastCursorEmitRef.current >= CURSOR_EMIT_INTERVAL_MS) {
      lastCursorEmitRef.current = now;
      roomSocket?.emit('cursorMove', roomId, pos);
    }
  }, [roomSocket, roomId]);

  const handleTableMouseLeave = useCallback(() => {
    cursorHiddenRef.current = false;
    setOwnCursor(null);
    roomSocket?.emit('cursorMove', roomId, null);
  }, [roomSocket, roomId]);

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

  if (denied) {
    return (<>
      <WindowHeader className='window-title'>
        <span><img src='/favicon.png' className='title-icon' alt='' />Plan95 - Planning Poker</span>
        <Button onClick={goToLobby}>
          <span className='close-icon' />
        </Button>
      </WindowHeader>
      <WindowContent className='windowContent'>
        <p>You don't have access to this room.</p>
        <Button onClick={goToLobby}>Back to Lobby</Button>
      </WindowContent>
    </>);
  }

  return (<>
    <WindowHeader className='window-title'>
      <span><img src='/favicon.png' className='title-icon' alt='' />Plan95 - Planning Poker - {roomName}</span>
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
      <div className='pokerBottom' onMouseMove={handleTableMouseMove} onMouseLeave={handleTableMouseLeave}>

        {ownCursor && <CursorFollower x={ownCursor.x} y={ownCursor.y} image={cursorImage} />}
        {Object.entries(remoteCursors).map(([userId, pos]) => {
          const image = userData[userId]?.cursorImage;
          return image ? <CursorFollower key={userId} x={pos.x} y={pos.y} image={image} /> : null;
        })}

        {/* Avatar stack */}
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end', paddingRight: 10, position: 'relative', zIndex: 20 }}>
          <AvatarStack userData={userData} />
        </div>

        {/* Card pile + vote distribution */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {roomState.phase === 'revealed' && (
            <div style={{ position: 'relative', zIndex: 20, flexShrink: 0, display: 'flex' }}>
              <VoteDistribution votes={roomState.votes} userData={userData} />
            </div>
          )}
          <CardPile userData={userData} roomState={roomState} />
        </div>

        {/* Result */}
        {roomState.phase === 'revealed' && (
          <p style={{ margin: '0 0 12px', color: '#fff', textShadow: '1px 1px 0 #000', position: 'relative', zIndex: 20 }}>
            {average ? <>Average: <strong>{average}</strong></> : 'No numeric votes'}
          </p>
        )}

        {/* Round controls */}
        <div ref={roundControlsRef} style={{ marginBottom: 12, position: 'relative', zIndex: 20 }}>
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
