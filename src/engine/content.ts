// Static content: Laws, Mandates, races (text), names and colours.
import type { GameState, LawInstance, RaceId, Seat, Trait } from "./types.ts";

// ---- Laws ----------------------------------------------------------------------------------
// Every Law has numeric parameters with a legal range (and optionally a swappable word), so the
// Amenders' edits form a small, enumerable list.
export type LawDef = {
  id: string;
  name: string;
  params: { label: string; min: number; max: number; start: number }[];
  words?: string[];
  text: (p: number[], word?: string) => string;
};

export const LAWS: LawDef[] = [
  { id: "home", name: "Home Turf", params: [{ label: "bonus", min: 0, max: 4, start: 2 }],
    text: (p) => `Defenders get +${p[0]} strength.` },
  { id: "ties", name: "Tiebreak", params: [], words: ["defender", "attacker"],
    text: (_p, w) => `Tied totals count the ${w ?? "defender"} as ahead.` },
  { id: "cap", name: "Fleet Cap", params: [{ label: "fleets", min: 2, max: 6, start: 4 }],
    text: (p) => `A Vector may carry at most ${p[0]} fleets.` },
  { id: "tax", name: "War Tax", params: [{ label: "cost", min: 0, max: 3, start: 1 }],
    text: (p) => `Each Vector costs ${p[0]} Influence (if you have it).` },
  { id: "salvage", name: "Salvage", params: [{ label: "per fleet", min: 0, max: 2, start: 1 }],
    text: (p) => `Losing fighters get ${p[0]} Influence per fleet lost.` },
  { id: "boom", name: "Boom Times", params: [{ label: "extra", min: 0, max: 3, start: 1 }],
    text: (p) => `Rich systems pay +${p[0]} extra Influence.` },
  { id: "docks", name: "Repair Docks", params: [{ label: "fleets", min: 0, max: 3, start: 1 }],
    text: (p) => `Everyone recovers ${p[0]} extra fleets per Cycle.` },
  { id: "hand", name: "Hand Limit", params: [{ label: "cards", min: 4, max: 9, start: 7 }],
    text: (p) => `Hand limit is ${p[0]} cards.` },
  { id: "spoils", name: "Spoils of War", params: [{ label: "Influence", min: 0, max: 4, start: 2 }],
    text: (p) => `Winning attackers gain ${p[0]} Influence.` },
  { id: "underdog", name: "Underdog", params: [{ label: "bonus", min: 0, max: 3, start: 1 }],
    text: (p) => `The side with fewer fleets gets +${p[0]}.` },
  { id: "raises", name: "Raise Limit", params: [{ label: "raises", min: 1, max: 5, start: 3 }],
    text: (p) => `Each side may raise ${p[0]} times.` },
];

export function lawDef(id: string): LawDef {
  const d = LAWS.find((l) => l.id === id);
  if (!d) throw new Error("unknown law " + id);
  return d;
}

export function newLaw(id: string): LawInstance {
  const d = lawDef(id);
  return { id, params: d.params.map((p) => p.start), word: d.words?.[0] };
}

export function lawText(l: LawInstance): string {
  return lawDef(l.id).text(l.params, l.word);
}

/** Value of a law parameter, or `fallback` if that law is not active. */
export function lawParam(state: GameState, id: string, idx: number, fallback: number): number {
  const l = state.laws.find((x) => x.id === id);
  return l ? l.params[idx] : fallback;
}
export function lawActive(state: GameState, id: string): boolean {
  return state.laws.some((x) => x.id === id);
}

// ---- Mandates ------------------------------------------------------------------------------
export type MandateDef = { id: string; name: string; text: string; check: (s: GameState, seat: Seat) => boolean };

const held = (s: GameState, seat: Seat) => s.systems.filter((x) => (x.fleets[seat] ?? 0) > 0);

export const MANDATES: MandateDef[] = [
  { id: "rich2", name: "Tycoon", text: "Hold 3 Rich systems.", check: (s, p) => held(s, p).filter((x) => x.trait === "rich").length >= 3 },
  { id: "nebula", name: "Fog Lord", text: "Hold a Nebula and a Shipyard.", check: (s, p) => held(s, p).some((x) => x.trait === "nebula") && held(s, p).some((x) => x.trait === "shipyard") },
  { id: "invader", name: "Invader", text: "Hold home systems of 2 different opponents.", check: (s, p) => new Set(held(s, p).filter((x) => x.home !== null && x.home !== p).map((x) => x.home)).size >= 2 },
  { id: "conqueror", name: "Conqueror", text: "Win 3 Clashes as the attacker.", check: (s, p) => s.players[p].stats.attackWins >= 3 },
  { id: "guardian", name: "Guardian", text: "Win 3 Clashes as the defender.", check: (s, p) => s.players[p].stats.defendWins >= 3 },
  { id: "friend", name: "Good Friend", text: "Be on the winning side of 3 Clashes as an ally.", check: (s, p) => s.players[p].stats.allyWins >= 3 },
  { id: "banker", name: "Banker", text: "End a Cycle with 12 Influence.", check: (s, p) => s.players[p].influence >= 12 },
  { id: "sprawl", name: "Sprawl", text: "Hold 7 systems.", check: (s, p) => held(s, p).length >= 7 },
  { id: "gambler", name: "Gambler", text: "Win 4 bets.", check: (s, p) => s.players[p].stats.betsWon >= 4 },
  { id: "variety", name: "Collector", text: "Hold systems with all 4 traits.", check: (s, p) => new Set(held(s, p).map((x) => x.trait).filter(Boolean)).size >= 4 },
];

