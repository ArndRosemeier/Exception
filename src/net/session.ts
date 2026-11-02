// Multiplayer on GameHub (games.futuremagic.de, see ArndRosemeier/gameserver).
//
// Host-authoritative, turn-based pattern (gameserver docs/PATTERNS.md §4): the host runs the engine
// and the Controller, and publishes the whole state with setState after each change. Players send
// only their decisions to the host. If the host leaves, GameHub promotes another player, who
// continues from the replicated state; seats of players who left are played by bots (hot-swap),
// and a player who comes back under the same name gets their seat back.
//
// Caveat: every client receives the full state and the UI shows only that seat's view. That is fine
// among friends, but a determined player could read hidden cards from devtools. Sending per-seat
// views instead would break host migration; revisit if this is ever played competitively.
import { Controller } from "../app/controller.ts";
import type { Driver } from "../app/controller.ts";
import { BOT_NAMES, RACES } from "../engine/content.ts";
import { shuffle } from "../engine/rng.ts";
import { ev } from "../engine/game.ts";
import { createGame } from "../engine/setup.ts";
import type { Decision, Difficulty, GameConfig, GameState, RaceId, Seat } from "../engine/types.ts";
import { randomTemperament } from "../sim/auto.ts";
import { connect } from "./gamehub.ts";
import type { GameHub, RoomSummary } from "./gamehub.ts";

export const PROTOCOL = 1;

const env = import.meta.env ?? {};
export const HUB = {
  url: env.VITE_GAMEHUB_URL || "https://games.futuremagic.de",
  app: env.VITE_GAMEHUB_APP || "exception",
  // App keys are not secrets: a browser game ships its key anyway (see gameserver/README.md).
  key: env.VITE_GAMEHUB_KEY || "ghk_exception_BYW-iCQQbrrZ5bSwSd7ZNkbzFlxADq_F",
};
export function hubConfigured(): boolean {
  return !!HUB.key;
}

export type LobbySettings = { count: number; difficulty: Difficulty; mandates: boolean };
export type LobbyState = {
  type: "lobby";
  protocol: number;
  players: { hubId: number; name: string; race: RaceId | "random" }[];
  settings: LobbySettings;
};
export type GameShared = { type: "game"; protocol: number; state: GameState; formerHumans: string[] };
export type Shared = LobbyState | GameShared;
export type Msg =
  | { type: "decide"; reqId: number; decision: Decision }
  | { type: "race"; race: RaceId | "random" }
  | { type: "settings"; settings: Partial<LobbySettings> };

export class NetSession {
  readonly hub: GameHub<Shared, never, Msg>;
  shared: Shared | null = null;
  ctl: Controller | null = null;
  error: string | null = null;
  onChange: () => void = () => {};
  private lastSent = 0;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(name: string, connectFn: typeof connect = connect) {
    this.hub = connectFn<Shared, never, Msg>({ url: HUB.url, app: HUB.app, appKey: HUB.key, name });
    const hub = this.hub;
    hub.on("state", (s) => {
      if (hub.isHost && this.ctl) return;
      this.shared = s;
      this.onChange();
    });
    hub.on("joined", () => {
      if (hub.isHost && !this.shared) {
        this.shared = { type: "lobby", protocol: PROTOCOL, players: [], settings: { count: 4, difficulty: "officer", mandates: true } };
        this.syncLobby();
      }
      this.onChange();
    });
    hub.on("player+", (p) => {
      if (!hub.isHost) return;
      if (this.shared?.type === "lobby") this.syncLobby();
      else if (this.shared?.type === "game" && this.ctl) this.reclaim(p.id, p.name);
    });
    hub.on("player-", (id) => {
      if (!hub.isHost) return;
      if (this.shared?.type === "lobby") this.syncLobby();
      else if (this.shared?.type === "game" && this.ctl) this.dropToBot(id);
    });
    hub.on("msg", (m, from) => { if (hub.isHost) this.handle(m, from); });
    hub.on("host", (id) => { if (id === hub.you) this.takeOver(); });
    hub.on("need-snapshot", () => { if (hub.isHost) this.publish(true); });
    hub.on("error", (e) => { this.error = e.code; this.onChange(); });
    hub.on("close", () => { this.error = this.error ?? "disconnected"; this.onChange(); });
  }

