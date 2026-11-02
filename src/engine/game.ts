// The game as a resumable state machine.
//
//   advance(state)  - if nobody owes a decision, run the next automatic step (one "beat").
//                     It either changes the state or posts Requests to seats.
//   submit(state, seat, decision) - a seat answers its open Request.
//
// Seats can be anything that answers Requests (local UI, bot, remote player), which is how any seat
// can be a bot at any time. The controller decides who answers and how long to wait.
import { LAWS, lawDef, lawParam, lawText, mandateDef, newLaw, raceDef } from "./content.ts";
import { newId, randInt, shuffle } from "./rng.ts";
import {
  NEUTRAL, drawFleets, fleetCap, handLimit, heldBy, holders, holds, latticeNetwork, maxRaises, neighbours,
  powerOn, raceOf, returnFleets, seatOfRace, sideSeats, sideTotal, spareFleets, sway, targets, winsTie,
} from "./rules.ts";
import type {
  AskDecision, BetDecision, Card, Clash, ClashSide, Decision, GameEvent, GameState, LastWordDecision,
  MandatesDecision, ParleyDecision, PlanDecision, PledgeDecision, PowerDecision, RaceId, RaiseDecision,
  Request, RequestKind, RewindDecision, Seat, SummitDecision,
} from "./types.ts";

export const SECONDS: Record<RequestKind, number> = {
  mandates: 30, summit: 30, power: 20, plan: 60, lastword: 20, ask: 50, pledge: 70, bet: 10, raise: 15, rewind: 10, parley: 20,
};

// Pauses (ms at 1x speed) that let the table watch what just happened.
const D = { short: 700, phase: 1100, reveal: 1800, card: 1300, resolve: 2400, big: 2600 };

// ---- helpers ------------------------------------------------------------------------------------

export function ev(s: GameState, type: string, text: string, extra: Partial<GameEvent> = {}): void {
  const n = s.events.length ? s.events[s.events.length - 1].n + 1 : 0;
  s.events.push({ n, cycle: s.cycle, type, text, ...extra });
}
const nm = (s: GameState, seat: Seat | -1) => (seat < 0 ? "the garrison" : s.seats[seat].name);
const sysName = (s: GameState, id: number) => s.systems[id].name;
const an = (n: number) => (n === 8 || n === 11 || n === 18 ? `an ${n}` : `a ${n}`);

function request(s: GameState, seat: Seat, kind: RequestKind, clash?: number): void {
  s.pending.push({ id: newId(s), seat, kind, clash, seconds: SECONDS[kind] });
}

function draw(s: GameState, seat: Seat, n: number): void {
  const p = s.players[seat];
  for (let i = 0; i < n; i++) {
    if (!s.deck.length) {
      if (!s.discard.length) return;
      s.deck = shuffle(s, s.discard);
      s.discard = [];
      ev(s, "shuffle", "The deck is reshuffled.");
    }
    p.hand.push(s.deck.pop()!);
  }
}

function takeCard(s: GameState, seat: Seat, id: number | null | undefined): Card | null {
  if (id == null) return null;
  const hand = s.players[seat].hand;
  const i = hand.findIndex((c) => c.id === id);
  return i < 0 ? null : hand.splice(i, 1)[0];
}

/**
 * A race power is about to fire. If the Tithe is watching that race, the owner pays 2 Influence
 * or the power fizzles. Returns whether the power goes ahead.
 */
export function firePower(s: GameState, seat: Seat, race: RaceId, label: string): boolean {
  const t = seatOfRace(s, "tithe");
  if (t === null || t === seat || !s.titheWatch.includes(race) || s.titheUsed >= 2) return true;
  s.titheUsed++;
  s.titheWatch = s.titheWatch.filter((r) => r !== race);
  const p = s.players[seat];
  if (p.influence >= 2) {
    p.influence -= 2;
    s.players[t].influence += 2;
    ev(s, "tithed", `TITHED! ${nm(s, seat)} pays ${nm(s, t)} 2 Influence to keep ${label}.`, { seats: [seat, t], loud: true, data: { paid: true } });
    return true;
  }
  ev(s, "tithed", `TITHED! ${nm(s, seat)} can't pay, so ${label} fizzles.`, { seats: [seat, t], loud: true, data: { paid: false } });
  return false;
}

export function currentClash(s: GameState): Clash | null {
  if (!s.show) return null;
  const id = s.show.order[s.show.idx];
  return s.clashes.find((c) => c.id === id) ?? null;
}

export function clashById(s: GameState, id: number | undefined): Clash | null {
  return s.clashes.find((c) => c.id === id) ?? null;
}

// ---- public API ---------------------------------------------------------------------------------

export function openRequests(s: GameState): Request[] {
  return s.pending.filter((r) => !s.answers[r.id]);
}

export function submit(s: GameState, seat: Seat, d: Decision): boolean {
  const r = s.pending.find((x) => x.seat === seat && !s.answers[x.id]);
  if (!r || r.kind !== d.kind) return false;
  s.answers[r.id] = d;
  return true;
}

export function advance(s: GameState): void {
  s.delay = 0;
  if (s.phase === "over") return;
  if (s.pending.length) {
    if (openRequests(s).length) return;
    const reqs = s.pending;
    const answers = s.answers;
    s.pending = [];
    s.answers = {};
    apply(s, reqs, answers);
    return;
  }
  step(s);
}

function answersOf<T extends Decision>(reqs: Request[], answers: Record<string, Decision>): Map<Seat, T> {
  const m = new Map<Seat, T>();
  for (const r of reqs) if (answers[r.id]) m.set(r.seat, answers[r.id] as T);
  return m;
}

function apply(s: GameState, reqs: Request[], answers: Record<string, Decision>): void {
  const kind = reqs[0]?.kind;
  switch (kind) {
    case "mandates": return resolveMandates(s, answersOf(reqs, answers));
    case "summit": return resolveSummit(s, answersOf(reqs, answers));
    case "power": return resolvePower(s, answersOf(reqs, answers));
    case "plan": return resolvePlan(s, answersOf(reqs, answers));
    case "lastword": return resolveLastWord(s, answersOf(reqs, answers));
    case "ask": return resolveAsk(s, answersOf(reqs, answers));
    case "pledge": return resolvePledge(s, answersOf(reqs, answers));
    case "bet": return resolveBets(s, answersOf(reqs, answers));
    case "raise": return resolveRaise(s, reqs[0].seat, answers[reqs[0].id] as RaiseDecision);
    case "rewind": return resolveRewind(s, reqs[0].seat, answers[reqs[0].id] as RewindDecision);
    case "parley": return resolveParley(s, answersOf(reqs, answers));
  }
}

function step(s: GameState): void {
  switch (s.phase) {
    case "mandates": {
      if (s.config.mandates) {
        for (const p of s.players) request(s, p.seat, "mandates");
        return;
      }
      s.phase = "dawn";
      return;
    }
    case "dawn": return dawn(s);
    case "summit": return startSummit(s);
    case "power": return startPower(s);
    case "plan": return startPlan(s);
    case "convergence": return convergence(s);
    case "lastword": return startLastWord(s);
    case "ask": return startAsk(s);
    case "pledge": return startPledge(s);
    case "showtime": return showtime(s);
    case "reckoning": return reckoning(s);
  }
}

