// The watchable tutorial: a bot-only game seen through one player's eyes (Nova, the Amenders),
// narrated with short lessons the first time each idea shows up, plus the thoughts of your own bot.
import { raceDef } from "../engine/content.ts";
import type { Decision, GameConfig, GameEvent, GameState, Request, Seat } from "../engine/types.ts";

export type Lesson = { id: string; title: string; text: string; pause: boolean };
export type Thought = { cycle: number; kind: string; text: string };

export const TUTORIAL_SEAT = 0;

export function tutorialConfig(): GameConfig {
  return {
    seed: TUTORIAL_SEED, maxCycles: 8, swayToWin: 10, mandates: false, laws: true, tutorial: true,
    seats: [
      { name: "Nova", race: "amenders", controller: "bot", difficulty: "admiral", temperament: { greed: 0.5, loyalty: 0.6, vengeance: 0.4, risk: 0.5, bluff: 0.3 } },
      { name: "Kael", race: "lastword", controller: "bot", difficulty: "officer", temperament: { greed: 0.7, loyalty: 0.3, vengeance: 0.6, risk: 0.7, bluff: 0.5 } },
      { name: "Orro", race: "recurrent", controller: "bot", difficulty: "officer", temperament: { greed: 0.4, loyalty: 0.7, vengeance: 0.3, risk: 0.4, bluff: 0.2 } },
      { name: "Vess", race: "adored", controller: "bot", difficulty: "officer", temperament: { greed: 0.6, loyalty: 0.5, vengeance: 0.5, risk: 0.6, bluff: 0.6 } },
    ],
  };
}

// Picked by scripts/pick-tutorial-seed.ts for a game that shows most ideas.
export const TUTORIAL_SEED = 28;

const L = (id: string, title: string, text: string, pause = true): Lesson => ({ id, title, text, pause });

const PHASE_LESSONS: Record<string, Lesson> = {
  dawn: L("dawn", "Dawn", "Every Cycle starts here. Each player gains 1 Influence (+1 per Rich system ◆), up to 2 destroyed fleets come back from the Drift, and everyone draws 2 cards."),
  plan: L("plan", "Plan", "Everyone secretly picks one Vector at the same time: a target system next to one they hold, and up to 4 fleets. You can't see the others' choices yet."),
  convergence: L("convergence", "Convergence", "All Vectors appear at once. The arrows on the map are this Cycle's fight card: every Clash that is about to happen."),
  council: L("council", "Council", "The loud phase. Fighters ask for allies in public and offer Influence for help. Anyone can propose a truce. Watch the feed on the right."),
  showtime: L("showtime", "Showtime", "Pledges are sealed. Now the Clashes play out one at a time, smallest first, while everyone watches. Players who aren't fighting may bet on each one."),
  reckoning: L("reckoning", "Reckoning", "Systems change hands and Sway is counted: 1 per neutral system, 2 per opponent home you hold alone, 1 for any shared system. First to 10 Sway wins; otherwise the best score after Cycle 8."),
};

