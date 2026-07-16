export const POKER_VALUES = ['1', '2', '3', '5', '8', '13', '?', '☕'];

export const NUMERIC_POKER_VALUES = POKER_VALUES.filter(v => v !== '?' && v !== '☕').map(Number);

export const nearestCardValue = (avg: number): string =>
  NUMERIC_POKER_VALUES.reduce((closest, v) => Math.abs(v - avg) < Math.abs(closest - avg) ? v : closest).toString();
