import { describe, expect, it } from "vitest";
import { RACES } from "../src/engine/content.ts";
import { botConfig, runBotGame } from "../src/sim/auto.ts";
import type { GameState } from "../src/engine/types.ts";
import { createGame } from "../src/engine/setup.ts";
import { advance, openRequests, submit } from "../src/engine/game.ts";
import { botDecide } from "../src/bots/bot.ts";
import { viewFor } from "../src/engine/view.ts";

function totalFleets(s: GameState, seat: number): number {
  let n = s.players[seat].drift;
  for (const sys of s.systems) n += sys.fleets[seat] ?? 0;
  for (const v of s.vectors) if (v.seat === seat && !s.clashes.find((c) => c.system === v.target && c.resolved)) n += 0;
  return n;
}

describe("bot-only games", () => {
  it("finish without errors for many seeds and seat counts", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const n = 3 + (seed % 4);
      const s = runBotGame(botConfig(seed, n));
      expect(s.winners?.length).toBeGreaterThan(0);
      expect(s.cycle).toBeLessThanOrEqual(8);
    }
  });

  it("conserve fleets at every Dawn (nothing appears or vanishes)", () => {
    for (let seed = 100; seed < 115; seed++) {
      const s = createGame(botConfig(seed, 4));
      const start = s.players.map((p) => totalFleets(s, p.seat));
      let guard = 0;
      while (s.phase !== "over" && guard++ < 20000) {
        for (const req of openRequests(s)) submit(s, req.seat, botDecide(viewFor(s, req.seat), req));
        const wasDawn = s.phase === "dawn" && !s.pending.length;
        if (wasDawn && s.cycle > 0) {
          // Between cycles no fleets are in transit.
          s.players.forEach((p) => expect(totalFleets(s, p.seat)).toBe(start[p.seat]));
        }
        advance(s);
      }
    }
  });

  it("uses every race at least once and their powers fire", () => {
    const fired = new Set<string>();
    for (let seed = 200; seed < 260; seed++) {
      const s = runBotGame(botConfig(seed, 5));
      for (const e of s.events) fired.add(e.type);
    }
    for (const t of ["amend", "lastword", "rewind", "echo", "fold-space", "precedent", "tithed", "audit", "betrayal", "null", "ally", "bet", "mandate"]) {
      expect(fired, t).toContain(t);
    }
    expect(RACES.length).toBe(10);
  });

  it("is deterministic for a seed", () => {
    const a = runBotGame(botConfig(7, 4));
    const b = runBotGame(botConfig(7, 4));
    expect(a.events.map((e) => e.text)).toEqual(b.events.map((e) => e.text));
  });
});

describe("views", () => {
  it("hide other hands and secret pledges", () => {
    const s = createGame(botConfig(3, 4));
    const v = viewFor(s, 0);
    expect(v.players[1].hand.every((c) => c.id === -1)).toBe(true);
    expect(v.players[0].hand.every((c) => c.id !== -1)).toBe(true);
    expect(v.rng).toBe(0);
  });
});
