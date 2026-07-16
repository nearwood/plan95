/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { WindowHeader, Button, Frame, WindowContent, Select, TextInput } from 'react95';
import type { User } from './useAuth';
import { computeRoundVotes, SCENARIOS, type Scenario } from './botScenarios';

const host = import.meta.env.VITE_SERVER_URL || 'ws://localhost:3218';

const MIN_BOTS = 1;
const MAX_BOTS = 50;
const DEFAULT_BOTS = 5;
const DEFAULT_SCENARIO: Scenario = 'spread';

interface RoomState {
  phase: 'voting' | 'revealed';
  votes: Record<string, string | null>;
}

interface BotStatus {
  index: number;
  connected: boolean;
  lastVote: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Dev-only tool: connects N independent socket.io connections (not the app's
// singleton socket from socketContext.tsx, which only ever hosts one) to a
// room, each registering under your real login but with its own `devUser`
// suffix (see sessionFromSocket in server/server.js) so the server treats
// each as a distinct simulated voter. Lets multiplayer features — avatar
// stack, vote piles, vote distribution — be exercised without real logins.
function BotLab() {
  const { roomName } = useParams();
  const { user } = useOutletContext<{ user: User }>();
  const [searchParams] = useSearchParams();

  const initialCount = clamp(parseInt(searchParams.get('n') ?? '', 10) || DEFAULT_BOTS, MIN_BOTS, MAX_BOTS);
  const rawScenario = searchParams.get('scenario');
  const initialScenario = (SCENARIOS as string[]).includes(rawScenario ?? '') ? (rawScenario as Scenario) : DEFAULT_SCENARIO;

  const [botCount, setBotCount] = useState(initialCount);
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [running, setRunning] = useState(false);
  const [denied, setDenied] = useState(false);
  const [statuses, setStatuses] = useState<BotStatus[]>([]);

  const socketsRef = useRef<Socket[]>([]);
  const scheduledRef = useRef<Set<number>>(new Set());
  const scenarioRef = useRef(scenario);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  const stop = useCallback(() => {
    socketsRef.current.forEach(socket => {
      if (roomName) socket.emit('leaveRoom', roomName);
      socket.disconnect();
    });
    socketsRef.current = [];
    scheduledRef.current.clear();
    setRunning(false);
    setStatuses([]);
  }, [roomName]);

  const start = useCallback(() => {
    if (!roomName || !import.meta.env.DEV) return;
    stop();

    const n = botCount;
    const sockets: Socket[] = [];
    setDenied(false);

    for (let i = 0; i < n; i++) {
      const devUser = `bot-${i}`;
      const socket = io(host, {
        transports: ['websocket'],
        withCredentials: true,
        query: { devUser },
      });
      sockets.push(socket);

      socket.on('connect', () => {
        socket.emit('joinRoom', roomName, `Bot ${i + 1}`, null, null);
        setStatuses(prev => prev.map(s => (s.index === i ? { ...s, connected: true } : s)));
      });

      socket.on('disconnect', () => {
        setStatuses(prev => prev.map(s => (s.index === i ? { ...s, connected: false } : s)));
      });

      socket.on('joinDenied', () => {
        setDenied(true);
        stop();
      });

      // Registered on every bot socket so a batch of votes still gets scheduled
      // even if one particular bot happens to be slow to (re)connect; the
      // shared scheduledRef Set makes redundant firings a no-op (JS is
      // single-threaded, so the synchronous add() below always wins the race).
      socket.on('roomState', (state: RoomState) => {
        if (state.phase !== 'voting') {
          scheduledRef.current.clear();
          return;
        }

        const needsVote: number[] = [];
        for (let idx = 0; idx < n; idx++) {
          const botAccountId = `${user.accountId}:bot-${idx}`;
          if (!scheduledRef.current.has(idx) && !state.votes[botAccountId]) {
            needsVote.push(idx);
          }
        }
        if (needsVote.length === 0) return;

        needsVote.forEach(idx => scheduledRef.current.add(idx));
        const values = computeRoundVotes(scenarioRef.current, needsVote.length);
        needsVote.forEach((idx, vi) => {
          const delay = 300 + Math.random() * 1200;
          setTimeout(() => {
            sockets[idx]?.emit('castVote', roomName, values[vi]);
            setStatuses(prev => prev.map(s => (s.index === idx ? { ...s, lastVote: values[vi] } : s)));
          }, delay);
        });
      });
    }

    socketsRef.current = sockets;
    setStatuses(Array.from({ length: n }, (_, i) => ({ index: i, connected: false, lastVote: null })));
    setRunning(true);
  }, [roomName, botCount, user.accountId, stop]);

  // Auto-start once on mount using the initial (possibly URL-provided) count
  // and scenario, so a bookmarked/shared link just works with no extra click.
  useEffect(() => {
    start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revealVotes = () => roomName && socketsRef.current[0]?.emit('revealVotes', roomName);
  const resetVotes = () => roomName && socketsRef.current[0]?.emit('resetVotes', roomName);

  return (<>
    <WindowHeader className='window-title'>
      <span><img src='/favicon.png' className='title-icon' alt='' />Bot Lab - {roomName}</span>
    </WindowHeader>
    <WindowContent className='windowContent'>
      {!import.meta.env.DEV ? (
        <p>Bot Lab is only available in development.</p>
      ) : (<>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <span>Bots:</span>
          <TextInput
            value={String(botCount)}
            onChange={(e: any) => setBotCount(clamp(parseInt(e.target.value, 10) || MIN_BOTS, MIN_BOTS, MAX_BOTS))}
            disabled={running}
            style={{ width: 60 }}
          />
          <span>Scenario:</span>
          <Select
            options={SCENARIOS.map(s => ({ label: s, value: s }))}
            value={scenario}
            onChange={(opt: any) => setScenario(opt.value)}
            width={140}
          />
          {running
            ? <Button onClick={stop}>Stop</Button>
            : <Button onClick={start}>Start</Button>
          }
        </div>

        {denied && <p style={{ color: '#ff4444' }}>Room is owned by a different Atlassian instance.</p>}

        {running && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Button onClick={revealVotes}>Reveal</Button>
            <Button onClick={resetVotes}>New Round</Button>
          </div>
        )}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {statuses.map(s => (
            <li key={s.index} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
              <span style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                display: 'inline-block',
                background: s.connected ? '#2a9d8f' : '#999',
              }} />
              <span>Bot {s.index + 1}</span>
              <span style={{ marginLeft: 'auto' }}>{s.lastVote ?? '—'}</span>
            </li>
          ))}
        </ul>
      </>)}
    </WindowContent>
    <Frame variant='well' className='footer'>
      <span>{user.name}</span>
    </Frame>
  </>);
}

export default BotLab;
