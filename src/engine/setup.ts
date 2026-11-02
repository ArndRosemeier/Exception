// Creates a new galaxy: map, deck, starting hands, Laws and Mandates.
import { LAWS, MANDATES, SEAT_COLORS, STAR_NAMES, newLaw } from "./content.ts";
import { shuffle } from "./rng.ts";
import type { Card, GameConfig, GameState, PlayerState, System, Trait } from "./types.ts";

function buildDeck(): Card[] {
  // Number cards 1..8 (more low cards than high), plus Parley and Null.
  const counts = [0, 4, 5, 5, 5, 5, 4, 3, 3];
  const cards: Card[] = [];
  let id = 1;
  for (let v = 1; v <= 8; v++) for (let i = 0; i < counts[v]; i++) cards.push({ id: id++, kind: "num", value: v });
  for (let i = 0; i < 4; i++) cards.push({ id: id++, kind: "parley", value: 0 });
  for (let i = 0; i < 4; i++) cards.push({ id: id++, kind: "null", value: 0 });
  return cards;
}

export function createGame(config: GameConfig): GameState {
  const n = config.seats.length;
  if (n < 2 || n > 6) throw new Error("2 to 6 seats");
  const s: GameState = {
    version: 1, config, rng: config.seed | 0 || 1, nextId: 1000, cycle: 0, phase: "mandates",
    seats: config.seats.map((x, i) => ({ ...x, seat: i, color: SEAT_COLORS[i] })),
    systems: [], adjacency: [], players: [], deck: [], discard: [], publicPlayed: [],
    laws: [], summitOffer: [], vectors: [], truces: [], proposals: [], asks: [], pledges: [], clashes: [],
    show: null, echoes: [], lies: [], folds: [], titheWatch: [], titheUsed: 0, pending: [], answers: {},
    events: [], winners: null, delay: 0,
  };

  // ---- Map: each seat has 3 home systems on an outer ring; one neutral per seat on an inner ring.
  const names = shuffle(s, [...STAR_NAMES]);
  const sys: System[] = [];
  const add = (x: number, y: number, home: number | null, trait: Trait | null): number => {
    const id = sys.length;
    sys.push({ id, name: names[id], x: Math.round(x), y: Math.round(y), trait, home, fleets: {} });
    return id;
  };
  const C = 500;
  const homes: number[][] = [];
  const neutrals: number[] = [];
  const neutralTraits = shuffle(s, ["rich", "shipyard", "nebula", "anomaly", "rich", "nebula"] as Trait[]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const spread = 0.62 / Math.max(1, n / 4);
    const outer = add(C + 430 * Math.cos(a), C + 430 * Math.sin(a), i, null);
    const left = add(C + 330 * Math.cos(a - spread), C + 330 * Math.sin(a - spread), i, "rich");
    const right = add(C + 330 * Math.cos(a + spread), C + 330 * Math.sin(a + spread), i, null);
    homes.push([outer, left, right]);
  }
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
    neutrals.push(add(C + 190 * Math.cos(a), C + 190 * Math.sin(a), null, neutralTraits[i % neutralTraits.length]));
  }
  const adj: Set<number>[] = sys.map(() => new Set<number>());
  const link = (a: number, b: number) => { adj[a].add(b); adj[b].add(a); };
  for (let i = 0; i < n; i++) {
    const [outer, left, right] = homes[i];
    link(outer, left); link(outer, right); link(left, right);
    const next = (i + 1) % n;
    link(right, neutrals[i]);                       // neutral between seat i and i+1
    link(left, neutrals[(i - 1 + n) % n]);          // neutral between seat i-1 and i
    link(right, homes[next][1]);                    // border with the next seat
    link(neutrals[i], neutrals[next]);              // inner ring
  }
  s.systems = sys;
  s.adjacency = adj.map((x) => [...x].sort((a, b) => a - b));

  // Starting fleets: 4 on each home, 3 neutral garrison fleets on each neutral.
  for (let i = 0; i < n; i++) for (const h of homes[i]) sys[h].fleets[i] = 4;
  for (const id of neutrals) sys[id].fleets["-1"] = 3;

  // ---- Deck, hands, players.
  s.deck = shuffle(s, buildDeck());
  s.nextId = 1000;
  const mandatePool = shuffle(s, MANDATES.map((m) => m.id));
  for (let i = 0; i < n; i++) {
    const p: PlayerState = {
      seat: i, influence: 3, hand: [], drift: 0, mandates: [], mandateOffer: [], completed: [], branded: 0,
      stats: { attackWins: 0, defendWins: 0, allyWins: 0, betsWon: 0, folds: 0 }, usedThisCycle: {}, actsLast: 0,
    };
    for (let k = 0; k < 5; k++) p.hand.push(s.deck.pop()!);
    if (config.mandates) p.mandateOffer = [0, 1, 2, 3].map((k) => mandatePool[(i * 4 + k) % mandatePool.length]);
    s.players.push(p);
  }

  // ---- Laws: 3 active from the pool (the tutorial uses gentle ones so the Amenders have something to edit).
  if (config.laws || config.tutorial) {
    const pool = config.tutorial ? ["home", "spoils", "cap"] : shuffle(s, LAWS.map((l) => l.id)).slice(0, 3);
    s.laws = pool.map(newLaw);
  }
  return s;
}
