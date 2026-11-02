// Drives a game: decides who answers each Request (local player, bot, remote player), enforces
// timers, and paces automatic steps so people can watch. The engine itself has no clock.
import { botDecide } from "../bots/bot.ts";
import { advance, openRequests, submit } from "../engine/game.ts";
import type { Decision, GameState, Request, Seat } from "../engine/types.ts";
import { viewFor } from "../engine/view.ts";

export type Driver = "local" | "bot" | "remote";

export type ControllerOptions = {
  drivers: Driver[];
  timers: boolean;          // live timers for human seats; a missed deadline is played by the seat's bot
  speed?: number;           // 1 = normal watch speed
  botThinkMs?: number;      // how long bots "think" before answering (scaled by speed)
};

export class Controller {
  state: GameState;
  drivers: Driver[];
  autopilot: boolean[];
  timers: boolean;
  speed: number;
  paused = false;
  botThinkMs: number;
  /** Called after any state change. */
  onChange: (s: GameState) => void = () => {};
  /** Called when a bot answers for a seat (the tutorial narrates this). */
  onBotDecision: (seat: Seat, req: Request, d: Decision) => void = () => {};
  /** Optional gate: return false to hold the game (e.g. the tutorial waiting on a lesson). */
  canProceed: () => boolean = () => true;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;
  private seenReq = new Map<number, number>(); // request id -> time first seen

  constructor(state: GameState, opts: ControllerOptions) {
    this.state = state;
    this.drivers = opts.drivers;
    this.autopilot = opts.drivers.map(() => false);
    this.timers = opts.timers;
    this.speed = opts.speed ?? 1;
    this.botThinkMs = opts.botThinkMs ?? 450;
  }

  start(): void {
    if (this.timer) return;
    this.schedule(0);
  }
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  isBot(seat: Seat): boolean {
    return this.drivers[seat] === "bot" || this.autopilot[seat];
  }

  /** A local or remote player answers. Returns false if there was nothing to answer. */
  submit(seat: Seat, d: Decision): boolean {
    const ok = submit(this.state, seat, d);
    if (ok) { this.changed(); this.schedule(0); }
    return ok;
  }

  setDriver(seat: Seat, d: Driver): void {
    this.drivers[seat] = d;
    this.schedule(0);
  }
  setAutopilot(seat: Seat, on: boolean): void {
    this.autopilot[seat] = on;
    this.schedule(0);
  }
  setSpeed(x: number): void { this.speed = x; this.schedule(0); }
  setPaused(p: boolean): void { this.paused = p; if (!p) this.schedule(0); this.changed(); }
  /** Run exactly one automatic step (used by the tutorial's Step button while paused). */
  stepOnce(): void { this.tick(true); }

  changed(): void { this.onChange(this.state); }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(false), Math.max(0, ms));
  }

  private tick(force: boolean): void {
    this.timer = null;
    const s = this.state;
    if (s.phase === "over") { this.changed(); return; }
    if ((this.paused && !force) || !this.canProceed()) { this.schedule(250); return; }
    const now = Date.now();
    if (!force && now < this.nextAt) { this.schedule(this.nextAt - now); return; }

    const open = openRequests(s);
    if (open.length) {
      let waitFor = Infinity;
      let changed = false;
      for (const r of open) {
        if (!this.seenReq.has(r.id)) {
          this.seenReq.set(r.id, now);
          if (this.timers && !this.isBot(r.seat)) { r.deadline = now + r.seconds * 1000; changed = true; }
        }
        const seen = this.seenReq.get(r.id)!;
        if (this.isBot(r.seat)) {
          const due = seen + this.botThinkMs / this.speed;
          if (force || now >= due) { this.answerWithBot(r); changed = true; }
          else waitFor = Math.min(waitFor, due - now);
        } else if (r.deadline && now >= r.deadline) {
          this.answerWithBot(r); // missed deadline: the seat's bot plays it, not a dumb default
          changed = true;
        } else if (r.deadline) {
          waitFor = Math.min(waitFor, r.deadline - now);
        }
      }
      if (changed) this.changed();
      if (!openRequests(s).length) this.schedule(0);
      else this.schedule(Math.min(waitFor === Infinity ? 1000 : waitFor, 1000));
      return;
    }

    advance(s);
    this.nextAt = Date.now() + (s.delay || 60) / this.speed;
    this.changed();
    if (!force) this.schedule((s.delay || 60) / this.speed);
  }

  private answerWithBot(r: Request): void {
    const d = botDecide(viewFor(this.state, r.seat), r);
    if (submit(this.state, r.seat, d)) this.onBotDecision(r.seat, r, d);
  }
}
