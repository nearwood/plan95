import { useEffect, useRef, useState } from 'react';
import { PlayingCard, POKER_CARD_MAP, CARD_W, CARD_H } from './PlayingCard';
import cardFaces from '/win95cards.png';

export interface PileEntry {
  socketId: string;
  picture: string | null;
  name: string;
  vote: string;
  pileAngle: number;
  pileX: number;
  pileY: number;
  startX: number;
  startY: number;
  flipDelay: number;
}

export type ExitAnim = 'cascade' | 'sweep' | 'blast';

export interface ExitState {
  entries: PileEntry[];
  anim: ExitAnim;
  duration: number;
  key: number;
}

// The three retro exit animations, and how long to keep their layer mounted.
// Kept at/under the 3s ceiling so a stale animation never lingers.
export const EXIT_ANIMS: ExitAnim[] = ['cascade', 'sweep', 'blast'];
export const EXIT_DURATION: Record<ExitAnim, number> = { cascade: 3000, sweep: 1300, blast: 1000 };

// Sprite sheet used to draw cards onto the cascade canvas (matches PlayingCard's CSS).
const faceImg = new Image();
faceImg.src = cardFaces;

export function seeded(seed: number, index: number, min: number, max: number): number {
  const x = Math.sin(seed * 9301 + index * 49297 + 233720) * 10000;
  const r = x - Math.floor(x);
  return min + r * (max - min);
}

export function hashStr(str: string): number {
  return str.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
}

// Small avatar/initial badge shared by the live pile and the exiting cards.
export function Avatar({ picture, name }: { picture: string | null; name: string }) {
  const base = {
    position: 'absolute' as const,
    bottom: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.8)',
  };
  return picture ? (
    <img src={picture} alt={name} title={name} style={{ ...base, objectFit: 'cover' }} />
  ) : (
    <div title={name} style={{
      ...base,
      background: '#555',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontSize: 12,
      fontWeight: 'bold',
    }}>
      {name?.[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

// A single card animating out via the CSS-driven 'sweep' or 'blast' exits.
// Starts at its resting pile pose (face-up) and transitions to an off-table pose.
export function ExitCard({ entry, anim, index }: { entry: PileEntry; anim: 'sweep' | 'blast'; index: number }) {
  const [go, setGo] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setGo(true)));
  }, []);

  const rest = `rotate(${entry.pileAngle}deg) translate(${entry.pileX}px, ${entry.pileY}px)`;
  const seed = Math.abs(hashStr(entry.socketId));

  let target = rest;
  let transition = 'none';

  if (anim === 'sweep') {
    // Everyone slides down-left as if scooped back into the dealer's deck.
    const delay = index * 45;
    const dur = 650;
    target = `translate(-560px, 380px) rotate(${entry.pileAngle - 140}deg)`;
    transition = `transform ${dur}ms cubic-bezier(0.5, 0, 0.75, 0) ${delay}ms, opacity 200ms linear ${delay + dur - 150}ms`;
  } else {
    // Blast: fly radially outward from center with a big spin, all at once.
    const ang = seeded(seed, 7, 0, Math.PI * 2);
    const dist = 780;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    const spin = (seeded(seed, 8, 0, 1) < 0.5 ? -1 : 1) * seeded(seed, 9, 360, 900);
    const dur = 750;
    target = `translate(${dx}px, ${dy}px) rotate(${entry.pileAngle + spin}deg)`;
    transition = `transform ${dur}ms cubic-bezier(0.15, 0.6, 0.4, 1), opacity 350ms linear ${dur - 350}ms`;
  }

  return (
    <div style={{
      position: 'absolute',
      transform: go ? target : rest,
      opacity: go ? 0 : 1,
      transition: go ? transition : 'none',
    }}>
      <div style={{ position: 'relative', width: 71, height: 96 }}>
        <PlayingCard value={entry.vote} style={{ position: 'absolute', inset: 0 }} />
        <Avatar picture={entry.picture} name={entry.name} />
      </div>
    </div>
  );
}

// Solitaire-style victory cascade: cards bounce off the floor under gravity,
// smearing trails across the table because the canvas is never cleared.
export function CascadeCanvas({ entries }: { entries: PileEntry[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const W = parent.clientWidth;
    const H = parent.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const halfW = CARD_W / 2;
    const halfH = CARD_H / 2;
    const g = 2000; // px/s²

    const cards = entries.map((e, i) => {
      const seed = Math.abs(hashStr(e.socketId));
      const dir = seeded(seed, 10, 0, 1) < 0.5 ? -1 : 1;
      const [col, row] = POKER_CARD_MAP[e.vote] || [0, 0];
      return {
        x: W / 2 + e.pileX,
        y: H / 2 + e.pileY,
        vx: dir * seeded(seed, 11, 90, 260),
        vy: -seeded(seed, 12, 120, 320),
        angle: (e.pileAngle * Math.PI) / 180,
        col,
        row,
        launch: i * 120, // staggered ms
        done: false,
      };
    });

    let raf = 0;
    const start = performance.now();
    let last = start;

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.032);
      last = now;
      const elapsed = now - start;

      for (const c of cards) {
        if (elapsed >= c.launch && !c.done) {
          c.vy += g * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          if (c.y + halfH > H) {
            c.y = H - halfH;
            c.vy = -c.vy * 0.72;
            c.vx *= 0.96;
          }
          if (c.x < -CARD_W || c.x > W + CARD_W) c.done = true;
        }
        if (faceImg.complete) {
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(c.angle);
          ctx.drawImage(faceImg, c.col * CARD_W, c.row * CARD_H, CARD_W, CARD_H, -halfW, -halfH, CARD_W, CARD_H);
          ctx.restore();
        }
      }

      if (elapsed < 3000) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => cancelAnimationFrame(raf);
  }, [entries]);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
}
