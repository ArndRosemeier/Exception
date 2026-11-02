// Bots. A bot gets exactly what a human in its seat would see (a View) and answers a Request.
//
// Tactics (the Raise, bets) simulate options with the real rule functions on a copy of the view.
// Strategy (Vectors) scores candidate targets. Politics (asks, pledges, truces) uses a trust record
// rebuilt from the public event log. Every decision carries a short `why`, which the tutorial reads out.
import { lawDef, mandateDef, raceDef } from "../engine/content.ts";
import { canBeAsked, canBet, clashById, currentClash, nullTargets, precedentValues } from "../engine/game.ts";
import {
  fleetCap, heldBy, holders, latticeNetwork, neighbours, raceOf, seatOfRace, sideSeats, sideTotal,
  spareFleets, sway, targets, winsTie,
} from "../engine/rules.ts";
import type {
  AskDecision, BetDecision, Clash, Decision, EchoEffect, LastWordDecision, LawInstance, MandatesDecision,
  ParleyDecision, PlanDecision, PledgeDecision, PowerDecision, RaceId, RaiseDecision, Request, RewindDecision,
  Seat, SummitDecision, Temperament, View,
} from "../engine/types.ts";

// ---- small utilities -------------------------------------------------------------------------

function rngFor(seed: number) {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const NUM_COUNTS = [0, 4, 5, 5, 5, 5, 4, 3, 3];
const DECK_SIZE = 46;
/** Probability that one unknown card is a number card <= v (specials count as 0). */
function pLe(v: number): number {
  let n = 8; // parley + null
  for (let i = 1; i <= Math.min(8, Math.floor(v)); i++) n += NUM_COUNTS[i];
  return Math.min(1, Math.max(0, n / DECK_SIZE));
}
/** Chance that a hand of h unknown cards holds a number card above `gap`. */
function pBeat(h: number, gap: number): number {
  if (h <= 0) return 0;
  if (gap < 0) return 1;
  return 1 - Math.pow(pLe(gap), h);
}
function expectedMax(h: number): number {
  let e = 0;
  for (let v = 1; v <= 8; v++) e += v * (Math.pow(pLe(v), h) - Math.pow(pLe(v - 1), h));
  return e;
}
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const nm = (v: View, seat: number) => (seat < 0 ? "the garrison" : v.seats[seat].name);
const sysName = (v: View, id: number) => v.systems[id].name;
const fl = (v: View, sys: number, seat: number) => Math.round(v.systems[sys].fleets[seat] ?? 0);

type Ctx = {
  v: View;
  me: Seat;
  t: Temperament;
  noise: number;     // decision noise by difficulty
  rand: () => number;
  trust: number[];   // >0 friend, <0 grudge
  sw: number[];
};

function makeCtx(v: View, req: Request): Ctx {
  const me = req.seat;
  const info = v.seats[me];
  const noise = info.difficulty === "cadet" ? 1.2 : info.difficulty === "officer" ? 0.45 : 0.12;
  const trust = v.seats.map(() => 0);
  for (const e of v.events) {
    const d = e.data ?? {};
    if (e.type === "betrayal" && e.seats?.[1] === me) trust[e.seats[0]] -= 4;
    if (e.type === "ally" && e.seats?.[1] === me) trust[e.seats[0]] += 1.5;
    if (e.type === "pay" && e.seats?.[1] === me) trust[e.seats[0]] += 0.5;
    if (e.type === "clash" && d.defender === me) for (const a of (d.attackers as number[]) ?? []) if (a >= 0) trust[a] -= 1;
    if (e.type === "truce" && e.seats?.includes(me)) for (const x of e.seats) if (x !== me) trust[x] += 0.5;
  }
  return { v, me, t: info.temperament, noise, rand: rngFor(req.id * 7919 + me * 104729 + v.cycle), trust, sw: v.seats.map((x) => sway(v, x.seat)) };
}

function jitter(c: Ctx): number {
  return (c.rand() - 0.5) * c.noise;
}

function leader(c: Ctx): Seat | null {
  const best = Math.max(...c.sw);
  const ls = c.sw.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
  return ls.length === 1 && best > 0 ? ls[0] : null;
}

function truceWith(c: Ctx, other: Seat): boolean {
  return c.v.truces.some((t) => (t.a === c.me && t.b === other) || (t.b === c.me && t.a === other));
}

/** How much a system is worth to me (Sway, traits, Mandates), in rough Sway units. */
function systemValue(c: Ctx, id: number): number {
  const v = c.v;
  const sys = v.systems[id];
  let val = sys.home === null ? 1 : sys.home === c.me ? 1.5 : 2;
  if (sys.trait === "rich") val += 0.6;
  if (sys.trait === "shipyard") val += 0.4;
  if (sys.trait === "nebula") val += 0.25;
  if (sys.trait === "anomaly") val += 0.2;
  const mine = v.players[c.me].mandates;
  for (const m of mine) {
    if (v.players[c.me].completed.includes(m)) continue;
    if (m === "rich2" && sys.trait === "rich") val += 1;
    if (m === "nebula" && sys.trait === "nebula") val += 1.5;
    if (m === "invader" && sys.home !== null && sys.home !== c.me) val += 1.5;
    if (m === "variety" && sys.trait && !heldBy(v, c.me).some((x) => v.systems[x].trait === sys.trait)) val += 0.7;
    if (m === "sprawl") val += 0.3;
  }
  if (raceOf(v, c.me) === "lattice") val += neighbours(v, id).some((n) => heldBy(v, c.me).includes(n)) ? 0.5 : 0;
  return val;
}

/** Rough strength a defender will show at a system (visible fleets + traits + expected card). */
function defenseEstimate(c: Ctx, id: number): number {
  const v = c.v;
  const sys = v.systems[id];
  const hs = holders(v, id);
  let d = Math.round(sys.fleets["-1"] ?? 0);
  for (const h of hs) d += raceOf(v, h) === "lattice" ? latticeNetwork(v, h) : Math.round(sys.fleets[h]);
  if (sys.trait === "nebula") d += 2;
  if (hs.length) {
    if (sys.home === hs[0]) d += 2; // home ground
    const home = v.laws.find((l) => l.id === "home");
    if (home) d += home.params[0];
    const lead = hs[0];
    const h = v.players[lead].hand.length;
    d += 0.55 * expectedMax(h) + 1.2; // opening card + a likely ally
  }
  return d;
}

function myAttackEstimate(c: Ctx, fleets: number): number {
  const v = c.v;
  const hand = v.players[c.me].hand.filter((x) => x.kind === "num").map((x) => x.value).sort((a, b) => b - a);
  const base = raceOf(v, c.me) === "lattice" ? latticeNetwork(v, c.me) + 1 : fleets;
  return base + (hand[0] ?? 0) * 0.6 + (hand[1] ?? 0) * 0.35 + 1;
}

// ---- entry point ------------------------------------------------------------------------------

export function botDecide(v: View, req: Request): Decision {
  const c = makeCtx(v, req);
  switch (req.kind) {
    case "mandates": return decideMandates(c);
    case "summit": return decideSummit(c);
    case "power": return decidePower(c);
    case "plan": return decidePlan(c);
    case "lastword": return decideLastWord(c);
    case "ask": return decideAsk(c);
    case "pledge": return decidePledge(c);
    case "bet": return decideBet(c, req);
    case "raise": return decideRaise(c, req);
    case "rewind": return decideRewind(c, req);
    case "parley": return decideParley(c, req);
  }
}

// ---- Mandates ---------------------------------------------------------------------------------

function decideMandates(c: Ctx): MandatesDecision {
  const t = c.t;
  const near = new Set(targets(c.v, c.me));
  const traitNear = (tr: string) => [...near].filter((id) => c.v.systems[id].trait === tr).length;
  const score: Record<string, number> = {
    rich2: 0.8 + traitNear("rich") * 0.6, nebula: 0.5 + traitNear("nebula") * 1.2, invader: 0.9 + t.risk,
    conqueror: 0.5 + t.risk, guardian: 0.5 + (1 - t.risk), friend: 0.7 + t.loyalty, banker: 0.4 + t.greed,
    sprawl: 0.4 + t.risk * 0.5, gambler: 0.6 + t.greed * 0.5, variety: 0.6,
  };
  const offer = [...c.v.players[c.me].mandateOffer];
  offer.sort((a, b) => (score[b] ?? 0) + jitter(c) - (score[a] ?? 0));
  const keep = offer.slice(0, 2);
  return { kind: "mandates", keep, why: `I keep ${keep.map((m) => mandateDef(m).name).join(" and ")}: they fit my position and temperament.` };
}

// ---- Laws (Amenders, Summit) ------------------------------------------------------------------

/** How good a Law (with these params) is for me compared to the average opponent. Rough. */
function lawValue(c: Ctx, law: LawInstance | null, id?: string): number {
  const v = c.v;
  const lid = law?.id ?? id!;
  const p = law ? law.params[0] ?? 0 : 0;
  const mine = heldBy(v, c.me);
  const rich = mine.filter((x) => v.systems[x].trait === "rich").length;
  const avgRich = v.seats.reduce((n, s) => n + heldBy(v, s.seat).filter((x) => v.systems[x].trait === "rich").length, 0) / v.seats.length;
  const spare = spareFleets(v, c.me);
  const infl = v.players[c.me].influence;
  switch (lid) {
    case "home": return p * (0.3 - c.t.risk * 0.3 + (c.sw[c.me] >= Math.max(...c.sw) ? 0.3 : 0));
    case "ties": return (law?.word ?? "defender") === "defender" ? 0.2 - c.t.risk * 0.3 : c.t.risk * 0.3 - 0.1;
    case "cap": return (p - 4) * (spare > 6 ? 0.3 : -0.1);
    case "tax": return -p * (infl < 3 ? 0.3 : 0.1);
    case "salvage": return p * 0.15;
    case "boom": return p * (rich - avgRich) * 0.4;
    case "docks": return p * (v.players[c.me].drift > 2 ? 0.3 : 0.05);
    case "hand": return (p - 7) * 0.1;
    case "spoils": return p * c.t.risk * 0.25;
    case "underdog": return p * (c.sw[c.me] < Math.max(...c.sw) ? 0.2 : -0.1);
    case "raises": return raceOf(v, c.me) === "archivists" || raceOf(v, c.me) === "recurrent" ? (p - 3) * 0.2 : 0;
  }
  return 0;
}

function decidePower(c: Ctx): PowerDecision {
  const race = raceOf(c.v, c.me);
  if (race === "amenders") {
    let best: { d: PowerDecision["amend"]; gain: number; text: string } | null = null;
    c.v.laws.forEach((law, li) => {
      const def = lawDef(law.id);
      const base = lawValue(c, law);
      def.params.forEach((p, pi) => {
        for (const dv of [-1, 1]) {
          const nv = law.params[pi] + dv;
          if (nv < p.min || nv > p.max) continue;
          const copy = { ...law, params: law.params.map((x, i) => (i === pi ? nv : x)) };
          const gain = lawValue(c, copy) - base + jitter(c) * 0.3;
          const text = `${def.name}: ${p.label} ${law.params[pi]} → ${nv}`;
          if (!best || gain > best.gain) best = { d: { law: li, param: pi, value: nv }, gain, text };
        }
      });
      for (const w of def.words ?? []) {
        if (w === law.word) continue;
        const gain = lawValue(c, { ...law, word: w }) - base + jitter(c) * 0.3;
        if (!best || gain > best.gain) best = { d: { law: li, word: w }, gain, text: `${def.name}: ties go to the ${w}` };
      }
    });
    const b = best as { d: PowerDecision["amend"]; gain: number; text: string } | null;
    if (b && b.gain > -0.15) return { kind: "power", amend: b.d, why: `I amend ${b.text}, which tilts the rules my way.` };
    return { kind: "power", amend: null, why: "No edit helps me more than it helps the others, so I leave the Laws alone." };
  }
  if (race === "foldwrights") {
    const v = c.v;
    const mine = heldBy(v, c.me);
    const reach = new Set(targets(v, c.me));
    let best: { a: number; b: number; score: number } | null = null;
    for (const a of mine) {
      for (const b of v.systems.map((x) => x.id)) {
        if (a === b || reach.has(b) || mine.includes(b) || v.adjacency[a].includes(b)) continue;
        const score = systemValue(c, b) - defenseEstimate(c, b) * 0.25 + jitter(c);
        if (!best || score > best.score) best = { a, b, score };
      }
    }
    if (best && best.score > 0) return { kind: "power", fold: { a: best.a, b: best.b }, why: `I fold ${sysName(v, best.a)} next to ${sysName(v, best.b)} so I can reach a juicy target.` };
    return { kind: "power", fold: null, why: "No fold opens anything worth the risk of others using it." };
  }
  return { kind: "power" };
}

function decideSummit(c: Ctx): SummitDecision {
  const offer = c.v.summitOffer;
  let li = 0, best = -Infinity;
  offer.forEach((l, i) => { const val = lawValue(c, l) + jitter(c) * 0.3; if (val > best) { best = val; li = i; } });
  let ri = 0, worst = Infinity;
  c.v.laws.forEach((l, i) => { const val = lawValue(c, l); if (val < worst) { worst = val; ri = i; } });
  const diff = best - (c.v.laws.length >= 3 ? worst : 0);
  const infl = c.v.players[c.me].influence;
  const bid = Math.max(0, Math.min(infl - 1, 4, Math.round(diff * 3 + c.t.greed * 1.5 + jitter(c))));
  return { kind: "summit", law: li, replace: ri, bid, why: bid ? `I bid ${bid} to install ${lawDef(offer[li].id).name}.` : "None of these Laws is worth my Influence." };
}

// ---- Plan / Vectors ---------------------------------------------------------------------------

type Candidate = { target: number; fleets: number; score: number; why: string };

function scoreTargets(c: Ctx, late = false): Candidate[] {
  const v = c.v;
  const spare = Math.min(spareFleets(v, c.me), fleetCap(v));
  if (spare < 1) return [];
  const lead = leader(c);
  const out: Candidate[] = [];
  for (const id of targets(v, c.me)) {
    const hs = holders(v, id);
    const sys = v.systems[id];
    let value = systemValue(c, id);
    const reasons: string[] = [];
    if (sys.trait) reasons.push(`it's ${sys.trait}`);
    if (sys.home !== null && sys.home !== c.me) reasons.push(`it's ${nm(v, sys.home)}'s home (2 Sway)`);
    if (sys.home === c.me) reasons.push("it's my own home and I want it back");
    let penalty = 0;
    for (const h of hs) {
      if (truceWith(c, h)) { penalty += 1.5 + 3 * c.t.loyalty; }
      if (c.trust[h] < 0) { value += -c.trust[h] * 0.25 * c.t.vengeance; reasons.push(`${nm(v, h)} wronged me`); }
      if (h === lead && h !== c.me) { value += 0.6; reasons.push(`${nm(v, h)} is leading`); }
    }
    let def = defenseEstimate(c, id) + (late ? 2 : 0);
    // Arriving late into someone else's fight means a messy multi-way Clash.
    if (late) def += v.vectors.filter((x) => x.target === id).length * 4;
    const isLattice = raceOf(v, c.me) === "lattice";
    // Send enough to have a fair chance, more if bold; the Lattice only needs one ship.
    let f = Math.max(1, Math.min(spare, Math.ceil(def - 3 + c.t.risk * 2)));
    if (def > 4) f = spare;
    if (isLattice) f = Math.max(1, Math.min(spare, 2)); // its ships don't add strength, but they still hold what it takes
    const mine = myAttackEstimate(c, f);
    const p = sigmoid((mine - def) / 2.5);
    const loss = (1 - p) * f * 0.3 * (1.2 - c.t.risk);
    const score = p * value * (0.8 + c.t.greed * 0.4) - loss - penalty + jitter(c);
    const odds = p > 0.65 ? "good odds" : p > 0.4 ? "a fair fight" : "a long shot";
    out.push({ target: id, fleets: f, score, why: `${sysName(v, id)}: ${reasons.length ? reasons.join(", ") : "it's open"}. I expect about ${Math.round(def)} against my ${Math.round(mine)} — ${odds}.` });
  }
  return out.sort((a, b) => b.score - a.score);
}

function decidePlan(c: Ctx): PlanDecision {
  const v = c.v;
  const cands = scoreTargets(c);
  const best = cands[0];
  const d: PlanDecision = { kind: "plan", target: null, fleets: 0, why: "I keep my fleets home this Cycle." };
  if (best && best.score > -0.4) {
    d.target = best.target;
    d.fleets = best.fleets;
    d.why = `I send ${best.fleets} fleet${best.fleets > 1 ? "s" : ""} at ${best.why}`;
  }
  const race = raceOf(v, c.me);
  if (race === "undertow") {
    // Plant on the leader's most crowded system, timed for next Cycle.
    const lead = leader(c);
    const victims = v.seats.map((x) => x.seat).filter((x) => x !== c.me);
    const prey = lead !== null && lead !== c.me ? lead : victims[Math.floor(c.rand() * victims.length)];
    const sys = heldBy(v, prey).sort((a, b) => fl(v, b, prey) - fl(v, a, prey))[0];
    if (sys !== undefined) {
      const effect: EchoEffect = fl(v, sys, prey) >= 3 ? "destroy" : v.players[prey].influence >= 4 ? "steal" : c.rand() < 0.5 ? "discard" : "cancel";
      d.echo = { system: sys, effect, delay: c.rand() < 0.7 ? 1 : 2 };
      d.why += ` I also plant a ${effect} Echo under ${nm(v, prey)}'s ${sysName(v, sys)}.`;
    }
  }
  if (race === "murmur") {
    const mine = heldBy(v, c.me).sort((a, b) => fl(v, a, c.me) - fl(v, b, c.me));
    const lies: NonNullable<PlanDecision["lies"]> = [];
    if (mine[0] !== undefined) lies.push({ system: mine[0], preset: "plus3", target: "all" });
    if (mine.length > 1 && c.t.bluff > 0.4) lies.push({ system: mine[mine.length - 1], preset: "empty", target: "all" });
    if (lies.length && !v.lies.some((l) => lies.some((x) => x.system === l.system))) {
      d.lies = lies;
      d.why += " I whisper that my weak system is strong" + (lies.length > 1 ? " and my strong one is empty." : ".");
    }
  }
  if (race === "tithe") {
    const order: RaceId[] = ["amenders", "foldwrights", "recurrent", "lastword", "undertow", "archivists", "murmur"];
    const present = order.filter((r) => r !== "tithe" && v.seats.some((x) => x.race === r));
    const pickd = present.sort(() => c.rand() - 0.5).slice(0, 2);
    // Amenders and Foldwrights fire every Cycle: watch them when present.
    const sure = present.filter((r) => r === "amenders" || r === "foldwrights");
    d.tithe = [...new Set([...sure, ...pickd])].slice(0, 2);
    if (d.tithe.length) d.why += ` I watch the ${d.tithe.map((r) => raceDef(r).short).join(" and ")}.`;
  }
  return d;
}

function decideLastWord(c: Ctx): LastWordDecision {
  const v = c.v;
  // The Last Word sees every Vector: systems emptied by attackers become cheap.
  const cands = scoreTargets(c, true);
  const best = cands[0];
  if (best && best.score > -0.2) {
    return { kind: "lastword", target: best.target, fleets: best.fleets, why: `Everyone has shown their hand. I strike ${best.why}` };
  }
  return { kind: "lastword", target: null, fleets: 0, why: `Nothing on ${v.cycle ? "this" : "the"} fight card is worth a late arrival.` };
}

// ---- Council ----------------------------------------------------------------------------------

/** Visible-strength estimate for each side of a clash (unknown cards and pledges estimated). */
function clashEstimate(c: Ctx, clash: Clash): number[] {
  const v = c.v;
  return clash.sides.map((side, i) => {
    let t = sideTotal(v, clash, i);
    if (side.lead >= 0) {
      if (!side.openingRevealed) {
        if (side.lead === c.me) t += side.opening?.kind === "num" ? side.opening.value : 0;
        else if (side.opening || v.players[side.lead].hand.length) t += 3.5;
      }
      const h = v.players[side.lead].hand.length;
      t += 0.35 * expectedMax(h);
      if (v.phase === "ask" || v.phase === "pledge" || (v.show?.beat === "bets")) {
        const asked = v.asks.filter((a) => a.clash === clash.id && a.from === side.lead).length;
        t += Math.min(2, asked) * 0.9;
      }
    }
    return t;
  });
}

function decideAsk(c: Ctx): AskDecision {
  const v = c.v;
  const asks: AskDecision["asks"] = [];
  const reasons: string[] = [];
  let budget = v.players[c.me].influence;
  for (const clash of v.clashes) {
    const idx = clash.sides.findIndex((x) => x.lead === c.me);
    if (idx < 0) continue;
    const est = clashEstimate(c, clash);
    const opp = Math.max(...est.filter((_, i) => i !== idx));
    const need = opp - est[idx] + 2;
    const enemies = new Set(clash.sides.filter((_, i) => i !== idx).flatMap(sideSeats));
    const cands = v.seats.map((x) => x.seat)
      .filter((s) => s !== c.me && canBeAsked(v, clash, s) && spareFleets(v, s) > 0)
      .map((s) => ({ s, score: c.trust[s] + (enemies.has(s) ? -9 : 0) + (leader(c) === s ? -1 : 0) + v.seats.length * 0 + jitter(c) - (c.sw[s] ?? 0) * 0.1 }))
      .sort((a, b) => b.score - a.score);
    const howMany = need > 0 ? 2 : 1;
    const chosen = cands.slice(0, howMany);
    for (const ch of chosen) {
      const offer = need > 0 ? Math.min(Math.floor(budget / Math.max(1, chosen.length)), Math.round(1 + (1 - c.t.greed) * 2)) : 0;
      budget -= offer;
      asks.push({ clash: clash.id, to: ch.s, offer });
    }
    if (chosen.length) reasons.push(`at ${sysName(v, clash.system)} I ask ${chosen.map((x) => nm(v, x.s)).join(" and ")}${need > 0 ? " because I'm likely behind" : " just in case"}`);
  }
  // Truces: offer one to a strong neighbour if I'm the peaceful type.
  const truces: Seat[] = [];
  if (c.t.loyalty > 0.35 && c.rand() < 0.5 + c.t.loyalty * 0.3) {
    const mine = new Set(heldBy(v, c.me));
    const near = new Map<Seat, number>();
    for (const id of mine) for (const n of neighbours(v, id)) for (const h of holders(v, n)) if (h !== c.me) near.set(h, (near.get(h) ?? 0) + fl(v, n, h));
    const best = [...near.entries()].filter(([s]) => !truceWith(c, s) && c.trust[s] >= 0 && s !== leader(c)).sort((a, b) => b[1] - a[1])[0];
    if (best) { truces.push(best[0]); reasons.push(`I offer ${nm(v, best[0])} a truce to secure my border`); }
  }
  return { kind: "ask", asks, truces, why: reasons.length ? cap(reasons.join("; ")) + "." : "I have nothing to ask for this Cycle." };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function decidePledge(c: Ctx): PledgeDecision {
  const v = c.v;
  const out: PledgeDecision = { kind: "pledge", pledges: [], openings: [], acceptTruces: [], audit: null };
  const reasons: string[] = [];
  let spare = spareFleets(v, c.me);
  const lead = leader(c);

  // Openings for my own Clashes.
  const hand = v.players[c.me].hand.filter((x) => x.kind === "num").sort((a, b) => a.value - b.value);
  const used = new Set<number>();
  for (const clash of v.clashes) {
    const idx = clash.sides.findIndex((x) => x.lead === c.me);
    if (idx < 0) continue;
    const est = clashEstimate(c, clash);
    const opp = Math.max(...est.filter((_, i) => i !== idx));
    const free = hand.filter((x) => !used.has(x.id));
    const parley = v.players[c.me].hand.find((x) => x.kind === "parley" && !used.has(x.id));
    const hopeless = est[idx] + (free[free.length - 1]?.value ?? 0) * 1.5 < opp - 3;
    if (parley && (hopeless || (c.t.bluff > 0.7 && c.rand() < 0.15))) {
      out.openings.push({ clash: clash.id, card: parley.id });
      used.add(parley.id);
      reasons.push(`I open with Parley at ${sysName(v, clash.system)}: ${hopeless ? "I can't win this one" : "let's see if they deal"}`);
      continue;
    }
    if (!free.length) { out.openings.push({ clash: clash.id, card: null }); continue; }
    // Open with a middling card and keep the best for the Raise; open big when far behind.
    const pick = opp - est[idx] > 5 ? free[free.length - 1] : free[Math.floor((free.length - 1) / 2)];
    used.add(pick.id);
    out.openings.push({ clash: clash.id, card: pick.id });
    reasons.push(`I open with a ${pick.value} at ${sysName(v, clash.system)}`);
  }

  // Pledges: weigh each request.
  const myAsks = v.asks.filter((a) => a.to === c.me);
  const byClash = new Map<number, typeof myAsks>();
  for (const a of myAsks) byClash.set(a.clash, [...(byClash.get(a.clash) ?? []), a]);
  const options: { clash: number; side: number; fleets: number; score: number; text: string }[] = [];
  for (const [cid, asks] of byClash) {
    const clash = clashById(v, cid);
    if (!clash) continue;
    const est = clashEstimate(c, clash);
    for (const ask of asks) {
      const side = clash.sides.findIndex((x) => x.lead === ask.from);
      if (side < 0) continue;
      const f = Math.max(1, Math.min(spare, 1 + Math.round(c.t.loyalty + c.t.risk)));
      const mine = [...est];
      mine[side] += f;
      const other = Math.max(...mine.filter((_, i) => i !== side));
      const p = sigmoid((mine[side] - other) / 2.5);
      const prize = clash.sides[side].role === "attacker" ? systemValue(c, clash.system) * 0.8 : f * 0.35;
      const opponents = clash.sides.filter((_, i) => i !== side).flatMap(sideSeats);
      let rel = c.trust[ask.from] * 0.3;
      for (const o of opponents) {
        if (c.trust[o] < 0) rel += -c.trust[o] * 0.2 * c.t.vengeance;
        if (o === lead) rel += 0.8;
        if (truceWith(c, o)) rel -= 0.6 * c.t.loyalty;
      }
      if (ask.from === lead && c.sw[ask.from] >= v.config.swayToWin - 3) rel -= 2;
      const score = p * (prize + ask.offer * 0.4 * (0.5 + c.t.greed)) - (1 - p) * f * 0.3 + rel + jitter(c) - 0.25;
      options.push({ clash: cid, side, fleets: f, score, text: `${nm(v, ask.from)} at ${sysName(v, clash.system)}${ask.offer ? ` for ${ask.offer} Influence` : ""}` });
    }
  }
  options.sort((a, b) => b.score - a.score);
  const done = new Set<number>();
  for (const o of options) {
    if (o.score <= 0 || done.has(o.clash) || spare < 1) continue;
    const f = Math.min(o.fleets, spare);
    out.pledges.push({ clash: o.clash, side: o.side, fleets: f });
    spare -= f;
    done.add(o.clash);
    reasons.push(`I secretly pledge ${f} fleet${f > 1 ? "s" : ""} to ${o.text}`);
  }
  if (!out.pledges.length && options.length) reasons.push("I turn down every request for help");

  // Truces offered to me.
  for (const p of v.proposals.filter((x) => x.to === c.me)) {
    const ok = c.trust[p.from] >= -1 && c.rand() < 0.3 + c.t.loyalty * 0.6 && p.from !== lead;
    if (ok) { out.acceptTruces.push(p.from); reasons.push(`I accept ${nm(v, p.from)}'s truce`); }
  }

  // Audit the Murmur if something looks off (better bots are less gullible).
  const m = seatOfRace(v, "murmur");
  if (m !== null && m !== c.me && v.players[c.me].influence >= 4) {
    const skill = v.seats[c.me].difficulty === "admiral" ? 0.8 : v.seats[c.me].difficulty === "officer" ? 0.4 : 0.05;
    const odd = heldBy(v, m).filter((id) => { const f = v.systems[id].fleets[m] ?? 0; return f < 0.5 || f >= 7; });
    const relevant = odd.find((id) => v.clashes.some((cl) => cl.system === id) || targets(v, c.me).includes(id));
    if (relevant !== undefined && c.rand() < skill) {
      out.audit = relevant;
      reasons.push(`the Murmur's count on ${sysName(v, relevant)} smells wrong, so I Audit`);
    }
  }
  out.why = reasons.length ? cap(reasons.join("; ")) + "." : "Nothing to pledge this Council.";
  return out;
}

// ---- Showtime ---------------------------------------------------------------------------------

function winChance(c: Ctx, clash: Clash): number[] {
  const est = clashEstimate(c, clash);
  const ex = est.map((x) => Math.exp(x / 2.5));
  const sum = ex.reduce((a, b) => a + b, 0);
  return ex.map((x) => x / sum);
}

function decideBet(c: Ctx, req: Request): BetDecision {
  const v = c.v;
  const clash = clashById(v, req.clash)!;
  const allowed = canBet(v, clash, c.me) ?? [];
  const p = winChance(c, clash);
  let best = allowed[0], bp = -1;
  for (const i of allowed) {
    let val = p[i] + jitter(c) * 0.2;
    const sideLead = clash.sides[i].lead;
    if (sideLead >= 0 && raceOf(v, sideLead) === "adored") val += 0.08; // the crowd loves a star
    if (val > bp) { bp = val; best = i; }
  }
  const pledgedHere = allowed.length === 1;
  const threshold = 0.62 - c.t.greed * 0.15 - c.t.risk * 0.1;
  if (best === undefined || (bp < threshold && !pledgedHere)) return { kind: "bet", side: null, amount: 0, why: "Too close to call; I keep my Influence." };
  const amount = bp > 0.8 || (pledgedHere && c.t.greed > 0.5) ? 2 : 1;
  return { kind: "bet", side: best, amount, why: `I bet ${amount} on ${nm(v, clash.sides[best].lead)}${pledgedHere ? ", the side I'm backing anyway" : ` (I give them about ${Math.round(p[best] * 100)}%)`}.` };
}

function stakesOf(c: Ctx, clash: Clash, idx: number): number {
  const side = clash.sides[idx];
  const sys = clash.system;
  const fleets = side.fleets + side.allies.reduce((n, a) => n + a.fleets, 0);
  if (side.role === "attacker") return systemValue(c, sys) + side.fleets * 0.35;
  return systemValue(c, sys) + fleets * 0.35 + (c.v.systems[sys].home === c.me ? 1 : 0);
}

/** Simulate one raise option on a copy of the view and report where I stand afterwards. */
function simulate(c: Ctx, clash: Clash, idx: number, apply: (cl: Clash, v: View) => void): { gap: number; ahead: boolean } {
  const v2 = structuredClone(c.v) as View;
  const cl = v2.clashes.find((x) => x.id === clash.id)!;
  apply(cl, v2);
  const t = cl.sides.map((_, i) => sideTotal(v2, cl, i));
  const others = cl.sides.map((_, i) => i).filter((i) => i !== idx && !cl.sides[i].folded);
  let gap = Infinity, ahead = true;
  for (const o of others) {
    const g = t[idx] - t[o];
    gap = Math.min(gap, g);
    if (g < 0 || (g === 0 && !winsTie(v2, cl, idx, o))) ahead = false;
  }
  return { gap, ahead };
}

function decideRaise(c: Ctx, req: Request): RaiseDecision {
  const v = c.v;
  const clash = clashById(v, req.clash) ?? currentClash(v)!;
  const idx = clash.sides.findIndex((x) => x.lead === c.me);
  const stakes = stakesOf(c, clash, idx);
  const opp = clash.sides.map((x, i) => ({ x, i })).filter((o) => o.i !== idx && !o.x.folded);
  const oppHand = Math.max(0, ...opp.map((o) => (o.x.lead >= 0 ? v.players[o.x.lead].hand.length : 0)));
  const oppCanRaise = opp.some((o) => o.x.lead >= 0 && o.x.raises < (v.laws.find((l) => l.id === "raises")?.params[0] ?? 3));
  const recurrentFoe = opp.some((o) => sideSeats(o.x).some((s) => raceOf(v, s) === "recurrent")) && !v.players[seatOfRace(v, "recurrent") ?? 0]?.usedThisCycle?.recurrent;

  type Opt = { d: RaiseDecision; value: number; text: string };
  const opts: Opt[] = [{ d: { kind: "raise", action: "fold" }, value: 0, text: "fold and save my cards" }];
  const evalOpt = (r: { gap: number; ahead: boolean }, cost: number) => {
    if (!r.ahead) return -cost * 0.1 - 0.05;
    const pOver = oppCanRaise ? pBeat(oppHand, r.gap) * 0.75 : 0;
    const pWin = (1 - pOver) * (recurrentFoe ? 0.75 : 1);
    return pWin * stakes - cost * (0.1 + 0.05 * (1 - c.t.risk));
  };
  const hand = v.players[c.me].hand;
  for (const card of hand) {
    if (card.kind === "num") {
      const r = simulate(c, clash, idx, (cl) => { cl.sides[idx].cards.push(card); });
      opts.push({ d: { kind: "raise", action: "card", card: card.id }, value: evalOpt(r, card.value) + jitter(c) * 0.3, text: `raise with my ${card.value}` });
    }
  }
  const nullCard = hand.find((x) => x.kind === "null");
  if (nullCard && v.seats[c.me].difficulty !== "cadet") {
    for (const race of nullTargets(v, clash, idx)) {
      const r = simulate(c, clash, idx, (cl) => { cl.nulled.push(race); });
      opts.push({ d: { kind: "raise", action: "null", card: nullCard.id, target: race }, value: evalOpt(r, 2), text: `NULL the ${raceDef(race).short}` });
    }
  }
  for (const val of precedentValues(v, c.me)) {
    if (clash.nulled.includes("archivists")) break;
    const r = simulate(c, clash, idx, (cl) => { cl.sides[idx].precedents.push(Math.max(1, val - 2)); });
    opts.push({ d: { kind: "raise", action: "precedent", value: val }, value: evalOpt(r, Math.ceil(val / 2) * 1.2), text: `cite PRECEDENT for a ${val} (costs ${Math.ceil(val / 2)} Influence)` });
  }
  opts.sort((a, b) => b.value - a.value);
  const best = opts[0];
  const t = sideTotal(v, clash, idx);
  const top = Math.max(...opp.map((o) => sideTotal(v, clash, o.i)));
  best.d.why = best.d.action === "fold"
    ? `I'm at ${t} against ${top}. No card gets me ahead at a price worth paying, so I fold.`
    : `I'm at ${t} against ${top}. I ${best.text}${oppCanRaise ? `; they hold ${oppHand} card${oppHand === 1 ? "" : "s"} and may answer` : " and they're out of raises"}.`;
  return best.d;
}

function decideRewind(c: Ctx, req: Request): RewindDecision {
  const v = c.v;
  const clash = clashById(v, req.clash)!;
  const idx = clash.sides.findIndex((x) => sideSeats(x).includes(c.me));
  const stakes = stakesOf(c, clash, idx);
  const yes = stakes > 1.2 || c.rand() < 0.4;
  return { kind: "rewind", rewind: yes, why: yes ? "I'm losing, and this one matters. Time to REWIND — I'll remember what they played." : "This Clash isn't worth my once-per-Cycle rewind." };
}

function decideParley(c: Ctx, req: Request): ParleyDecision {
  const v = c.v;
  const clash = clashById(v, req.clash)!;
  const idx = clash.sides.findIndex((x) => x.lead === c.me);
  const est = clashEstimate(c, clash);
  const role = clash.sides[idx].role;
  const choice = role === "attacker" ? "cohold" : est[idx] < est[1 - idx] + 1 ? "cohold" : "withdraw";
  return { kind: "parley", choice, why: choice === "cohold" ? "Sharing the system beats fighting over it." : "I'll only deal if they leave." };
}

