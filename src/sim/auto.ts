// Runs games with bots in every seat, as fast as possible. Used by tests, balance sims and the
// menu's background demo. The same loop drives the tutorial, just slowed down by the controller.
import { botDecide } from "../bots/bot.ts";
import { BOT_NAMES, RACES } from "../engine/content.ts";
import { advance, openRequests, submit } from "../engine/game.ts";
import { shuffle } from "../engine/rng.ts";
import { createGame } from "../engine/setup.ts";
import type { Difficulty, GameConfig, GameState, RaceId, Temperament } from "../engine/types.ts";
import { viewFor } from "../engine/view.ts";

export function randomTemperament(r: { rng: number }): Temperament {
  const x = () => { r.rng = (r.rng * 1103515245 + 12345) & 0x7fffffff; return Math.round((r.rng / 0x7fffffff) * 100) / 100; };
  return { greed: x(), loyalty: x(), vengeance: x(), risk: x(), bluff: x() };
}

export function botConfig(seed: number, n: number, opts: { races?: RaceId[]; difficulty?: Difficulty; mandates?: boolean; laws?: boolean } = {}): GameConfig {
  const r = { rng: seed };
  const races = opts.races ?? shuffle(r, RACES.map((x) => x.id)).slice(0, n);
  const names = shuffle(r, [...BOT_NAMES]);
  return {
    seed, maxCycles: 8, swayToWin: 10, mandates: opts.mandates ?? true, laws: opts.laws ?? true,
    seats: races.map((race, i) => ({
      name: names[i], race, controller: "bot", temperament: randomTemperament(r), difficulty: opts.difficulty ?? "officer",
    })),
  };
}

export function runBotGame(config: GameConfig, maxSteps = 20000): GameState {
  const s = createGame(config);
  let steps = 0;
  while (s.phase !== "over") {
    if (++steps > maxSteps) throw new Error(`game did not finish (phase ${s.phase}, cycle ${s.cycle})`);
    for (const req of openRequests(s)) submit(s, req.seat, botDecide(viewFor(s, req.seat), req));
    advance(s);
  }
  return s;
}
