// Dev-only: simulates a distinct duplicate of your real user per tab, so
// multiple tabs under one login act as multiple players with no manual setup.
// Generated fresh in memory on module load, not sessionStorage: Chrome's
// "duplicate tab" clones sessionStorage into the new tab, which would make the
// duplicate resolve to the same simulated user as the tab it came from. An
// in-memory value can't be inherited that way — each tab load re-runs this
// module and draws its own id.
const randomDevUser = Math.random().toString(36).slice(2, 8);

export function getDevUser(): string | null {
  return import.meta.env.DEV ? randomDevUser : null;
}