// ---- Mandates -----------------------------------------------------------------------------------

function resolveMandates(s: GameState, a: Map<Seat, MandatesDecision>): void {
  for (const p of s.players) {
    const want = a.get(p.seat)?.keep ?? [];
    let keep = want.filter((m) => p.mandateOffer.includes(m)).slice(0, 2);
    for (const m of p.mandateOffer) if (keep.length < 2 && !keep.includes(m)) keep.push(m);
    p.mandates = keep;
  }
  ev(s, "phase", "Everyone keeps 2 secret Mandates.");
  s.phase = "dawn";
}

// ---- Dawn ---------------------------------------------------------------------------------------

function dawn(s: GameState): void {
  s.cycle++;
  s.vectors = []; s.asks = []; s.pledges = []; s.clashes = []; s.show = null; s.proposals = [];
  s.titheWatch = []; s.titheUsed = 0;
  s.folds = s.folds.filter((f) => f.cycle >= s.cycle);
  s.truces = s.truces.filter((t) => t.until >= s.cycle);
  ev(s, "phase", `Cycle ${s.cycle} — Dawn`, { data: { phase: "dawn" } });
  if (s.cycle === s.config.maxCycles) ev(s, "final", `Final Cycle! Highest Sway after this Cycle wins.`, { loud: true });

  const boom = lawParam(s, "boom", 0, 0);
  const docks = lawParam(s, "docks", 0, 0);
  for (const p of s.players) {
    p.usedThisCycle = {};
    const mine = heldBy(s, p.seat).map((id) => s.systems[id]);
    const income = 1 + mine.filter((x) => x.trait === "rich").length * (1 + boom);
    p.influence += income;
    // Drift recovery onto the seat's weakest held home (or any held system, or back home).
    const rec = Math.min(p.drift, 2 + mine.filter((x) => x.trait === "shipyard").length + docks);
    if (rec > 0) {
      const homesHeld = mine.filter((x) => x.home === p.seat);
      const pool = homesHeld.length ? homesHeld : mine.length ? mine : s.systems.filter((x) => x.home === p.seat);
      pool.sort((a, b) => (a.fleets[p.seat] ?? 0) - (b.fleets[p.seat] ?? 0) || a.id - b.id);
      const target = pool[0];
      target.fleets[p.seat] = (target.fleets[p.seat] ?? 0) + rec;
      p.drift -= rec;
    }
    const room = handLimit(s, p.seat) - p.hand.length;
    if (room > 0) draw(s, p.seat, Math.min(2, room));
  }
  ev(s, "income", "Income, fleet recovery and new cards.");

  // Undertow Echoes: tremors a Cycle early, eruptions on time.
  for (const e of s.echoes) {
    if (e.fireOn === s.cycle + 1) {
      const near = new Set<number>([e.system, ...neighbours(s, e.system)]);
      const who = new Set<Seat>();
      for (const id of near) for (const h of holders(s, id)) who.add(h);
      if (who.size) ev(s, "tremor", `A tremor rumbles near ${sysName(s, e.system)}…`, { only: [...who, e.owner], data: { system: e.system } });
    }
  }
  const firing = s.echoes.filter((e) => e.fireOn === s.cycle);
  s.echoes = s.echoes.filter((e) => e.fireOn !== s.cycle);
  for (const e of firing) fireEcho(s, e.owner, e.system, e.effect);

  const summit = (s.config.laws && !s.config.tutorial) && (s.cycle === 3 || s.cycle === 6);
  s.phase = summit ? "summit" : "power";
  s.delay = firing.length ? D.big : D.phase;
}

function fireEcho(s: GameState, owner: Seat, system: number, effect: string): void {
  const hit = holders(s, system);
  const where = sysName(s, system);
  if (!hit.length) {
    ev(s, "echo", `An Echo erupts on ${where}, but nobody is there.`, { loud: true, data: { system } });
    return;
  }
  if (!firePower(s, owner, "undertow", "the Echo")) return;
  const names = hit.map((h) => nm(s, h)).join(" and ");
  if (effect === "destroy") {
    for (const h of hit) {
      const k = Math.min(2, s.systems[system].fleets[h]);
      s.systems[system].fleets[h] -= k;
      s.players[h].drift += k;
    }
    ev(s, "echo", `ECHO on ${where}! ${names} lose${hit.length > 1 ? "" : "s"} up to 2 fleets.`, { seats: hit, loud: true, data: { system, effect } });
  } else if (effect === "steal") {
    for (const h of hit) {
      if (h === owner) continue;
      const k = Math.min(2, s.players[h].influence);
      s.players[h].influence -= k;
      s.players[owner].influence += k;
    }
    ev(s, "echo", `ECHO on ${where}! ${names} lose 2 Influence to ${nm(s, owner)}.`, { seats: hit, loud: true, data: { system, effect } });
  } else if (effect === "cancel") {
    const before = s.truces.length;
    s.truces = s.truces.filter((t) => !hit.includes(t.a) && !hit.includes(t.b));
    ev(s, "echo", `ECHO on ${where}! ${before - s.truces.length} truce(s) involving ${names} dissolve.`, { seats: hit, loud: true, data: { system, effect } });
  } else {
    for (const h of hit) {
      const hand = s.players[h].hand;
      for (let i = 0; i < 2 && hand.length; i++) s.discard.push(hand.splice(randInt(s, hand.length), 1)[0]);
    }
    ev(s, "echo", `ECHO on ${where}! ${names} discard 2 cards.`, { seats: hit, loud: true, data: { system, effect } });
  }
}

// ---- Law Summit ---------------------------------------------------------------------------------

function startSummit(s: GameState): void {
  const free = LAWS.map((l) => l.id).filter((id) => !s.laws.some((l) => l.id === id));
  s.summitOffer = shuffle(s, free).slice(0, 3).map(newLaw);
  ev(s, "summit", `Law Summit! Candidates: ${s.summitOffer.map((l) => lawDef(l.id).name).join(", ")}. Sealed bids; the lowest Sway gets +2.`, { loud: true });
  for (const p of s.players) request(s, p.seat, "summit");
}

function resolveSummit(s: GameState, a: Map<Seat, SummitDecision>): void {
  const sw = s.players.map((p) => sway(s, p.seat));
  const low = Math.min(...sw);
  let best: { seat: Seat; eff: number; d: SummitDecision } | null = null;
  for (const p of s.players) {
    const d = a.get(p.seat);
    if (!d) continue;
    const bid = Math.max(0, Math.min(p.influence, Math.floor(d.bid)));
    if (bid <= 0) continue;
    const eff = bid + (sw[p.seat] === low ? 2 : 0);
    if (!best || eff > best.eff || (eff === best.eff && sw[p.seat] < sw[best.seat])) best = { seat: p.seat, eff, d: { ...d, bid } };
  }
  if (best && s.summitOffer[best.d.law]) {
    const law = s.summitOffer[best.d.law];
    s.players[best.seat].influence -= best.d.bid;
    const slot = Math.max(0, Math.min(s.laws.length - 1, best.d.replace));
    const old = s.laws.length >= 3 ? s.laws.splice(slot, 1, law)[0] : (s.laws.push(law), null);
    ev(s, "summit-win", `${nm(s, best.seat)} wins the Summit for ${best.d.bid}: ${lawDef(law.id).name} is now Law${old ? `, replacing ${lawDef(old.id).name}` : ""}.`, { seats: [best.seat], loud: true });
  } else {
    ev(s, "summit-win", "Nobody bid. The Laws stay as they are.");
  }
  s.summitOffer = [];
  s.phase = "power";
  s.delay = D.reveal;
}

