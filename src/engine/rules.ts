// Shared rule queries: adjacency, holdings, Sway, and Clash strength.
//
// Strength is computed by a chain of rule modules (base rules, active Laws, race powers). Each
// module may add receipt lines for a side; the receipt is what the Showtime stage shows, so every
// point is explained. Bots call the same functions on their own view to simulate options.
import { lawParam } from "./content.ts";
import type { Clash, ClashSide, GameState, RaceId, ReceiptLine, Seat } from "./types.ts";

export const NEUTRAL = -1;
/** Defending your own home system is worth this much extra strength. */
export const HOME_GROUND = 2;

export function raceOf(s: GameState, seat: Seat): RaceId {
  return s.seats[seat].race;
}
export function seatOfRace(s: GameState, race: RaceId): Seat | null {
  const x = s.seats.find((p) => p.race === race);
  return x ? x.seat : null;
}

export function neighbours(s: GameState, id: number): number[] {
  const out = new Set(s.adjacency[id]);
  for (const f of s.folds) {
    if (f.cycle !== s.cycle) continue;
    if (f.a === id) out.add(f.b);
    if (f.b === id) out.add(f.a);
  }
  return [...out];
}

export function holders(s: GameState, id: number): Seat[] {
  const sys = s.systems[id];
  return Object.entries(sys.fleets)
    .filter(([k, v]) => Number(k) >= 0 && v > 0)
    .map(([k]) => Number(k));
}
export function holds(s: GameState, seat: Seat, id: number): boolean {
  return (s.systems[id].fleets[seat] ?? 0) > 0;
}
export function heldBy(s: GameState, seat: Seat): number[] {
  return s.systems.filter((x) => (x.fleets[seat] ?? 0) > 0).map((x) => x.id);
}

/** Systems a seat may target with a Vector: adjacent to something it holds, not held by it. */
export function targets(s: GameState, seat: Seat): number[] {
  const mine = heldBy(s, seat);
  const out = new Set<number>();
  for (const id of mine) for (const n of neighbours(s, id)) if (!holds(s, seat, n)) out.add(n);
  return [...out].sort((a, b) => a - b);
}

/** Fleets a seat can send: everything above 1 on each held system. */
export function spareFleets(s: GameState, seat: Seat): number {
  return heldBy(s, seat).reduce((n, id) => n + Math.max(0, s.systems[id].fleets[seat] - 1), 0);
}
export function fleetCap(s: GameState): number {
  return lawParam(s, "cap", 0, 4);
}
export function maxRaises(s: GameState): number {
  return lawParam(s, "raises", 0, 3);
}
export function handLimit(s: GameState, seat: Seat): number {
  return raceOf(s, seat) === "archivists" ? Math.min(5, lawParam(s, "hand", 0, 7)) : lawParam(s, "hand", 0, 7);
}

/** Takes `n` fleets from a seat's systems, richest first, leaving 1 on each. Returns the sources. */
export function drawFleets(s: GameState, seat: Seat, n: number): Record<string, number> {
  const from: Record<string, number> = {};
  let left = n;
  while (left > 0) {
    const ids = heldBy(s, seat).filter((id) => s.systems[id].fleets[seat] > 1);
    if (!ids.length) break;
    ids.sort((a, b) => s.systems[b].fleets[seat] - s.systems[a].fleets[seat] || a - b);
    const id = ids[0];
    s.systems[id].fleets[seat]--;
    from[id] = (from[id] ?? 0) + 1;
    left--;
  }
  return from;
}

/** Sends fleets back to where they came from (if still held), else to the seat's biggest system, else the Drift. */
export function returnFleets(s: GameState, seat: Seat, from: Record<string, number>): void {
  for (const [k, n] of Object.entries(from)) {
    const id = Number(k);
    if (holds(s, seat, id)) s.systems[id].fleets[seat] += n;
    else {
      const mine = heldBy(s, seat).sort((a, b) => s.systems[b].fleets[seat] - s.systems[a].fleets[seat]);
      if (mine.length) s.systems[mine[0]].fleets[seat] += n;
      else s.players[seat].drift += n;
    }
  }
}

export function sway(s: GameState, seat: Seat): number {
  let n = 0;
  for (const sys of s.systems) {
    if ((sys.fleets[seat] ?? 0) <= 0) continue;
    if (sys.home === seat) continue;
    // Shared systems are worth 1 to each holder; an opponent's home held alone is worth 2.
    const shared = Object.entries(sys.fleets).filter(([k, v]) => Number(k) >= 0 && v > 0).length > 1;
    n += sys.home === null || shared ? 1 : 2;
  }
  return n + 2 * s.players[seat].completed.length;
}

// ---- Lattice network ------------------------------------------------------------------------

function components(s: GameState, ids: number[]): number[][] {
  const set = new Set(ids);
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp: number[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const n of neighbours(s, x)) if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
    out.push(comp);
  }
  return out;
}

