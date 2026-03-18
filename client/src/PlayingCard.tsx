import React from 'react';
import cardBack from '/cardback.png';
import cardFaces from '/win95cards.png';

const CARD_W = 71;
const CARD_H = 96;

// [col, row] in the 4×13 sprite sheet (Hearts, Clubs, Diamonds, Spades)
const POKER_CARD_MAP: Record<string, [number, number]> = {
  '1':  [0, 0],   // Ace of Hearts
  '2':  [0, 1],   // 2 of Hearts
  '3':  [0, 2],   // 3 of Hearts
  '5':  [0, 4],   // 5 of Hearts
  '8':  [0, 7],   // 8 of Hearts
  '13': [0, 12],  // King of Hearts
  '?':  [3, 10],  // Jack of Spades
  '☕': [0, 11],  // Queen of Hearts
};

interface PlayingCardProps {
  value?: string;
  faceDown?: boolean;
  selected?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function PlayingCard({ value, faceDown = false, selected = false, onClick, style }: PlayingCardProps) {
  const baseStyle: React.CSSProperties = {
    width: CARD_W,
    height: CARD_H,
    display: 'inline-block',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
    outline: selected ? '3px solid #ffff00' : '3px solid transparent',
    outlineOffset: '2px',
    ...style,
  };

  // Empty placeholder — no vote yet
  if (!value && !faceDown) {
    return (
      <div style={{
        ...baseStyle,
        border: '2px dashed #555',
        boxSizing: 'border-box',
        background: 'rgba(0,0,0,0.15)',
      }} />
    );
  }

  if (faceDown) {
    return (
      <div
        onClick={onClick}
        style={{
          ...baseStyle,
          backgroundImage: `url(${cardBack})`,
        }}
      />
    );
  }

  const [col, row] = POKER_CARD_MAP[value!] || [0, 0];
  return (
    <div
      onClick={onClick}
      style={{
        ...baseStyle,
        backgroundImage: `url(${cardFaces})`,
        backgroundPosition: `-${col * CARD_W}px -${row * CARD_H}px`,
      }}
    />
  );
}