const EVENT_LESSONS: Record<string, (e: GameEvent, s: GameState) => Lesson | null> = {
  amend: () => L("amend", "Your power: amend a Law", `${raceDef("amenders").name}: ${raceDef("amenders").power} ${raceDef("amenders").tell} Look at the Law chips in the top bar.`),
  lastword: (e) => e.text.includes("ALARM") ? L("lastword", "The Last Word", `Kael's race chooses its Vector after seeing everyone else's. ${raceDef("lastword").tell}`) : null,
  ally: () => L("ally", "Allies flip", "Secret pledges are revealed one by one. If the attacker wins, its allies co-hold the system with it. If the defender wins, each defending ally earns 1 Influence per fleet.", false),
  opening: () => L("opening", "Opening cards", "Each fighter's face-down card flips. The receipt under each side shows exactly where every point comes from.", false),
  raise: () => L("raise", "The Raise", "Now the side that is behind must play another card face up, or fold. Ties count the defender as ahead. Each side can raise 3 times, and every card played is spent, win or lose. Read their hand size before you commit!"),
  fold: () => L("fold", "Folding", "Folding ends the Clash for that side. Knowing when to fold saves cards for later fights.", false),
  bet: () => L("bet", "The betting book", "Players outside a Clash may bet up to 2 Influence on a side. The winners split the pool. Allies can only back their own side.", false),
  rewind: () => L("rewind", "REWIND", `${raceDef("recurrent").name}: ${raceDef("recurrent").power} ${raceDef("recurrent").tell}`),
  truce: () => L("truce", "Truces", "Two players agreed not to attack each other for 2 Cycles. Breaking a truce is possible, but it's a public BETRAYAL: the breaker pays 3 Influence and is Branded (+1 for anyone fighting them).", false),
  betrayal: () => L("betrayal", "BETRAYAL", "A truce was broken! The traitor paid 3 Influence to the victim and is Branded until the end of next Cycle."),
  result: () => L("result", "The result", "The winner takes (or keeps) the system. The losing side's fleets go to the Drift and come back slowly at Dawn.", false),
  parley: () => L("parley", "Parley", "A Parley card opens a deal. If both sides play it, they can agree to share the system or have the attacker leave. Alone, it means backing off and collecting Salvage.", false),
  null: () => L("null", "NULL", "A Null card, played as a raise, switches off one race power for the rest of this Clash.", false),
  pay: () => L("pay", "Deals are enforced", "The ally pledged, so the promised Influence was paid automatically. Online strangers can trust payments; promises about the future can still be broken.", false),
};

export class Tutor {
  seen = new Set<string>();
  queue: Lesson[] = [];
  thoughts: Thought[] = [];
  pauseOnLessons = true;
  private lastEvent = -1;
  private intro = false;

  get current(): Lesson | null {
    return this.queue[0] ?? null;
  }
  /** True while a pausing lesson is open (the controller waits). */
  get blocking(): boolean {
    return this.pauseOnLessons && !!this.current?.pause;
  }
  dismiss(): void {
    this.queue.shift();
  }

  private push(l: Lesson | null): void {
    if (!l || this.seen.has(l.id)) return;
    this.seen.add(l.id);
    this.queue.push(l);
  }

  observe(s: GameState): void {
    if (!this.intro) {
      this.intro = true;
      this.push(L("intro", "Welcome to EXCEPTION", "You're watching a full game played by bots, through the eyes of one player: Nova, playing The Amenders (cyan). That's you for this game, played by a bot. You only see what Nova sees: your own hand and secrets, nobody else's. Every alien race breaks or bends one rule. Lessons pop up the first time something new happens; use the controls above to pause, speed up or step."));
      this.push(L("laws", "Laws", "Three Laws are active (top bar, hover to read). Laws change the rules for everyone, and your race, the Amenders, can rewrite them.", false));
    }
    for (const e of s.events) {
      if (e.n <= this.lastEvent) continue;
      if (e.only && !e.only.includes(TUTORIAL_SEAT)) continue;
      const phase = e.type === "phase" ? (e.data?.phase as string | undefined) : undefined;
      if (phase && PHASE_LESSONS[phase]) this.push(PHASE_LESSONS[phase]);
      const f = EVENT_LESSONS[e.type];
      if (f) this.push(f(e, s));
      if (e.type === "clash" && e.text.includes("garrison")) this.push(L("garrison", "Neutral garrisons", "Unclaimed systems are defended by a garrison of fleets and a hidden card drawn from the deck. The garrison never raises.", false));
      if (e.type === "over") this.push(L("over", "That's a full game!", "You've seen every phase: plan together, then watch together. Ready to try it yourself? Start a Solo game from the menu, or keep watching to read the final board."));
    }
    this.lastEvent = s.events.length ? s.events[s.events.length - 1].n : this.lastEvent;
  }

  onDecision(seat: Seat, req: Request, d: Decision, cycle: number): void {
    if (seat !== TUTORIAL_SEAT || !d.why) return;
    this.thoughts.push({ cycle, kind: req.kind, text: d.why });
  }
}