  get ready() { return this.hub.ready; }
  get isHost() { return this.hub.isHost; }
  get you() { return this.hub.you; }
  get roomCode() { return this.hub.room?.id ?? null; }

  create(name: string): Promise<RoomSummary> {
    return this.hub.create({ name, public: true, maxPlayers: 6, meta: { protocol: PROTOCOL } });
  }
  join(code: string): Promise<RoomSummary> { return this.hub.join(code.toUpperCase()); }
  watchLobby(fn: (rooms: RoomSummary[]) => void): () => void { return this.hub.watchLobby(fn); }
  close(): void { this.ctl?.stop(); this.hub.close(); }

  /** The seat this client plays, if any. */
  mySeat(): Seat | null {
    if (this.shared?.type !== "game") return null;
    const s = this.shared.state.seats.find((x) => x.hubId === this.hub.you && x.controller === "human");
    return s ? s.seat : null;
  }
  state(): GameState | null {
    if (this.ctl) return this.ctl.state;
    return this.shared?.type === "game" ? this.shared.state : null;
  }

  // ---- player actions ---------------------------------------------------------------------

  decide(reqId: number, decision: Decision): void {
    if (this.hub.isHost) this.handle({ type: "decide", reqId, decision }, this.hub.you!);
    else if (this.hub.host !== null) this.hub.send({ type: "decide", reqId, decision }, this.hub.host);
  }
  chooseRace(race: RaceId | "random"): void {
    if (this.hub.isHost) this.handle({ type: "race", race }, this.hub.you!);
    else if (this.hub.host !== null) this.hub.send({ type: "race", race }, this.hub.host);
  }
  setSettings(settings: Partial<LobbySettings>): void {
    if (this.hub.isHost) this.handle({ type: "settings", settings }, this.hub.you!);
  }

  /** Host: start the game with everyone in the room; bots fill the empty seats. */
  start(): void {
    if (!this.hub.isHost || this.shared?.type !== "lobby") return;
    const lobby = this.shared;
    const seed = (Date.now() % 1000000) + 1;
    const r = { rng: seed };
    const humans = lobby.players.slice(0, 6);
    const n = Math.max(humans.length, Math.min(6, Math.max(3, lobby.settings.count)));
    const taken = new Set(humans.map((h) => h.race).filter((x) => x !== "random"));
    const pool = shuffle(r, RACES.map((x) => x.id).filter((x) => !taken.has(x)));
    const names = shuffle(r, BOT_NAMES.filter((b) => !humans.some((h) => h.name === b)));
    const seats: GameConfig["seats"] = [];
    for (let i = 0; i < n; i++) {
      const h = humans[i];
      const race = h && h.race !== "random" ? h.race : pool.pop()!;
      seats.push({
        name: h ? h.name : names[i], race, controller: h ? "human" : "bot", hubId: h?.hubId,
        difficulty: lobby.settings.difficulty, temperament: randomTemperament(r),
      });
    }
    const config: GameConfig = { seed, maxCycles: 8, swayToWin: 10, mandates: lobby.settings.mandates, laws: true, seats };
    const state = createGame(config);
    this.shared = { type: "game", protocol: PROTOCOL, state, formerHumans: humans.map((h) => h.name) };
    this.hub.setRoom({ public: false });
    this.runController(state);
  }

  // ---- host internals --------------------------------------------------------------------

  private syncLobby(): void {
    if (this.shared?.type !== "lobby") return;
    const present = this.hub.players;
    const old = new Map(this.shared.players.map((p) => [p.hubId, p]));
    this.shared.players = present.map((p) => old.get(p.id) ?? { hubId: p.id, name: p.name || "Player", race: "random" });
    this.publish(true);
    this.onChange();
  }

