import { POKER_VALUES } from './pokerValues';

export type Scenario = 'unanimous' | 'spread' | 'outlier';

export const SCENARIOS: Scenario[] = ['unanimous', 'spread', 'outlier'];

// Non-numeric values ('?', coffee) aren't useful filler for bot votes.
const VALUE_POOL = POKER_VALUES.filter(v => v !== '?' && v !== '☕');

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomValue(): string {
  return VALUE_POOL[Math.floor(Math.random() * VALUE_POOL.length)];
}

// Computes votes for a fresh batch of `count` bots that need one this round.
// Recomputed per round, so results vary even with the same scenario picked.
export function computeRoundVotes(scenario: Scenario, count: number): string[] {
  switch (scenario) {
    case 'unanimous': {
      const value = randomValue();
      return Array(count).fill(value);
    }
    case 'spread': {
      const pool = shuffled(VALUE_POOL);
      return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
    }
    case 'outlier': {
      const majority = randomValue();
      const votes = Array(count).fill(majority);
      if (count >= 2) {
        const otherValues = VALUE_POOL.filter(v => v !== majority);
        const outlierIndex = Math.floor(Math.random() * count);
        votes[outlierIndex] = otherValues[Math.floor(Math.random() * otherValues.length)];
      }
      return votes;
    }
  }
}
