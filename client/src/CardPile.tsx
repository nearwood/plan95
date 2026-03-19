import { useEffect, useRef, useState } from 'react';
import { PlayingCard } from './PlayingCard';

interface UserData {
  [socketId: string]: { name: string; picture: string | null };
}

interface RoomState {
  phase: 'voting' | 'revealed';
  votes: Record<string, string | null>;
}

interface PileEntry {
  socketId: string;
  picture: string | null;
  name: string;
  pileAngle: number;
  pileX: number;
  pileY: number;
  startX: number;
  startY: number;
}

function seeded(seed: number, index: number, min: number, max: number): number {
  const x = Math.sin(seed * 9301 + index * 49297 + 233720) * 10000;
  const r = x - Math.floor(x);
  return min + r * (max - min);
}

function hashStr(str: string): number {
  return str.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
}

function makePileEntry(socketId: string, user: { name: string; picture: string | null }): PileEntry {
  const seed = Math.abs(hashStr(socketId));
  const side = Math.floor(seeded(seed, 0, 0, 4)); // 0=left,1=right,2=top,3=bottom
  const startX = side === 0 ? -500 : side === 1 ? 500 : seeded(seed, 1, -200, 200);
  const startY = side === 2 ? -400 : side === 3 ? 400 : seeded(seed, 2, -150, 150);
  return {
    socketId,
    picture: user.picture,
    name: user.name,
    pileAngle: seeded(seed, 3, -18, 18),
    pileX: seeded(seed, 4, -28, 28),
    pileY: seeded(seed, 5, -20, 20),
    startX,
    startY,
  };
}

function PileCard({ entry, vote, phase }: { entry: PileEntry; vote: string | null; phase: 'voting' | 'revealed' }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
  }, []);

  const transform = entered
    ? `rotate(${entry.pileAngle}deg) translate(${entry.pileX}px, ${entry.pileY}px)`
    : `rotate(${entry.pileAngle}deg) translate(${entry.startX}px, ${entry.startY}px)`;

  return (
    <div style={{
      position: 'absolute',
      transform,
      transition: entered ? 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
    }}>
      <div style={{ position: 'relative', width: 71, height: 96 }}>
        <PlayingCard
          faceDown={phase === 'voting'}
          value={phase === 'revealed' ? (vote ?? undefined) : undefined}
        />
        {entry.picture ? (
          <img
            src={entry.picture}
            alt={entry.name}
            title={entry.name}
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.8)',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            title={entry.name}
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.8)',
              background: '#555',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 12,
              fontWeight: 'bold',
            }}
          >
            {entry.name?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>
    </div>
  );
}

export function CardPile({ userData, roomState }: { userData: UserData; roomState: RoomState }) {
  const [entries, setEntries] = useState<PileEntry[]>([]);
  const prevPhaseRef = useRef(roomState.phase);

  useEffect(() => {
    // Clear pile on reset (phase goes back to voting with null votes)
    const allNull = Object.values(roomState.votes).every(v => v === null);
    if (roomState.phase === 'voting' && prevPhaseRef.current === 'revealed' && allNull) {
      setEntries([]);
    }
    prevPhaseRef.current = roomState.phase;
  }, [roomState.phase, roomState.votes]);

  useEffect(() => {
    setEntries(prev => {
      let next = [...prev];

      // Remove entries for users who left or unvoted
      next = next.filter(e =>
        userData[e.socketId] && roomState.votes[e.socketId] !== null && roomState.votes[e.socketId] !== undefined
      );

      // Add entries for newly voted users
      Object.entries(roomState.votes).forEach(([socketId, vote]) => {
        if (vote !== null && vote !== undefined && userData[socketId] && !next.find(e => e.socketId === socketId)) {
          next.push(makePileEntry(socketId, userData[socketId]));
        }
      });

      return next;
    });
  }, [roomState.votes, userData]);

  return (
    <div style={{
      position: 'relative',
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {entries.map(entry => (
        <PileCard
          key={entry.socketId}
          entry={entry}
          vote={roomState.votes[entry.socketId] ?? null}
          phase={roomState.phase}
        />
      ))}
    </div>
  );
}
