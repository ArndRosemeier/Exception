// Per-seat views. A seat (human screen or bot) only ever gets the view, never the full state, so
// bots cannot cheat: difficulty comes from skill, not from extra information.
import type { Card, GameState, Seat, View } from "./types.ts";

const HIDDEN: Card = { id: -1, kind: "num", value: 0 };

export function viewFor(full: GameState, viewer: Seat | null): View {
  const s = structuredClone(full) as View;
  s.viewer = viewer;
  s.rng = 0;
  s.deck = s.deck.map(() => HIDDEN);

  for (const p of s.players) {
    if (p.seat === viewer) continue;
    p.hand = p.hand.map(() => HIDDEN);
    p.mandates = p.mandates.map(() => "?");
    p.mandateOffer = [];
  }

  // Vectors are secret until Convergence.
  if (s.phase === "plan" || s.phase === "power" || s.phase === "summit" || s.phase === "dawn") {
    s.vectors = s.vectors.filter((v) => v.seat === viewer);
  }
  // Pledges stay secret until the allies flip; openings until they are revealed.
  s.pledges = s.pledges.filter((p) => p.seat === viewer || isRevealed(full, p.clash, p.seat));
  for (const c of s.clashes) {
    for (const side of c.sides) {
      side.allies = side.allies.filter((a) => a.revealed || a.seat === viewer);
      if (!side.openingRevealed && side.lead !== viewer) side.opening = side.opening ? HIDDEN : null;
    }
  }
  // Only your own answers; only your own Echoes; Tithe's watch list is secret.
  const mine = new Set(s.pending.filter((r) => r.seat === viewer).map((r) => String(r.id)));
  s.answers = Object.fromEntries(Object.entries(s.answers).filter(([k]) => mine.has(k)));
  s.echoes = s.echoes.filter((e) => e.owner === viewer);
  if (viewer === null || s.seats[viewer]?.race !== "tithe") s.titheWatch = [];

  // The Murmur's lies change what you see.
  const murmur = s.seats.find((x) => x.race === "murmur")?.seat;
  if (murmur !== undefined && murmur !== viewer) {
    for (const lie of full.lies) {
      if (lie.target !== "all" && lie.target !== viewer) continue;
      const sys = s.systems[lie.system];
      const real = sys.fleets[murmur] ?? 0;
      if (real <= 0) continue;
      sys.fleets[murmur] = lie.preset === "empty" ? 0 : lie.preset === "double" ? real * 2 : real + 3;
      if (sys.fleets[murmur] === 0) sys.fleets[murmur] = 0.0001; // still "held" (shown as 0) so the map stays honest about ownership
    }
  }
  if (murmur !== viewer) s.lies = [];

  s.events = s.events.filter((e) => !e.only || (viewer !== null && e.only.includes(viewer)));
  return s;
}

function isRevealed(full: GameState, clashId: number, seat: Seat): boolean {
  const c = full.clashes.find((x) => x.id === clashId);
  return !!c?.sides.some((side) => side.allies.some((a) => a.seat === seat && a.revealed));
}

/** What a spectator of a finished or bot-only game may see: everything. */
export function omniscientView(full: GameState): View {
  const s = structuredClone(full) as View;
  s.viewer = null;
  return s;
}