export function mandateDef(id: string): MandateDef {
  const d = MANDATES.find((m) => m.id === id);
  if (!d) throw new Error("unknown mandate " + id);
  return d;
}

// ---- Races ---------------------------------------------------------------------------------
export type RaceDef = { id: RaceId; name: string; short: string; power: string; tell: string; loud: string; hue: number };

export const RACES: RaceDef[] = [
  { id: "amenders", name: "The Amenders", short: "Amenders", hue: 200,
    power: "Once per Cycle, edit one number or word in an active Law.",
    tell: "Edits are public and bind them too.",
    loud: "The Law card visibly rewritten." },
  { id: "lastword", name: "The Last Word", short: "Last Word", hue: 0,
    power: "Chooses its Vector after everyone else's are revealed.",
    tell: "−2 strength for arriving late, and everyone sees exactly where it lands.",
    loud: "Their arrow lands last, with an alarm." },
  { id: "recurrent", name: "The Recurrent", short: "Recurrent", hue: 280,
    power: "Once per Cycle, when losing a Clash it's in, REWIND it to the start of the Raise. Everyone gets their cards back.",
    tell: "Each opponent in that Clash draws 1 card.",
    loud: "A full-screen REWIND." },
  { id: "undertow", name: "The Undertow", short: "Undertow", hue: 170,
    power: "Each Cycle, plant a sealed Echo on any system that goes off 1 to 3 Cycles later (destroy 2 fleets, steal 2 Influence, cancel truces, or discard 2 cards).",
    tell: "A tremor warns nearby players the Cycle before. Whoever holds the system then is hit, even the Undertow.",
    loud: "The Echo erupts at Dawn." },
  { id: "adored", name: "The Adored", short: "Adored", hue: 330,
    power: "+1 strength for each player who bet on them.",
    tell: "−1 for each player who bet against them.",
    loud: "The crowd meter fills or drains as bets land." },
  { id: "lattice", name: "The Lattice", short: "Lattice", hue: 50,
    power: "Its fleets don't add strength. Instead it adds the size of its largest connected group of systems.",
    tell: "Can't be an ally (its ships never leave the web), and its bridge systems glow for everyone.",
    loud: "The network shattering when a bridge falls." },
  { id: "foldwrights", name: "The Foldwrights", short: "Foldwrights", hue: 120,
    power: "Once per Cycle, fold space so two distant systems touch for that Cycle.",
    tell: "The fold is public and anyone can use it.",
    loud: "The map visibly folds." },
  { id: "archivists", name: "The Archivists", short: "Archivists", hue: 30,
    power: "Once per Cycle, as a raise, replay a faded copy (−2) of any number card their current opponent played face up earlier in the game.",
    tell: "Hand limit of 5, and a precedent costs half its value (rounded up) in Influence.",
    loud: "A ghost card: PRECEDENT." },
  { id: "tithe", name: "The Tithe", short: "Tithe", hue: 90,
    power: "Each Cycle, secretly watch 2 races. The first time a watched power fires, its owner pays the Tithe 2 Influence or the power fizzles.",
    tell: "No combat bonus, and every stamp tells the table who to gang up on.",
    loud: "The TITHED stamp across someone's big play." },
  { id: "murmur", name: "The Murmur", short: "Murmur", hue: 250,
    power: "Keeps up to 2 lies about its fleet counts (show empty, double, or +3), to everyone or one player.",
    tell: "Anyone may pay 2 Influence to Audit a system. A caught lie pays the auditor 3; a wrong Audit pays the Murmur 2.",
    loud: "The Audit showdown: LIAR, or a smug grin." },
];

export function raceDef(id: RaceId): RaceDef {
  return RACES.find((r) => r.id === id)!;
}

export const SEAT_COLORS = ["#4fd1c5", "#f6ad55", "#b794f4", "#fc8181", "#68d391", "#63b3ed"];

export const STAR_NAMES = [
  "Kestrel", "Vey", "Orro", "Thule", "Marrow", "Cinder", "Halcyon", "Ibex", "Juno", "Lumen", "Mire",
  "Nadir", "Opal", "Pyre", "Quill", "Rook", "Sable", "Tarn", "Umbra", "Vesper", "Wren", "Xi", "Yarrow",
  "Zephyr", "Aster", "Brine", "Corvus", "Dross", "Ember", "Fable", "Gloam", "Hollow", "Isle", "Jinx",
];

export const BOT_NAMES = [
  "Kael", "Orro", "Vess", "Tamsin", "Quorra", "Dex", "Ilyx", "Brannoc", "Sefa", "Mirelle", "Zund", "Pell",
];

export const TRAIT_INFO: Record<Trait, { name: string; text: string; icon: string }> = {
  rich: { name: "Rich", text: "+1 Influence per Cycle to each holder", icon: "◆" },
  shipyard: { name: "Shipyard", text: "Holders recover 1 extra fleet per Cycle", icon: "⚓" },
  nebula: { name: "Nebula", text: "Defender +2", icon: "☁" },
  anomaly: { name: "Anomaly", text: "A small random event when someone takes it", icon: "✦" },
};