// ---- Dawn powers (Amenders, Foldwrights) ------------------------------------------------------

function startPower(s: GameState): void {
  for (const r of ["amenders", "foldwrights"] as RaceId[]) {
    const seat = seatOfRace(s, r);
    if (seat === null) continue;
    if (r === "amenders" && !s.laws.length) continue;
    request(s, seat, "power");
  }
  if (!s.pending.length) s.phase = "plan";
}

function resolvePower(s: GameState, a: Map<Seat, PowerDecision>): void {
  for (const [seat, d] of a) {
    const race = raceOf(s, seat);
    if (race === "amenders" && d.amend) {
      const law = s.laws[d.amend.law];
      if (!law) continue;
      const def = lawDef(law.id);
      const before = lawText(law);
      if ("word" in d.amend) {
        if (!def.words?.includes(d.amend.word) || d.amend.word === law.word) continue;
        if (!firePower(s, seat, "amenders", "the amendment")) continue;
        law.word = d.amend.word;
      } else {
        const p = def.params[d.amend.param];
        if (!p) continue;
        const v = Math.max(p.min, Math.min(p.max, Math.round(d.amend.value)));
        if (Math.abs(v - law.params[d.amend.param]) !== 1) continue;
        if (!firePower(s, seat, "amenders", "the amendment")) continue;
        law.params[d.amend.param] = v;
      }
      ev(s, "amend", `${nm(s, seat)} AMENDS ${def.name}: “${before}” → “${lawText(law)}”`, { seats: [seat], loud: true, data: { law: law.id } });
    }
    if (race === "foldwrights" && d.fold) {
      const { a: x, b: y } = d.fold;
      if (x === y || !s.systems[x] || !s.systems[y] || s.adjacency[x].includes(y)) continue;
      if (!firePower(s, seat, "foldwrights", "the fold")) continue;
      s.folds.push({ a: x, b: y, cycle: s.cycle });
      ev(s, "fold-space", `${nm(s, seat)} FOLDS space: ${sysName(s, x)} and ${sysName(s, y)} touch this Cycle. Anyone may use the fold.`, { seats: [seat], loud: true, data: { a: x, b: y } });
    }
  }
  s.phase = "plan";
  s.delay = D.reveal;
}

// ---- Plan ---------------------------------------------------------------------------------------

function startPlan(s: GameState): void {
  ev(s, "phase", "Plan — everyone secretly picks a Vector.", { data: { phase: "plan" } });
  for (const p of s.players) if (raceOf(s, p.seat) !== "lastword") request(s, p.seat, "plan");
}

function addVector(s: GameState, seat: Seat, target: number | null, fleets: number, late = false): boolean {
  if (target === null || target === undefined) return false;
  if (!targets(s, seat).includes(target)) return false;
  const n = Math.min(Math.floor(fleets), fleetCap(s), spareFleets(s, seat));
  if (n < 1) return false;
  const from = drawFleets(s, seat, n);
  s.vectors.push({ seat, target, fleets: n, from, late });
  return true;
}

function resolvePlan(s: GameState, a: Map<Seat, PlanDecision>): void {
  for (const p of s.players) {
    const d = a.get(p.seat);
    if (!d) continue;
    addVector(s, p.seat, d.target, d.fleets);
    const race = raceOf(s, p.seat);
    if (race === "undertow" && d.echo && s.systems[d.echo.system]) {
      const delay = Math.max(1, Math.min(3, Math.floor(d.echo.delay)));
      const effect = (["destroy", "steal", "cancel", "discard"] as const).includes(d.echo.effect) ? d.echo.effect : "destroy";
      s.echoes.push({ id: newId(s), owner: p.seat, system: d.echo.system, effect, fireOn: s.cycle + delay });
      ev(s, "echo-plant", `${nm(s, p.seat)} plants an Echo on ${sysName(s, d.echo.system)} (${effect}, in ${delay} Cycle${delay > 1 ? "s" : ""}).`, { only: [p.seat] });
    }
    if (race === "murmur" && d.lies?.length) {
      const valid = d.lies.filter((l) => holds(s, p.seat, l.system)).slice(0, 2);
      if (valid.length && firePower(s, p.seat, "murmur", "their lies")) {
        s.lies = [...s.lies, ...valid.map((l) => ({ ...l, id: newId(s) }))].slice(-2);
        ev(s, "lie", `${nm(s, p.seat)} spreads ${valid.length} new lie${valid.length > 1 ? "s" : ""}.`, { only: [p.seat] });
      }
    }
    if (race === "tithe" && d.tithe) {
      s.titheWatch = d.tithe.filter((r) => r !== "tithe" && s.seats.some((x) => x.race === r)).slice(0, 2);
      if (s.titheWatch.length) ev(s, "tithe-watch", `${nm(s, p.seat)} watches: ${s.titheWatch.map((r) => raceDef(r).short).join(", ")}.`, { only: [p.seat] });
    }
  }
  s.phase = "convergence";
  s.delay = D.short;
}

// ---- Convergence and the Last Word -------------------------------------------------------------

function checkBetrayal(s: GameState, seat: Seat, target: number): void {
  for (const h of holders(s, target)) {
    const t = s.truces.find((x) => (x.a === seat && x.b === h) || (x.b === seat && x.a === h));
    if (!t) continue;
    s.truces = s.truces.filter((x) => x !== t);
    const pay = Math.min(3, s.players[seat].influence);
    s.players[seat].influence -= pay;
    s.players[h].influence += pay;
    s.players[seat].branded = s.cycle + 1;
    ev(s, "betrayal", `BETRAYAL! ${nm(s, seat)} breaks the truce with ${nm(s, h)}, pays ${pay} Influence and is Branded until the end of next Cycle.`, { seats: [seat, h], loud: true });
  }
}

function convergence(s: GameState): void {
  const tax = lawParam(s, "tax", 0, 0);
  ev(s, "phase", "Convergence — all Vectors are revealed!", { data: { phase: "convergence" }, loud: s.vectors.length > 0 });
  for (const v of s.vectors) {
    const paid = Math.min(tax, s.players[v.seat].influence);
    s.players[v.seat].influence -= paid;
    ev(s, "vector", `${nm(s, v.seat)} → ${sysName(s, v.target)} with ${v.fleets} fleet${v.fleets > 1 ? "s" : ""}.`, { seats: [v.seat], data: { target: v.target } });
    checkBetrayal(s, v.seat, v.target);
  }
  if (!s.vectors.length) ev(s, "vector", "Nobody launched a Vector. An eerie calm.");
  const lw = seatOfRace(s, "lastword");
  s.phase = lw !== null && spareFleets(s, lw) > 0 && targets(s, lw).length ? "lastword" : "ask";
  if (s.phase === "ask") buildClashes(s);
  s.delay = D.big;
}

function startLastWord(s: GameState): void {
  request(s, seatOfRace(s, "lastword")!, "lastword");
}

