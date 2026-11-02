// Seeded RNG (mulberry32). The state lives in GameState.rng, so a game replays exactly from its seed.
import type { GameState } from "./types.ts";

export function nextRandom(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(s: { rng: number }, n: number): number {
  return Math.floor(nextRandom(s) * n);
}

export function pick<T>(s: { rng: number }, list: T[]): T {
  return list[randInt(s, list.length)];
}

export function shuffle<T>(s: { rng: number }, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function newId(state: GameState): number {
  return state.nextId++;
}
