import { useEffect, useRef } from 'react';

import pokerchip1 from './assets/pokerchips/pokerchip1.png';
import pokerchip2 from './assets/pokerchips/pokerchip2.png';
import pokerchip3 from './assets/pokerchips/pokerchip3.png';
import pokerchip4 from './assets/pokerchips/pokerchip4.png';

// Each color variant is its own selectable cursor; a session picks one and
// every chip in its group renders using that same image.
export const CHIP_CURSOR_IMAGES = [pokerchip1, pokerchip2, pokerchip3, pokerchip4];

// Each chip trails the cursor at its own easing speed and sits at a fixed
// pixel offset plus a small independent wobble, so the group stretches out
// when moving and settles into an uneven little pile at rest instead of
// sliding around as one rigid unit.
const CHIP_COUNT = 4;
const CHIPS = Array.from({ length: CHIP_COUNT }, (_, i) => {
  const angle = (i / CHIP_COUNT) * Math.PI * 2 + i * 0.6;
  const radius = 12 + i * 5;
  return {
    ease: 0.07 + i * 0.045,
    offsetX: Math.cos(angle) * radius,
    offsetY: Math.sin(angle) * radius,
    wobbleFreq: 1.1 + i * 0.35,
    wobblePhase: i * 2.1,
    wobbleAmp: 2 + i * 1.2,
  };
});

interface ChipsCursorFollowerProps {
  x: number; // fraction (0-1) of the containing table's width
  y: number; // fraction (0-1) of the containing table's height
  image: string; // the single chip color used for every chip in the group
  visible: boolean;
}

export function ChipsCursorFollower({ x, y, image, visible }: ChipsCursorFollowerProps) {
  const targetRef = useRef({ x, y });
  const chipElsRef = useRef<(HTMLImageElement | null)[]>([]);
  const posRef = useRef(CHIPS.map(() => ({ x, y })));

  useEffect(() => {
    targetRef.current = { x, y };
  }, [x, y]);

  useEffect(() => {
    const start = performance.now();

    let frame = requestAnimationFrame(function tick(now) {
      const t = (now - start) / 1000;
      const target = targetRef.current;

      CHIPS.forEach((chip, i) => {
        const pos = posRef.current[i];
        pos.x += (target.x - pos.x) * chip.ease;
        pos.y += (target.y - pos.y) * chip.ease;

        const el = chipElsRef.current[i];
        if (!el) return;

        const wobbleX = Math.cos(t * chip.wobbleFreq + chip.wobblePhase) * chip.wobbleAmp;
        const wobbleY = Math.sin(t * chip.wobbleFreq * 0.8 + chip.wobblePhase) * chip.wobbleAmp;

        el.style.left = `${pos.x * 100}%`;
        el.style.top = `${pos.y * 100}%`;
        el.style.transform = `translate(calc(-50% + ${chip.offsetX + wobbleX}px), calc(-50% + ${chip.offsetY + wobbleY}px))`;
      });

      frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      {CHIPS.map((_, i) => (
        <img
          key={i}
          ref={(el) => {
            chipElsRef.current[i] = el;
          }}
          className='chipFollower'
          src={image}
          alt=''
          style={{ visibility: visible ? 'visible' : 'hidden' }}
        />
      ))}
    </>
  );
}