function resolveLastWord(s: GameState, a: Map<Seat, LastWordDecision>): void {
  const seat = seatOfRace(s, "lastword")!;
  const d = a.get(seat);
  if (d && d.target !== null && targets(s, seat).includes(d.target) && firePower(s, seat, "lastword", "their late arrival")) {
    if (addVector(s, seat, d.target, d.fleets, true)) {
      ev(s, "lastword", `ALARM! ${nm(s, seat)} has the Last Word: → ${sysName(s, d.target)} with ${s.vectors[s.vectors.length - 1].fleets} fleets.`, { seats: [seat], loud: true, data: { target: d.target } });
      checkBetrayal(s, seat, d.target);
    }
  } else {
    ev(s, "lastword", `${nm(s, seat)} holds back the Last Word this Cycle.`, { seats: [seat] });
  }
  buildClashes(s);
  s.phase = "ask";
  s.delay = D.reveal;
}

function drawGarrisonCard(s: GameState): Card {
  for (let i = 0; i < 6; i++) {
    if (!s.deck.length) { s.deck = shuffle(s, s.discard); s.discard = []; }
    const c = s.deck.pop();
    if (!c) break;
    if (c.kind === "num") return c;
    s.discard.push(c);
  }
  return { id: newId(s), kind: "num", value: 3 };
}

function emptySide(lead: Seat | -1, role: "attacker" | "defender", fleets: number): ClashSide {
  return { lead, role, fleets, allies: [], opening: null, openingRevealed: false, cards: [], precedents: [], raises: 0, folded: false };
}

function buildClashes(s: GameState): void {
  const byTarget = new Map<number, typeof s.vectors>();
  for (const v of s.vectors) byTarget.set(v.target, [...(byTarget.get(v.target) ?? []), v]);
  for (const [target, vs] of byTarget) {
    const sys = s.systems[target];
    const hs = holders(s, target);
    const garrison = sys.fleets[String(NEUTRAL)] ?? 0;
    vs.sort((a, b) => s.players[a.seat].actsLast - s.players[b.seat].actsLast || a.seat - b.seat);
    if (!hs.length && !garrison) {
      if (vs.length === 1) {
        const v = vs[0];
        sys.fleets[v.seat] = (sys.fleets[v.seat] ?? 0) + v.fleets;
        ev(s, "capture", `${nm(s, v.seat)} takes ${sys.name} unopposed.`, { seats: [v.seat], data: { system: target } });
        anomaly(s, v.seat, target);
        continue;
      }
    }
    const clash: Clash = {
      id: newId(s), system: target, sides: [], headOn: !hs.length && !garrison, nulled: [], log: [], rewound: false,
      resolved: false, winner: null, bets: [],
    };
    if (hs.length) {
      hs.sort((a, b) => sys.fleets[b] - sys.fleets[a] || a - b);
      const def = emptySide(hs[0], "defender", sys.fleets[hs[0]]);
      // Co-holders defend together: their fleets on the system count like allies.
      for (const h of hs.slice(1)) def.allies.push({ seat: h, fleets: sys.fleets[h], revealed: true });
      clash.sides.push(def);
    } else if (garrison) {
      // The garrison fights with a hidden card from the deck, flipped with the openings.
      const g = emptySide(NEUTRAL, "defender", garrison);
      g.opening = drawGarrisonCard(s);
      clash.sides.push(g);
    }
    for (const v of vs) {
      const side = emptySide(v.seat, "attacker", v.fleets);
      side.late = v.late;
      clash.sides.push(side);
    }
    s.clashes.push(clash);
  }
}

// ---- Council: asks, then pledges ----------------------------------------------------------------

function startAsk(s: GameState): void {
  if (!s.clashes.length) {
    ev(s, "phase", "No Clashes this Cycle.");
    s.phase = "reckoning";
    return;
  }
  ev(s, "phase", "Council — fighters ask for allies in public.", { data: { phase: "council" } });
  for (const p of s.players) request(s, p.seat, "ask");
}

export function canBeAsked(s: GameState, clash: Clash, seat: Seat): boolean {
  if (clash.sides.some((x) => x.lead === seat)) return false;
  if (clash.sides.some((x) => x.allies.some((a) => a.seat === seat))) return false; // co-holders already defend
  if (raceOf(s, seat) === "lattice") return false; // its ships never leave the web
  return true;
}

function resolveAsk(s: GameState, a: Map<Seat, AskDecision>): void {
  for (const [seat, d] of a) {
    const grouped = new Map<number, { to: Seat; offer: number }[]>();
    for (const x of d.asks ?? []) {
      const clash = clashById(s, x.clash);
      if (!clash || !clash.sides.some((sd) => sd.lead === seat)) continue;
      if (!s.seats[x.to] || !canBeAsked(s, clash, x.to)) continue;
      if (s.asks.some((k) => k.clash === x.clash && k.from === seat && k.to === x.to)) continue;
      const offer = Math.max(0, Math.min(s.players[seat].influence, Math.floor(x.offer)));
      s.asks.push({ clash: x.clash, from: seat, to: x.to, offer });
      grouped.set(x.clash, [...(grouped.get(x.clash) ?? []), { to: x.to, offer }]);
    }
    for (const [cid, list] of grouped) {
      const clash = clashById(s, cid)!;
      const who = list.map((x) => `${nm(s, x.to)}${x.offer ? ` (${x.offer}◆)` : ""}`).join(", ");
      ev(s, "ask", `${nm(s, seat)} asks ${who} to join them at ${sysName(s, clash.system)}.`, { seats: [seat, ...list.map((x) => x.to)], data: { clash: cid } });
    }
    for (const t of d.truces ?? []) {
      if (t === seat || !s.seats[t] || s.proposals.some((p) => p.from === seat && p.to === t)) continue;
      if (s.truces.some((x) => (x.a === seat && x.b === t) || (x.a === t && x.b === seat))) continue;
      s.proposals.push({ from: seat, to: t });
      ev(s, "truce-offer", `${nm(s, seat)} offers ${nm(s, t)} a truce for 2 Cycles.`, { seats: [seat, t] });
    }
  }
  s.phase = "pledge";
  s.delay = D.short;
}

function startPledge(s: GameState): void {
  for (const p of s.players) request(s, p.seat, "pledge");
}