export function latticeNetwork(s: GameState, seat: Seat): number {
  const comps = components(s, heldBy(s, seat));
  return comps.reduce((m, c) => Math.max(m, c.length), 0);
}

/** Systems whose loss would shrink the Lattice's largest network (they glow on the map). */
export function latticeBridges(s: GameState, seat: Seat): number[] {
  const mine = heldBy(s, seat);
  const best = latticeNetwork(s, seat);
  if (best < 3) return [];
  return mine.filter((id) => {
    const without = mine.filter((x) => x !== id);
    const m = components(s, without).reduce((a, c) => Math.max(a, c.length), 0);
    return m < best - 1;
  });
}

// ---- Strength ---------------------------------------------------------------------------------

export function sideSeats(side: ClashSide): Seat[] {
  return [side.lead, ...side.allies.map((a) => a.seat)].filter((x) => x >= 0) as Seat[];
}

function isDefender(side: ClashSide): boolean {
  return side.role === "defender";
}

export function powerOn(s: GameState, clash: Clash, race: RaceId): boolean {
  return !clash.nulled.includes(race);
}

function seatName(s: GameState, seat: Seat | -1): string {
  return seat < 0 ? "Garrison" : s.seats[seat].name;
}

/**
 * Receipt for one side: every point and where it came from. Only counts what the state shows
 * (unrevealed allies and openings are left out, which is how a view can be evaluated safely).
 */
export function sideReceipt(s: GameState, clash: Clash, idx: number): ReceiptLine[] {
  const side = clash.sides[idx];
  const lines: ReceiptLine[] = [];
  const sys = s.systems[clash.system];

  // Base: fleets (Lattice replaces its fleets with its network size).
  if (side.lead >= 0 && raceOf(s, side.lead) === "lattice" && powerOn(s, clash, "lattice")) {
    lines.push({ label: "Lattice network", value: latticeNetwork(s, side.lead), source: "race:lattice" });
  } else {
    lines.push({ label: `${seatName(s, side.lead)}'s fleets`, value: side.fleets, source: "base" });
  }
  for (const a of side.allies) {
    if (!a.revealed) continue;
    lines.push({ label: `${s.seats[a.seat].name} (ally)`, value: a.fleets, source: "ally" });
  }
  if (side.opening && side.openingRevealed && side.opening.kind === "num") {
    lines.push({ label: "Opening card", value: side.opening.value, source: "card" });
  }
  for (const c of side.cards) if (c.kind === "num") lines.push({ label: "Raise", value: c.value, source: "card" });
  for (const v of side.precedents) lines.push({ label: "PRECEDENT", value: v, source: "race:archivists" });

  // Traits and Laws.
  if (isDefender(side) && sys.trait === "nebula") lines.push({ label: "Nebula", value: 2, source: "trait" });
  if (isDefender(side) && side.lead >= 0 && sys.home === side.lead) lines.push({ label: "Home ground", value: HOME_GROUND, source: "base" });
  if (isDefender(side) && side.lead >= 0) {
    const b = lawParam(s, "home", 0, 0);
    if (b) lines.push({ label: "Home Turf (Law)", value: b, source: "law:home" });
  }
  const ud = lawParam(s, "underdog", 0, 0);
  if (ud && clash.sides.length >= 2) {
    const fleetsOf = (x: ClashSide) => x.fleets + x.allies.filter((a) => a.revealed).reduce((n, a) => n + a.fleets, 0);
    const mine = fleetsOf(side);
    if (clash.sides.every((o, j) => j === idx || fleetsOf(o) > mine)) lines.push({ label: "Underdog (Law)", value: ud, source: "law:underdog" });
  }

  // Race powers.
  if (side.late && side.lead >= 0 && powerOn(s, clash, "lastword")) lines.push({ label: "Arrived late", value: -2, source: "race:lastword" });
  if (side.lead >= 0 && raceOf(s, side.lead) === "adored" && powerOn(s, clash, "adored")) {
    const pro = clash.bets.filter((b) => b.side === idx).length;
    const con = clash.bets.filter((b) => b.side !== idx).length;
    if (pro || con) lines.push({ label: "The crowd", value: pro - con, source: "race:adored" });
  }
  // Branded: +1 to every side fighting against a Branded lead.
  clash.sides.forEach((o, j) => {
    if (j === idx || o.lead < 0) return;
    if (s.players[o.lead].branded >= s.cycle) lines.push({ label: `${s.seats[o.lead].name} is Branded`, value: 1, source: "betrayal" });
  });
  return lines;
}

export function sideTotal(s: GameState, clash: Clash, idx: number): number {
  return sideReceipt(s, clash, idx).reduce((n, l) => n + l.value, 0);
}

/** True if `a` counts as ahead of `b` when their totals are equal. */
export function winsTie(s: GameState, clash: Clash, a: number, b: number): boolean {
  const word = s.laws.find((l) => l.id === "ties")?.word ?? "defender";
  const ra = clash.sides[a].role, rb = clash.sides[b].role;
  if (ra === rb) return false;
  return ra === word;
}