  private handle(m: Msg, from: number): void {
    if (!m || typeof m !== "object") return;
    if (m.type === "race" && this.shared?.type === "lobby") {
      const p = this.shared.players.find((x) => x.hubId === from);
      const valid = m.race === "random" || RACES.some((r) => r.id === m.race);
      const clash = m.race !== "random" && this.shared.players.some((x) => x.hubId !== from && x.race === m.race);
      if (p && valid && !clash) p.race = m.race;
      this.publish(true);
      this.onChange();
    } else if (m.type === "settings" && this.shared?.type === "lobby" && from === this.hub.you) {
      Object.assign(this.shared.settings, m.settings);
      this.publish(true);
      this.onChange();
    } else if (m.type === "decide" && this.ctl) {
      const seat = this.ctl.state.seats.find((s) => s.hubId === from && s.controller === "human");
      if (!seat) return;
      const req = this.ctl.state.pending.find((r) => r.id === m.reqId && r.seat === seat.seat);
      if (!req || m.decision?.kind !== req.kind) return;
      this.ctl.submit(seat.seat, m.decision);
    }
  }

  private runController(state: GameState): void {
    const present = new Set(this.hub.players.map((p) => p.id));
    const drivers: Driver[] = state.seats.map((s) => {
      if (s.controller !== "human" || s.hubId === undefined) return "bot";
      if (s.hubId === this.hub.you) return "local";
      return present.has(s.hubId) ? "remote" : "bot";
    });
    // Seats whose players are gone are played by bots from now on.
    state.seats.forEach((s, i) => { if (drivers[i] === "bot" && s.controller === "human") { s.controller = "bot"; s.hubId = undefined; } });
    this.ctl?.stop();
    const ctl = new Controller(state, { drivers, timers: true, botThinkMs: 600 });
    ctl.onChange = () => { this.publish(false); this.onChange(); };
    this.ctl = ctl;
    ctl.start();
    this.publish(true);
    this.onChange();
  }

  private takeOver(): void {
    if (this.shared?.type === "game") this.runController(this.shared.state);
    else if (this.shared?.type === "lobby") this.syncLobby();
    else {
      this.shared = { type: "lobby", protocol: PROTOCOL, players: [], settings: { count: 4, difficulty: "officer", mandates: true } };
      this.syncLobby();
    }
  }

  private dropToBot(hubId: number): void {
    const s = this.ctl!.state.seats.find((x) => x.hubId === hubId);
    if (!s) return;
    s.controller = "bot";
    s.hubId = undefined;
    this.ctl!.setDriver(s.seat, "bot");
    ev(this.ctl!.state, "seat", `${s.name} disconnected. A bot plays their seat until they return.`);
    this.ctl!.changed();
  }

  private reclaim(hubId: number, name: string): void {
    const shared = this.shared as GameShared;
    const s = this.ctl!.state.seats.find((x) => x.controller === "bot" && x.name === name && shared.formerHumans.includes(name));
    if (!s) return;
    s.controller = "human";
    s.hubId = hubId;
    this.ctl!.setDriver(s.seat, "remote");
    ev(this.ctl!.state, "seat", `${s.name} is back and takes their seat again.`);
    this.ctl!.changed();
  }

  /** Publish the current state (throttled to ~8 per second; turn-based, so no deltas). */
  private publish(now: boolean): void {
    if (!this.hub.isHost) return;
    const send = () => {
      this.sendTimer = null;
      this.lastSent = Date.now();
      if (this.shared?.type === "game" && this.ctl) {
        const st = this.ctl.state;
        const trimmed = { ...st, events: st.events.slice(-300) };
        this.hub.setState({ ...this.shared, state: trimmed });
      } else if (this.shared) {
        this.hub.setState(this.shared);
      }
    };
    if (now) { if (this.sendTimer) clearTimeout(this.sendTimer); send(); return; }
    if (this.sendTimer) return;
    const wait = Math.max(0, 125 - (Date.now() - this.lastSent));
    this.sendTimer = setTimeout(send, wait);
  }
}