function resolvePledge(s: GameState, a: Map<Seat, PledgeDecision>): void {
  for (const p of s.players) {
    const d = a.get(p.seat);
    // Openings: every lead places one face-down card (or nothing).
    for (const clash of s.clashes) {
      const side = clash.sides.find((x) => x.lead === p.seat);
      if (!side) continue;
      const want = d?.openings?.find((o) => o.clash === clash.id)?.card;
      const card = takeCard(s, p.seat, want);
      if (card && card.kind === "null") { p.hand.push(card); continue; }
      side.opening = card;
    }
    if (!d) continue;
    // Pledges: only into Clashes you were asked into, on the asker's side.
    const done = new Set<number>();
    for (const pl of d.pledges ?? []) {
      const clash = clashById(s, pl.clash);
      if (!clash || done.has(pl.clash)) continue;
      const side = clash.sides[pl.side];
      if (!side || !s.asks.some((k) => k.clash === pl.clash && k.to === p.seat && k.from === side.lead)) continue;
      const n = Math.min(Math.floor(pl.fleets), spareFleets(s, p.seat), 4);
      if (n < 1) continue;
      const from = drawFleets(s, p.seat, n);
      side.allies.push({ seat: p.seat, fleets: n, revealed: false });
      s.pledges.push({ clash: pl.clash, seat: p.seat, side: pl.side, fleets: n, from });
      done.add(pl.clash);
    }
    for (const t of d.acceptTruces ?? []) {
      if (!s.proposals.some((x) => x.from === t && x.to === p.seat)) continue;
      if (s.truces.some((x) => (x.a === t && x.b === p.seat) || (x.a === p.seat && x.b === t))) continue;
      s.truces.push({ a: t, b: p.seat, until: s.cycle + 1 });
      ev(s, "truce", `${nm(s, t)} and ${nm(s, p.seat)} agree a truce until the end of Cycle ${s.cycle + 1}.`, { seats: [t, p.seat] });
    }
    if (d.audit != null && s.systems[d.audit]) audit(s, p.seat, d.audit);
  }
  ev(s, "phase", "Pledges are sealed. Showtime!", { data: { phase: "showtime" } });
  const size = (c: Clash) => c.sides.reduce((n, x) => n + x.fleets + x.allies.reduce((m, y) => m + y.fleets, 0), 0);
  const order = [...s.clashes].sort((x, y) => size(x) - size(y) || x.id - y.id).map((c) => c.id);
  s.show = { order, idx: 0, beat: "bets" };
  s.phase = "showtime";
  s.delay = D.phase;
}

function audit(s: GameState, seat: Seat, system: number): void {
  const m = seatOfRace(s, "murmur");
  if (m === null || m === seat || s.players[seat].influence < 2) return;
  const lies = s.lies.filter((l) => l.system === system && (l.target === "all" || l.target === seat));
  if (lies.length) {
    s.lies = s.lies.filter((l) => l.system !== system);
    const pay = Math.min(3, s.players[m].influence);
    s.players[m].influence -= pay;
    s.players[seat].influence += pay;
    ev(s, "audit", `AUDIT on ${sysName(s, system)}: LIAR! ${nm(s, m)} pays ${nm(s, seat)} ${pay} Influence. The true count is ${s.systems[system].fleets[m] ?? 0}.`, { seats: [seat, m], loud: true, data: { system, caught: true } });
  } else {
    s.players[seat].influence -= 2;
    s.players[m].influence += 2;
    ev(s, "audit", `AUDIT on ${sysName(s, system)}: no lie found. ${nm(s, m)} grins and pockets 2 Influence.`, { seats: [seat, m], loud: true, data: { system, caught: false } });
  }
}

// ---- Showtime -----------------------------------------------------------------------------------

export function canBet(s: GameState, clash: Clash, seat: Seat): number[] | null {
  if (clash.sides.some((x) => x.lead === seat)) return null;
  if (s.players[seat].influence < 1) return null;
  const pledged = s.pledges.find((p) => p.clash === clash.id && p.seat === seat);
  const co = clash.sides.findIndex((x) => x.allies.some((a) => a.seat === seat && a.revealed));
  if (pledged) return [pledged.side];
  if (co >= 0) return [co];
  return clash.sides.map((_, i) => i);
}

function showtime(s: GameState): void {
  const show = s.show!;
  const clash = currentClash(s);
  if (!clash) {
    s.show = null;
    s.phase = "reckoning";
    return;
  }
  const where = sysName(s, clash.system);
  switch (show.beat) {
    case "bets": {
      const names = clash.sides.map((x) => nm(s, x.lead)).join(" vs ");
      ev(s, "clash", `Clash at ${where}: ${names}${clash.headOn ? " (head-on)" : ""}.`, {
        seats: clash.sides.map((x) => x.lead).filter((x) => x >= 0) as Seat[], loud: true,
        data: { clash: clash.id, system: clash.system, defender: clash.sides.find((x) => x.role === "defender")?.lead ?? null, attackers: clash.sides.filter((x) => x.role === "attacker").map((x) => x.lead) },
      });
      for (const p of s.players) if (canBet(s, clash, p.seat)) request(s, p.seat, "bet", clash.id);
      show.beat = "allies";
      s.delay = D.phase;
      return;
    }
    case "allies": {
      let any = false;
      clash.sides.forEach((side) => {
        for (const al of side.allies) {
          if (al.revealed) continue;
          al.revealed = true;
          any = true;
          ev(s, "ally", `${nm(s, al.seat)} joins ${nm(s, side.lead)} with ${al.fleets} fleet${al.fleets > 1 ? "s" : ""}!`, { seats: [al.seat, side.lead as Seat], data: { clash: clash.id } });
          // Pay-for-help deals are enforced at the reveal.
          const ask = s.asks.find((k) => k.clash === clash.id && k.to === al.seat && k.from === side.lead);
          if (ask && ask.offer > 0 && side.lead >= 0) {
            const pay = Math.min(ask.offer, s.players[side.lead].influence);
            s.players[side.lead].influence -= pay;
            s.players[al.seat].influence += pay;
            if (pay) ev(s, "pay", `${nm(s, side.lead)} pays ${nm(s, al.seat)} ${pay} Influence as promised.`, { seats: [side.lead as Seat, al.seat] });
          }
        }
      });
      if (!any) ev(s, "ally", "No allies show up.", { data: { clash: clash.id } });
      show.beat = "openings";
      s.delay = any ? D.reveal : D.short;
      return;
    }
    case "openings": {
      for (const side of clash.sides) {
        side.openingRevealed = true;
        if (side.lead < 0) {
          if (side.opening) ev(s, "opening", `The garrison reveals ${an(side.opening.value)}.`, { data: { clash: clash.id } });
          continue;
        }
        const c = side.opening;
        const what = !c ? "no card" : c.kind === "parley" ? "PARLEY" : an(c.value);
        ev(s, "opening", `${nm(s, side.lead)} opens with ${what}.`, { seats: [side.lead], data: { clash: clash.id } });
      }
      const parleys = clash.sides.map((x, i) => (x.opening?.kind === "parley" ? i : -1)).filter((i) => i >= 0);
      if (parleys.length === 2 && clash.sides.length === 2) {
        show.beat = "parley";
        clash.parley = { choices: {} };
        ev(s, "parley", "Both sides open with Parley! They have a moment to make a deal.", { loud: true, data: { clash: clash.id } });
        for (const sd of clash.sides) request(s, sd.lead as Seat, "parley", clash.id);
      } else {
        for (const i of parleys) {
          const side = clash.sides[i];
          side.folded = true;
          clash.log.push({ side: i, kind: "fold", note: "parley" });
          ev(s, "parley", `${nm(s, side.lead)} Parleys alone and backs off, collecting Salvage.`, { seats: [side.lead as Seat], data: { clash: clash.id } });
        }
        show.beat = "raise";
      }
      s.delay = D.reveal;
      return;
    }
    case "parley":
      show.beat = "raise";
      return;
    case "raise": return raiseStep(s, clash);
    case "resolve": {
      if (!clash.resolved) settle(s, clash, clash.winner);
      show.idx++;
      show.beat = "bets";
      s.delay = D.resolve;
      return;
    }
    case "done":
      return;
  }
}

