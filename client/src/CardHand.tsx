import { useState } from 'react';
import { PlayingCard } from './PlayingCard';
import { POKER_VALUES } from './pokerValues';

const ANGLES = [-21, -15, -9, -3, 3, 9, 15, 21];
const OVERLAP = 18;       // px cards overlap each other
const BASE_PUSH = 37;     // px of each card hidden below container
const ARC_FACTOR = 1.3;   // side cards pushed down more to form arc
const LIFT = 40;          // px card lifts on hover/select

interface CardHandProps {
  myVote: string | null;
  onVote: (value: string) => void;
}

export function CardHand({ myVote, onVote }: CardHandProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingTop: LIFT + 10,
      overflow: 'hidden',
    }}>
      {POKER_VALUES.map((value, i) => {
        const angle = ANGLES[i];
        const arcPush = Math.abs(angle) * ARC_FACTOR;
        const isSelected = myVote === value;
        const isHovered = hovered === value;
        const lift = isSelected || isHovered ? LIFT : 0;
        const yOffset = BASE_PUSH + arcPush - lift;

        return (
          <div
            key={value}
            style={{
              marginLeft: i === 0 ? 0 : -OVERLAP,
              transform: `rotate(${angle}deg) translateY(${yOffset}px)`,
              transformOrigin: 'bottom center',
              transition: 'transform 0.15s ease',
              cursor: 'pointer',
              zIndex: isHovered || isSelected ? 20 : i < 4 ? i : 7 - i,
            }}
            onMouseEnter={() => setHovered(value)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onVote(value)}
          >
            <PlayingCard value={value} />
          </div>
        );
      })}
    </div>
  );
}
