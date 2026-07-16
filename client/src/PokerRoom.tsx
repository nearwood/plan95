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
import { ChipsCursorFollower, CHIP_CURSOR_IMAGES } from './ChipsCursorFollower';
import { getDevUser } from './devUser';
import { nearestCardValue } from './pokerValues';
import Markdown from 'react-markdown';
import { convert as adfToMd } from 'adf-to-md';

import cursorCoffee from './assets/cursors/coffee.svg';
import cursorWhiskey from './assets/cursors/whiskey_tumbler.svg';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3218';

// Each session's follower image is a random pick made once at load; duplicates
// across users are fine, so there's nothing to coordinate server-side. Chip
// colors are included individually so a session lands on one color, which
// also tells us to render the trailing chip group instead of a single image.
const CURSOR_IMAGES = [cursorCoffee, cursorWhiskey, ...CHIP_CURSOR_IMAGES];

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
  // Position is kept even while hidden (visible: false) so followers stay
  // mounted at all times instead of unmounting/remounting their <img> on
  // every on/off-table transition, which otherwise re-triggers image loads.
  const [ownCursor, setOwnCursor] = useState<{ pos: CursorPos; visible: boolean }>({ pos: { x: 0.5, y: 0.5 }, visible: false });
  const [remoteCursors, setRemoteCursors] = useState<Record<string, { pos: CursorPos; visible: boolean }>>({});
  const [pointsInput, setPointsInput] = useState('');
  const [pointsSaving, setPointsSaving] = useState(false);
  const [pointsSaveError, setPointsSaveError] = useState<string | null>(null);
  const [pointsSaved, setPointsSaved] = useState(false);
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
        if (!prev[userId]?.visible) return prev;
        return { ...prev, [userId]: { pos: prev[userId].pos, visible: false } };
      }
      return { ...prev, [userId]: { pos, visible: true } };
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
      const next: Record<string, { pos: CursorPos; visible: boolean }> = {};
      for (const [userId, entry] of Object.entries(prev)) {
        if (userData[userId]) {
          next[userId] = entry;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [userData]);

  // Pre-fill the points box with the nearest deck value once a round reveals,
  // and clear any stale value/status once voting resumes or a different issue
  // is loaded.
  useEffect(() => {
    if (roomState.phase === 'revealed') {
      setPointsInput(average ? nearestCardValue(Number(average)) : '');
    } else {
      setPointsInput('');
    }
    setPointsSaveError(null);
    setPointsSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState.phase, roomState.issue?.key]);

  const handleTableMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Below the reveal/new-round button is the card-picking zone: hide the
    // follower there so nobody can watch you home in on a card before you vote.
    const controlsBottom = roundControlsRef.current?.getBoundingClientRect().bottom;
    if (controlsBottom !== undefined && e.clientY >= controlsBottom) {
      if (!cursorHiddenRef.current) {
        cursorHiddenRef.current = true;
        setOwnCursor(prev => ({ ...prev, visible: false }));
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
    setOwnCursor({ pos, visible: true });

    const now = Date.now();
    if (now - lastCursorEmitRef.current >= CURSOR_EMIT_INTERVAL_MS) {
      lastCursorEmitRef.current = now;
      roomSocket?.emit('cursorMove', roomId, pos);
    }
  }, [roomSocket, roomId]);

  const handleTableMouseLeave = useCallback(() => {
    cursorHiddenRef.current = false;
    setOwnCursor(prev => ({ ...prev, visible: false }));
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

  const savePoints = async () => {
    const points = Number(pointsInput.trim());
    if (!Number.isFinite(points)) return;
    setPointsSaving(true);
    setPointsSaveError(null);
    setPointsSaved(false);
    try {
      const res = await fetch(`${SERVER_URL}/issue/points`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomId, points }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPointsSaveError(data.error || 'Could not save points');
      } else {
        setPointsSaved(true);
      }
    } catch {
      setPointsSaveError('Could not save points');
    } finally {
      setPointsSaving(false);
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

        {CHIP_CURSOR_IMAGES.includes(cursorImage)
          ? <ChipsCursorFollower x={ownCursor.pos.x} y={ownCursor.pos.y} image={cursorImage} visible={ownCursor.visible} />
          : <CursorFollower x={ownCursor.pos.x} y={ownCursor.pos.y} image={cursorImage} visible={ownCursor.visible} />}
        {Object.entries(userData).map(([userId, data]) => {
          const image = data.cursorImage;
          if (!image) return null;
          const entry = remoteCursors[userId];
          const pos = entry?.pos ?? { x: 0.5, y: 0.5 };
          const visible = entry?.visible ?? false;
          return CHIP_CURSOR_IMAGES.includes(image)
            ? <ChipsCursorFollower key={userId} x={pos.x} y={pos.y} image={image} visible={visible} />
            : <CursorFollower key={userId} x={pos.x} y={pos.y} image={image} visible={visible} />;
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

        {/* Save winning points back to the loaded issue */}
        {roomState.phase === 'revealed' && roomState.issue && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', position: 'relative', zIndex: 20 }}>
            <TextInput
              value={pointsInput}
              onChange={(e: any) => {
                setPointsInput(e.target.value);
                setPointsSaved(false);
                setPointsSaveError(null);
              }}
              onKeyDown={(e: any) => e.key === 'Enter' && savePoints()}
              style={{ width: 70 }}
            />
            <Button onClick={savePoints} disabled={!pointsInput || pointsSaving}>💾</Button>
            {pointsSaved && <span style={{ color: '#fff', textShadow: '1px 1px 0 #000' }}>Saved</span>}
            {pointsSaveError && <span style={{ color: '#ff4444', fontSize: 12 }}>{pointsSaveError}</span>}
          </div>
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