/** Who must act next in the Raise, or the result if it is over. */
export function raiseStatus(s: GameState, clash: Clash): { done: true; winner: number | null } | { done: false; actor: number; forced: boolean } {
  const active = clash.sides.map((_, i) => i).filter((i) => !clash.sides[i].folded);
  if (!active.length) return { done: true, winner: null };
  if (active.length === 1) return { done: true, winner: active[0] };
  const t = clash.sides.map((_, i) => sideTotal(s, clash, i));
  const ahead = (a: number, b: number) => t[a] > t[b] || (t[a] === t[b] && winsTie(s, clash, a, b));
  const leaders = active.filter((a) => !active.some((b) => b !== a && ahead(b, a)));
  const behind = active.filter((i) => !leaders.includes(i) || leaders.length > 1);
  const order = (list: number[]) =>
    [...list].sort((a, b) => t[a] - t[b] || clash.sides[a].raises - clash.sides[b].raises || a - b);
  const strictlyBehind = leaders.length > 1 ? active.filter((i) => !leaders.includes(i)) : behind;
  const candidates = strictlyBehind.length ? order(strictlyBehind) : order(leaders);
  const actor = candidates[0];
  if (canRaise(s, clash, actor)) return { done: false, actor, forced: false };
  if (leaders.length > 1 && leaders.includes(actor)) {
    const other = order(leaders).find((i) => canRaise(s, clash, i));
    if (other !== undefined) return { done: false, actor: other, forced: false };
    return { done: true, winner: null }; // dead tie
  }
  return { done: false, actor, forced: true };
}

export function canRaise(s: GameState, clash: Clash, idx: number): boolean {
  const side = clash.sides[idx];
  if (side.lead < 0 || side.raises >= maxRaises(s)) return false;
  const hand = s.players[side.lead].hand;
  if (hand.some((c) => c.kind === "num" || c.kind === "null")) return true;
  return precedentValues(s, side.lead).length > 0 && powerOn(s, clash, "archivists");
}

/** Values the Archivists may cite: cards their current opponents played face up earlier in the game. */
export function precedentValues(s: GameState, seat: Seat): number[] {
  if (raceOf(s, seat) !== "archivists" || s.players[seat].usedThisCycle.archivists) return [];
  const clash = currentClash(s);
  if (!clash) return [];
  const foes = new Set(clash.sides.filter((x) => x.lead !== seat).map((x) => x.lead));
  const infl = s.players[seat].influence;
  return [...new Set(s.publicPlayed.filter((x) => foes.has(x.seat)).map((x) => x.value))].filter((v) => precedentCost(v) <= infl).sort((a, b) => b - a);
}

/** Citing a precedent costs Influence: half the card's value, rounded up. */
export function precedentCost(value: number): number {
  return Math.ceil(value / 2);
}

function raiseStep(s: GameState, clash: Clash): void {
  const st = raiseStatus(s, clash);
  if (st.done) {
    clash.winner = st.winner;
    if (offerRewind(s, clash)) return;
    s.show!.beat = "resolve";
    return;
  }
  const side = clash.sides[st.actor];
  if (st.forced) {
    side.folded = true;
    if (side.lead >= 0) s.players[side.lead].stats.folds++;
    clash.log.push({ side: st.actor, kind: "fold", note: "forced" });
    ev(s, "fold", side.lead < 0 ? `The garrison is overwhelmed.` : `${nm(s, side.lead)} can't raise any further and fold.`, { data: { clash: clash.id } });
    s.delay = D.card;
    return;
  }
  request(s, side.lead as Seat, "raise", clash.id);
}

function offerRewind(s: GameState, clash: Clash): boolean {
  const r = seatOfRace(s, "recurrent");
  if (r === null || clash.rewound || s.players[r].usedThisCycle.recurrent) return false;
  if (!powerOn(s, clash, "recurrent")) return false;
  const mySide = clash.sides.findIndex((x) => sideSeats(x).includes(r));
  if (mySide < 0 || mySide === clash.winner) return false;
  if (!clash.log.some((e) => e.kind !== "fold" || e.note !== "parley")) return false;
  clash.rewound = true;
  request(s, r, "rewind", clash.id);
  return true;
}

function resolveRewind(s: GameState, seat: Seat, d: RewindDecision | undefined): void {
  const clash = currentClash(s)!;
  if (d?.rewind && firePower(s, seat, "recurrent", "the rewind")) {
    s.players[seat].usedThisCycle.recurrent = 1;
    s.players[seat].actsLast = s.cycle + 1;
    clash.sides.forEach((side, i) => {
      // Raise cards go back to hand; Archivist ghost cards vanish (the power is not refunded).
      if (side.lead >= 0) for (const c of side.cards) s.players[side.lead].hand.push(c);
      side.cards = [];
      side.precedents = [];
      side.raises = 0;
      side.folded = clash.log.some((e) => e.note === "parley" && e.side === i);
    });
    // Played cards come back, so they leave the public record too.
    const back = clash.log.filter((e) => e.kind === "card").length;
    for (let i = 0; i < back; i++) s.publicPlayed.pop();
    clash.nulled = [];
    const mine = clash.sides.findIndex((x) => sideSeats(x).includes(seat));
    for (const [i, side] of clash.sides.entries()) if (i !== mine && side.lead >= 0) draw(s, side.lead, 1);
    clash.log = clash.log.filter((e) => e.note === "parley");
    clash.winner = null;
    ev(s, "rewind", `REWIND! ${nm(s, seat)} rolls the Clash back to the start of the Raise. Everyone takes their cards back and remembers. Opponents draw 1.`, { seats: [seat], loud: true, data: { clash: clash.id } });
    s.delay = D.big;
    return;
  }
  s.show!.beat = "resolve";
}

