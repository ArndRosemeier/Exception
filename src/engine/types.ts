// Core data types. Everything in GameState is plain JSON so it can be cloned, sent over the
// network (GameHub) and replayed. Behaviour lives in rule modules (rules.ts, races/, laws.ts),
// which are looked up from ids stored in the state.

export type Seat = number;
export type Trait = "rich" | "shipyard" | "nebula" | "anomaly";

export type RaceId =
  | "amenders" | "lastword" | "recurrent" | "undertow" | "adored"
  | "lattice" | "foldwrights" | "archivists" | "tithe" | "murmur";

export type Temperament = {
  greed: number;      // 0..1 values Influence and Sway grabs
  loyalty: number;    // 0..1 keeps truces, backs allies who paid
  vengeance: number;  // 0..1 punishes betrayers and attackers
  risk: number;       // 0..1 attacks into uncertainty, raises deep
  bluff: number;      // 0..1 opens weak, parleys, lies
};
export type Difficulty = "cadet" | "officer" | "admiral";

export type SeatInfo = {
  seat: Seat;
  name: string;
  race: RaceId;
  color: string;
  controller: "bot" | "human";
  hubId?: number;            // GameHub player id when a human plays this seat remotely
  temperament: Temperament;  // used whenever a bot plays this seat (also on autopilot / timeout)
  difficulty: Difficulty;
};

export type System = {
  id: number;
  name: string;
  x: number; y: number;       // 0..1000 map coordinates
  trait: Trait | null;
  home: Seat | null;          // whose home system it is (null = neutral)
  fleets: Record<string, number>; // seat -> fleets here; "-1" = neutral garrison
};

export type CardKind = "num" | "parley" | "null";
export type Card = { id: number; kind: CardKind; value: number };

export type PlayerState = {
  seat: Seat;
  influence: number;
  hand: Card[];
  drift: number;              // destroyed fleets waiting to come back
  mandates: string[];         // kept mandates (secret)
  mandateOffer: string[];     // dealt at start, keep 2
  completed: string[];        // completed mandates (public)
  branded: number;            // Branded until end of this cycle number (0 = not)
  stats: { attackWins: number; defendWins: number; allyWins: number; betsWon: number; folds: number };
  usedThisCycle: Record<string, number>; // power uses
  actsLast: number;           // Recurrent: acts last in this cycle
};

export type LawInstance = { id: string; params: number[]; word?: string };

export type Vector = { seat: Seat; target: number; fleets: number; from: Record<string, number>; late?: boolean };

export type Truce = { a: Seat; b: Seat; until: number }; // lasts through cycle `until`

export type Ask = { clash: number; from: Seat; to: Seat; offer: number };
export type Pledge = { clash: number; seat: Seat; side: number; fleets: number; from: Record<string, number> };

export type RaiseEntry = { side: number; kind: "card" | "fold" | "null" | "precedent" | "rewind"; value?: number; card?: Card; target?: RaceId; note?: string };

export type ClashSide = {
  lead: Seat | -1;            // -1 = neutral garrison
  role: "attacker" | "defender";
  fleets: number;             // lead's committed fleets
  allies: { seat: Seat; fleets: number; revealed: boolean }[];
  opening: Card | null;
  openingRevealed: boolean;
  cards: Card[];              // raise cards played face up (opening excluded)
  precedents: number[];       // archivist ghost cards
  raises: number;
  folded: boolean;
  late?: boolean;
};

export type Clash = {
  id: number;
  system: number;
  sides: ClashSide[];
  headOn: boolean;
  nulled: RaceId[];           // powers switched off for this clash
  log: RaiseEntry[];
  rewound: boolean;
  resolved: boolean;
  winner: number | null;      // side index, null = tie / nobody
  bets: { seat: Seat; side: number; amount: number }[];
  parley?: { choices: Record<string, string> };
  receipt?: { side: number; lines: ReceiptLine[]; total: number }[];
};

export type ReceiptLine = { label: string; value: number; source: string };

export type Echo = { owner: Seat; system: number; effect: EchoEffect; fireOn: number; id: number };
export type EchoEffect = "destroy" | "steal" | "cancel" | "discard";

export type Lie = { system: number; preset: "empty" | "double" | "plus3"; target: Seat | "all"; id: number };

export type Fold = { a: number; b: number; cycle: number };

export type Phase =
  | "mandates" | "dawn" | "summit" | "power" | "plan" | "convergence" | "lastword"
  | "ask" | "pledge" | "showtime" | "reckoning" | "over";

