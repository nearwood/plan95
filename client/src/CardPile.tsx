import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { PlayingCard } from './PlayingCard';
import {
  Avatar, ExitCard, CascadeCanvas, seeded, hashStr,
  EXIT_ANIMS, EXIT_DURATION,
  type PileEntry, type ExitState,
} from './PileExitAnimations';

interface UserData {
  [socketId: string]: { name: string; picture: string | null };
}

interface RoomState {
  phase: 'voting' | 'revealed';
  votes: Record<string, string | null>;
}

// Fire a celebratory confetti burst centered over the given element.
function fireConsensusConfetti(rect: DOMRect | null) {
  const origin = rect
    ? { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight }
    : { x: 0.5, y: 0.5 };
  confetti({ particleCount: 120, spread: 70, startVelocity: 45, origin, zIndex: 9999 });
  setTimeout(() => confetti({ particleCount: 60, spread: 110, startVelocity: 35, origin, zIndex: 9999 }), 150);
}

function makePileEntry(socketId: string, user: { name: string; picture: string | null }, vote: string): PileEntry {
  const seed = Math.abs(hashStr(socketId));
  const side = Math.floor(seeded(seed, 0, 0, 4)); // 0=left,1=right,2=top,3=bottom
  const startX = side === 0 ? -500 : side === 1 ? 500 : seeded(seed, 1, -200, 200);
  const startY = side === 2 ? -400 : side === 3 ? 400 : seeded(seed, 2, -150, 150);
  return {
    socketId,
    picture: user.picture,
    name: user.name,
    vote,
    pileAngle: seeded(seed, 3, -18, 18),
    pileX: seeded(seed, 4, -28, 28),
    pileY: seeded(seed, 5, -20, 20),
    startX,
    startY,
    flipDelay: seeded(seed, 6, 0, 280),
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
      <div style={{ position: 'relative', width: 71, height: 96, perspective: 700 }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          transformStyle: 'preserve-3d',
          transform: phase === 'revealed' ? 'rotateY(180deg)' : 'rotateY(0deg)',
          transition: 'transform 0.5s cubic-bezier(0.2, 0.7, 0.3, 1.2)',
          transitionDelay: phase === 'revealed' ? `${entry.flipDelay}ms` : '0ms',
        }}>
          {/* Back face — shown while face-down */}
          <PlayingCard
            faceDown
            style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
          />
          {/* Front face — pre-rotated 180° so it reads correctly after the flip */}
          <PlayingCard
            value={vote ?? undefined}
            style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          />
        </div>
        <Avatar picture={entry.picture} name={entry.name} />
      </div>
    </div>
  );
}

export function CardPile({ userData, roomState }: { userData: UserData; roomState: RoomState }) {
  const [entries, setEntries] = useState<PileEntry[]>([]);
  const [exiting, setExiting] = useState<ExitState | null>(null);
  const prevPhaseRef = useRef(roomState.phase);
  const confettiPhaseRef = useRef(roomState.phase);
  const exitKeyRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // On reset (revealed -> voting with all votes cleared), sweep the placed
    // cards off the table with a randomly chosen retro exit animation.
    const allNull = Object.values(roomState.votes).every(v => v === null);
    if (roomState.phase === 'voting' && prevPhaseRef.current === 'revealed' && allNull) {
      if (entries.length > 0) {
        const anim = EXIT_ANIMS[Math.floor(Math.random() * EXIT_ANIMS.length)];
        setExiting({ entries, anim, duration: EXIT_DURATION[anim], key: exitKeyRef.current++ });
      }
      setEntries([]);
    }
    prevPhaseRef.current = roomState.phase;
  }, [roomState.phase, roomState.votes, entries]);

  // Keep the exit layer mounted only for its animation's lifetime.
  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => setExiting(null), exiting.duration);
    return () => clearTimeout(t);
  }, [exiting]);

  // A fresh vote means the next round has begun — kill any in-flight exit
  // animation so the new card is the only thing on the table.
  useEffect(() => {
    if (exiting && entries.length > 0) setExiting(null);
  }, [entries, exiting]);

  useEffect(() => {
    // Celebrate consensus on the voting -> revealed transition.
    if (roomState.phase === 'revealed' && confettiPhaseRef.current === 'voting') {
      // Users who never voted don't count against consensus — only compare
      // among those who actually cast a vote.
      const castVotes = Object.keys(userData)
        .map(id => roomState.votes[id])
        .filter((v): v is string => v != null);
      const consensus = castVotes.length > 0 && castVotes.every(v => v === castVotes[0]);
      if (consensus) {
        // Wait for the staggered flips (max delay + flip duration) before the burst.
        const t = setTimeout(() => fireConsensusConfetti(containerRef.current?.getBoundingClientRect() ?? null), 280 + 500);
        confettiPhaseRef.current = roomState.phase;
        return () => clearTimeout(t);
      }
    }
    confettiPhaseRef.current = roomState.phase;
  }, [roomState.phase, roomState.votes, userData]);

  useEffect(() => {
    setEntries(prev => {
      let next = [...prev];

      // Remove entries for users who left or unvoted
      next = next.filter(e =>
        userData[e.socketId] && roomState.votes[e.socketId] !== null && roomState.votes[e.socketId] !== undefined
      );

      // Keep stored vote in sync with the current (non-null) vote
      next = next.map(e => ({ ...e, vote: roomState.votes[e.socketId] ?? e.vote }));

      // Add entries for newly voted users
      Object.entries(roomState.votes).forEach(([socketId, vote]) => {
        if (vote !== null && vote !== undefined && userData[socketId] && !next.find(e => e.socketId === socketId)) {
          next.push(makePileEntry(socketId, userData[socketId], vote));
        }
      });

      return next;
    });
  }, [roomState.votes, userData]);

  return (
    <div ref={containerRef} style={{
      position: 'relative',
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {/* Exit animation layer (behind live cards, torn down when a new vote lands) */}
      {exiting && exiting.anim === 'cascade' && (
        <CascadeCanvas key={exiting.key} entries={exiting.entries} />
      )}
      {exiting && exiting.anim !== 'cascade' && exiting.entries.map((entry, i) => (
        <ExitCard key={`${exiting.key}-${entry.socketId}`} entry={entry} anim={exiting.anim as 'sweep' | 'blast'} index={i} />
      ))}

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