function resolveRaise(s: GameState, seat: Seat, d: RaiseDecision | undefined): void {
  const clash = currentClash(s)!;
  const idx = clash.sides.findIndex((x) => x.lead === seat);
  const side = clash.sides[idx];
  const fold = () => {
    side.folded = true;
    s.players[seat].stats.folds++;
    clash.log.push({ side: idx, kind: "fold" });
    ev(s, "fold", `${nm(s, seat)} folds.`, { seats: [seat], data: { clash: clash.id } });
  };
  if (!d || d.action === "fold") { fold(); s.delay = D.card; return; }
  if (d.action === "card") {
    const card = takeCard(s, seat, d.card);
    if (!card || card.kind !== "num") { if (card) s.players[seat].hand.push(card); fold(); return; }
    side.cards.push(card);
    side.raises++;
    s.publicPlayed.push({ seat, value: card.value, cycle: s.cycle });
    clash.log.push({ side: idx, kind: "card", value: card.value, card });
    ev(s, "raise", `${nm(s, seat)} raises with ${an(card.value)}. (${sideTotal(s, clash, idx)})`, { seats: [seat], data: { clash: clash.id } });
  } else if (d.action === "null") {
    const card = takeCard(s, seat, d.card ?? s.players[seat].hand.find((c) => c.kind === "null")?.id);
    const races = nullTargets(s, clash, idx);
    if (!card || card.kind !== "null" || !d.target || !races.includes(d.target)) { if (card) s.players[seat].hand.push(card); fold(); return; }
    side.cards.push(card);
    side.raises++;
    clash.nulled.push(d.target);
    clash.log.push({ side: idx, kind: "null", target: d.target, card });
    ev(s, "null", `NULLED! ${nm(s, seat)} switches off ${raceDef(d.target).name} for this Clash.`, { seats: [seat], loud: true, data: { clash: clash.id } });
  } else if (d.action === "precedent") {
    const vals = powerOn(s, clash, "archivists") ? precedentValues(s, seat) : [];
    if (!vals.includes(d.value ?? -1)) { fold(); return; }
    s.players[seat].usedThisCycle.archivists = 1;
    s.players[seat].influence -= precedentCost(d.value!);
    side.raises++;
    if (firePower(s, seat, "archivists", "the precedent")) {
      side.precedents.push(Math.max(1, d.value! - 2)); // a faded copy
      const foes = new Set(clash.sides.filter((x) => x.lead !== seat).map((x) => x.lead));
      const src = s.publicPlayed.find((x) => x.value === d.value && foes.has(x.seat));
      clash.log.push({ side: idx, kind: "precedent", value: d.value });
      ev(s, "precedent", `PRECEDENT! ${nm(s, seat)} replays ${src ? `${nm(s, src.seat)}'s ${d.value} from Cycle ${src.cycle}` : an(d.value!)} as a faded ${Math.max(1, d.value! - 2)}.`, { seats: [seat], loud: true, data: { clash: clash.id } });
    }
  }
  s.delay = D.card;
}

export function nullTargets(s: GameState, clash: Clash, idx: number): RaceId[] {
  const out = new Set<RaceId>();
  clash.sides.forEach((x, j) => {
    if (j === idx) return;
    for (const seat of sideSeats(x)) out.add(raceOf(s, seat));
  });
  // A few powers matter outside the fighters' own races.
  for (const r of ["recurrent", "archivists"] as RaceId[]) if (seatOfRace(s, r) !== null && r !== raceOf(s, clash.sides[idx].lead as Seat)) out.add(r);
  for (const r of clash.nulled) out.delete(r);
  out.delete("tithe");
  return [...out];
}

function resolveParley(s: GameState, a: Map<Seat, ParleyDecision>): void {
  const clash = currentClash(s)!;
  const [x, y] = clash.sides;
  const cx = a.get(x.lead as Seat)?.choice ?? "withdraw";
  const cy = a.get(y.lead as Seat)?.choice ?? "withdraw";
  const att = clash.sides.find((sd) => sd.role === "attacker")!;
  const def = clash.sides.find((sd) => sd.role === "defender");
  const sys = s.systems[clash.system];
  clash.resolved = true;
  if (cx === cy) {
    if (cx === "cohold" && def) {
      landSide(s, clash, att);
      ev(s, "deal", `Deal! ${nm(s, att.lead)} and ${nm(s, def.lead)} now co-hold ${sys.name}.`, { loud: true, data: { clash: clash.id } });
    } else {
      sendHome(s, clash, att);
      ev(s, "deal", `Deal! ${nm(s, att.lead)} withdraws from ${sys.name}.`, { data: { clash: clash.id } });
    }
    for (const sd of clash.sides) if (sd.role === "attacker" && sd !== att) sendHome(s, clash, sd);
    if (def) for (const al of def.allies) returnAlly(s, clash, al.seat);
  } else {
    for (const sd of clash.sides) {
      if (sd.lead < 0) continue;
      if (sd.role === "attacker") {
        const lost = Math.min(1, sd.fleets);
        s.players[sd.lead].drift += lost;
        sd.fleets -= lost;
        sendHome(s, clash, sd);
      } else if ((sys.fleets[sd.lead] ?? 0) > 1) {
        sys.fleets[sd.lead]--;
        s.players[sd.lead].drift++;
      }
    }
    if (def) for (const al of def.allies) returnAlly(s, clash, al.seat);
    ev(s, "deal", "No deal! Each side loses a fleet and the attackers go home.", { loud: true, data: { clash: clash.id } });
  }
  discardClashCards(s, clash);
  refundBets(s, clash);
  s.show!.beat = "resolve";
  s.delay = D.resolve;
}

// ---- Settling a Clash ---------------------------------------------------------------------------

function vectorOf(s: GameState, clash: Clash, seat: Seat) {
  return s.vectors.find((v) => v.seat === seat && v.target === clash.system);
}
function pledgeOf(s: GameState, clash: Clash, seat: Seat) {
  return s.pledges.find((p) => p.clash === clash.id && p.seat === seat);
}

function landSide(s: GameState, clash: Clash, side: ClashSide): void {
  const sys = s.systems[clash.system];
  if (side.lead >= 0) sys.fleets[side.lead] = (sys.fleets[side.lead] ?? 0) + side.fleets;
  for (const al of side.allies) {
    if (!pledgeOf(s, clash, al.seat)) continue; // co-holders are already there
    sys.fleets[al.seat] = (sys.fleets[al.seat] ?? 0) + al.fleets;
  }
}

function sendHome(s: GameState, clash: Clash, side: ClashSide): void {
  if (side.lead >= 0 && side.role === "attacker") {
    const v = vectorOf(s, clash, side.lead);
    if (v) {
      // Scale the sources down if fleets were lost on the way.
      let n = side.fleets;
      const from: Record<string, number> = {};
      for (const [k, c] of Object.entries(v.from)) { const t = Math.min(c, n); if (t) from[k] = t; n -= t; }
      returnFleets(s, side.lead, from);
    }
  }
  for (const al of side.allies) returnAlly(s, clash, al.seat);
}

function returnAlly(s: GameState, clash: Clash, seat: Seat): void {
  const p = pledgeOf(s, clash, seat);
  if (p) returnFleets(s, seat, p.from);
}

function discardClashCards(s: GameState, clash: Clash): void {
  for (const side of clash.sides) {
    if (side.opening) s.discard.push(side.opening);
    s.discard.push(...side.cards);
    side.opening = side.opening ? { ...side.opening } : null;
  }
}

function refundBets(s: GameState, clash: Clash): void {
  for (const b of clash.bets) s.players[b.seat].influence += b.amount;
}

function settle(s: GameState, clash: Clash, winner: number | null): void {
  clash.resolved = true;
  clash.receipt = clash.sides.map((_, i) => ({ side: i, lines: [], total: sideTotal(s, clash, i) }));
  const sys = s.systems[clash.system];
  const salvage = lawParam(s, "salvage", 0, 0);
  const lostBy = new Map<Seat, number>();
  const lose = (seat: Seat, n: number) => {
    if (n <= 0 || seat < 0) return;
    s.players[seat].drift += n;
    lostBy.set(seat, (lostBy.get(seat) ?? 0) + n);
  };
  const latticeSeat = seatOfRace(s, "lattice");
  const latticeBefore = latticeSeat !== null ? latticeNetwork(s, latticeSeat) : 0;

  clash.sides.forEach((side, i) => {
    const won = winner === i;
    const parleyed = side.opening?.kind === "parley" && clash.log.some((e) => e.side === i && e.note === "parley");
    if (side.role === "defender") {
      if (won) {
        for (const al of side.allies) {
          if (!pledgeOf(s, clash, al.seat)) continue;
          returnAlly(s, clash, al.seat);
          s.players[al.seat].influence += al.fleets;
          s.players[al.seat].stats.allyWins++;
        }
        if (side.lead >= 0) s.players[side.lead].stats.defendWins++;
      } else {
        // Everyone holding the system loses their fleets there.
        for (const [k, n] of Object.entries(sys.fleets)) {
          const seat = Number(k);
          if (seat < 0) { delete sys.fleets[k]; continue; }
          if (n > 0 && !(winner !== null && sideSeats(clash.sides[winner]).includes(seat))) { lose(seat, n); sys.fleets[k] = 0; }
        }
        for (const al of side.allies) {
          if (!pledgeOf(s, clash, al.seat)) continue;
          if (parleyed) returnAlly(s, clash, al.seat);
          else lose(al.seat, al.fleets);
        }
        if (parleyed && side.lead >= 0) s.players[side.lead].influence += lostBy.get(side.lead) ?? 0; // Salvage
      }
    } else {
      if (won) {
        landSide(s, clash, side);
        if (side.lead >= 0) {
          s.players[side.lead].stats.attackWins++;
          const sp = lawParam(s, "spoils", 0, 0);
          s.players[side.lead].influence += sp;
        }
        for (const al of side.allies) s.players[al.seat].stats.allyWins++;
      } else if (parleyed) {
        lose(side.lead as Seat, side.fleets);
        s.players[side.lead as Seat].influence += side.fleets; // Salvage for a lone Parley
        for (const al of side.allies) returnAlly(s, clash, al.seat);
      } else {
        lose(side.lead as Seat, side.fleets);
        for (const al of side.allies) lose(al.seat, al.fleets);
      }
    }
  });
  for (const [k, v] of Object.entries(sys.fleets)) if (v <= 0) delete sys.fleets[k];
  if (salvage) for (const [seat, n] of lostBy) s.players[seat].influence += salvage * n;

  // Bets.
  const pool = clash.bets.reduce((n, b) => n + b.amount, 0);
  const winners = winner === null ? [] : clash.bets.filter((b) => b.side === winner);
  if (pool && winners.length) {
    const stake = winners.reduce((n, b) => n + b.amount, 0);
    let paid = 0;
    winners.forEach((b, i) => {
      const share = i === winners.length - 1 ? pool - paid : Math.floor((pool * b.amount) / stake);
      paid += share;
      s.players[b.seat].influence += share;
      s.players[b.seat].stats.betsWon++;
    });
    ev(s, "bets", `The betting book pays ${winners.map((b) => nm(s, b.seat)).join(", ")} from a pool of ${pool}.`, { data: { clash: clash.id } });
  } else if (pool) {
    refundBets(s, clash);
    ev(s, "bets", "Nobody backed the result; bets are returned.", { data: { clash: clash.id } });
  }

  discardClashCards(s, clash);
  const where = sys.name;
  if (winner === null) {
    ev(s, "result", `Dead heat at ${where}! Everyone in it loses their fleets.`, { loud: true, data: { clash: clash.id, system: clash.system } });
  } else {
    const w = clash.sides[winner];
    const allies = w.allies.filter((a) => pledgeOf(s, clash, a.seat)).map((a) => nm(s, a.seat));
    const total = sideTotal(s, clash, winner);
    if (w.role === "attacker") {
      ev(s, "result", `${nm(s, w.lead)}${allies.length ? ` and ${allies.join(", ")} take` : " takes"} ${where}! (${total})`, { loud: true, seats: sideSeats(w), data: { clash: clash.id, system: clash.system, winner } });
      anomaly(s, w.lead as Seat, clash.system);
    } else {
      ev(s, "result", `${nm(s, w.lead)} holds ${where}! (${total})`, { loud: true, seats: sideSeats(w), data: { clash: clash.id, system: clash.system, winner } });
    }
  }
  if (latticeSeat !== null) {
    const after = latticeNetwork(s, latticeSeat);
    if (after < latticeBefore - 1) ev(s, "shatter", `The Lattice network SHATTERS: ${latticeBefore} → ${after}.`, { seats: [latticeSeat], loud: true });
  }
}

function anomaly(s: GameState, seat: Seat, system: number): void {
  if (seat < 0 || s.systems[system].trait !== "anomaly") return;
  const roll = randInt(s, 4);
  const p = s.players[seat];
  if (roll === 0) { draw(s, seat, 2); ev(s, "anomaly", `Anomaly! ${nm(s, seat)} finds 2 cards in the ruins.`, { seats: [seat], loud: true }); }
  else if (roll === 1) { p.influence += 2; ev(s, "anomaly", `Anomaly! ${nm(s, seat)} gains 2 Influence.`, { seats: [seat], loud: true }); }
  else if (roll === 2) {
    const k = Math.min(2, p.drift);
    p.drift -= k;
    s.systems[system].fleets[seat] = (s.systems[system].fleets[seat] ?? 0) + k;
    ev(s, "anomaly", `Anomaly! ${k} of ${nm(s, seat)}'s lost fleets reappear.`, { seats: [seat], loud: true });
  } else {
    const k = Math.min(1, (s.systems[system].fleets[seat] ?? 0) - 1);
    if (k > 0) { s.systems[system].fleets[seat] -= k; p.drift += k; }
    ev(s, "anomaly", `Anomaly! A space-time hiccup costs ${nm(s, seat)} a fleet.`, { seats: [seat], loud: true });
  }
}

function resolveBets(s: GameState, a: Map<Seat, BetDecision>): void {
  const clash = currentClash(s)!;
  for (const [seat, d] of a) {
    if (d.side === null || !d.amount) continue;
    const ok = canBet(s, clash, seat);
    if (!ok || !ok.includes(d.side)) continue;
    const amount = Math.max(0, Math.min(2, s.players[seat].influence, Math.floor(d.amount)));
    if (!amount) continue;
    s.players[seat].influence -= amount;
    clash.bets.push({ seat, side: d.side, amount });
    ev(s, "bet", `${nm(s, seat)} bets ${amount} on ${nm(s, clash.sides[d.side].lead)}.`, { seats: [seat], data: { clash: clash.id } });
  }
  s.delay = clash.bets.length ? D.short : 0;
}

// ---- Reckoning ----------------------------------------------------------------------------------

function reckoning(s: GameState): void {
  ev(s, "phase", `Reckoning — Cycle ${s.cycle}`, { data: { phase: "reckoning" } });
  for (const p of s.players) {
    for (const m of p.mandates) {
      if (p.completed.includes(m)) continue;
      if (mandateDef(m).check(s, p.seat)) {
        p.completed.push(m);
        ev(s, "mandate", `${nm(s, p.seat)} completes a secret Mandate: ${mandateDef(m).name} (${mandateDef(m).text}) +2 Sway.`, { seats: [p.seat], loud: true });
      }
    }
  }
  const sw = s.players.map((p) => sway(s, p.seat));
  const best = Math.max(...sw);
  const leaders = s.players.filter((p) => sw[p.seat] === best).map((p) => p.seat);
  if (best >= s.config.swayToWin || s.cycle >= s.config.maxCycles) {
    s.winners = leaders;
    s.phase = "over";
    ev(s, "over", `${leaders.map((x) => nm(s, x)).join(" and ")} win${leaders.length > 1 ? " together" : "s"} with ${best} Sway!`, { seats: leaders, loud: true });
    s.delay = D.big;
    return;
  }
  ev(s, "standings", s.players.map((p) => `${nm(s, p.seat)} ${sw[p.seat]}`).join(" · "));
  s.phase = "dawn";
  s.delay = D.reveal;
}