export type ShowBeat = "bets" | "allies" | "openings" | "parley" | "raise" | "resolve" | "done";

export type GameEvent = {
  n: number;                  // sequence number
  cycle: number;
  type: string;               // e.g. "phase", "betrayal", "law-edit", "echo", "rewind"
  text: string;               // human-readable line for the feed
  seats?: Seat[];             // involved seats
  only?: Seat[];              // if set, only these seats may see the event
  data?: Record<string, unknown>;
  loud?: boolean;             // a moment the table should notice (staged in the UI)
};

// ---- Decisions ---------------------------------------------------------------------------

export type RequestKind =
  | "mandates" | "power" | "plan" | "lastword" | "ask" | "pledge" | "bet" | "raise"
  | "rewind" | "parley" | "summit";

export type Request = {
  id: number;
  seat: Seat;
  kind: RequestKind;
  clash?: number;             // for bet / raise / rewind / parley
  deadline?: number;          // ms since epoch, set by the controller when timers are on
  seconds: number;            // nominal time allowed (live play)
};

export type PlanDecision = {
  kind: "plan";
  target: number | null;
  fleets: number;
  echo?: { system: number; effect: EchoEffect; delay: number };
  lies?: { system: number; preset: Lie["preset"]; target: Seat | "all" }[];
  tithe?: RaceId[];
  why?: string;
};
export type PowerDecision = {
  kind: "power";
  amend?: { law: number; param: number; value: number } | { law: number; word: string } | null;
  fold?: { a: number; b: number } | null;
  why?: string;
};
export type AskDecision = {
  kind: "ask";
  asks: { clash: number; to: Seat; offer: number }[];
  truces: Seat[];             // propose a truce (2 cycles) to these seats
  why?: string;
};
export type PledgeDecision = {
  kind: "pledge";
  pledges: { clash: number; side: number; fleets: number }[];
  openings: { clash: number; card: number | null }[]; // card id
  acceptTruces: Seat[];
  audit?: number | null;      // system id to audit (Murmur)
  why?: string;
};
export type BetDecision = { kind: "bet"; side: number | null; amount: number; why?: string };
export type RaiseDecision = { kind: "raise"; action: "card" | "fold" | "null" | "precedent"; card?: number; target?: RaceId; value?: number; why?: string };
export type RewindDecision = { kind: "rewind"; rewind: boolean; why?: string };
export type ParleyDecision = { kind: "parley"; choice: "cohold" | "withdraw"; why?: string };
export type SummitDecision = { kind: "summit"; law: number; replace: number; bid: number; why?: string };
export type MandatesDecision = { kind: "mandates"; keep: string[]; why?: string };
export type LastWordDecision = { kind: "lastword"; target: number | null; fleets: number; why?: string };

export type Decision =
  | PlanDecision | PowerDecision | AskDecision | PledgeDecision | BetDecision | RaiseDecision
  | RewindDecision | ParleyDecision | SummitDecision | MandatesDecision | LastWordDecision;

export type GameConfig = {
  seed: number;
  seats: Omit<SeatInfo, "seat" | "color">[];
  maxCycles: number;
  swayToWin: number;
  mandates: boolean;
  laws: boolean;
  tutorial?: boolean;
};

export type GameState = {
  version: 1;
  config: GameConfig;
  seats: SeatInfo[];
  rng: number;                // RNG state
  nextId: number;
  cycle: number;
  phase: Phase;
  systems: System[];
  adjacency: number[][];      // system id -> neighbours
  players: PlayerState[];
  deck: Card[];
  discard: Card[];
  publicPlayed: { seat: Seat; value: number; cycle: number }[]; // number cards played face up
  laws: LawInstance[];
  summitOffer: LawInstance[];
  vectors: Vector[];
  truces: Truce[];
  proposals: { from: Seat; to: Seat }[];
  asks: Ask[];
  pledges: Pledge[];
  clashes: Clash[];
  show: { order: number[]; idx: number; beat: ShowBeat } | null;
  echoes: Echo[];
  lies: Lie[];
  folds: Fold[];
  titheWatch: RaceId[];
  titheUsed: number;
  pending: Request[];
  answers: Record<string, Decision>;
  events: GameEvent[];
  winners: Seat[] | null;
  delay: number;              // suggested pause (ms) before the next automatic step
};

// What a seat may see. Same shape as GameState with hidden parts removed or replaced.
export type View = GameState & { viewer: Seat | null };
