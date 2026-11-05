import { useEffect, useRef, useState } from "preact/hooks";
import { audio } from "../app/audio.ts";
import type { Sfx, Track } from "../app/audio.ts";
import { botDecide } from "../bots/bot.ts";
import { lawDef, lawText, mandateDef, raceDef } from "../engine/content.ts";
import { canBet, clashById } from "../engine/game.ts";
import { heldBy, seatOfRace, sway } from "../engine/rules.ts";
import type { Decision, GameEvent, RaceId, Request, Seat, View } from "../engine/types.ts";
import type { Lesson, Thought } from "../tutorial/tutor.ts";
import { CardView, Portrait } from "./common.tsx";
import { DecisionPanel } from "./Decision.tsx";
import type { MapMode } from "./Decision.tsx";
import { MapView } from "./MapView.tsx";
import { SoundControls } from "./Settings.tsx";
import { CountUp, Stage } from "./Stage.tsx";

export type Controls = {
  speed: number; setSpeed: (n: number) => void;
  paused: boolean; setPaused: (p: boolean) => void;
  step?: () => void;
  autopilot?: boolean; setAutopilot?: (on: boolean) => void;
};

export type TutorProps = { lesson: Lesson | null; thoughts: Thought[]; dismiss: () => void; pauseOnLessons: boolean; setPauseOnLessons: (b: boolean) => void };

type Props = {
  view: View;
  me: Seat | null;
  onDecide?: (d: Decision) => void;
  controls?: Controls;
  tutor?: TutorProps;
  onExit: () => void;
  label?: string;
  extraTop?: preact.ComponentChildren;
};

// The Cycle as five simple steps. Engine phases map onto them.
type Step = "dawn" | "plan" | "launch" | "council" | "showtime" | "reckoning";
const STEPS: { id: Step; name: string; sub: string }[] = [
  { id: "dawn", name: "Dawn", sub: "Income, fresh fleets, new cards" },
  { id: "plan", name: "Plan", sub: "Everyone secretly picks a target" },
  { id: "launch", name: "Launch", sub: "All fleets fly at once" },
  { id: "council", name: "Council", sub: "Fighters beg for allies, in public" },
  { id: "showtime", name: "Showtime", sub: "Cards flip. Someone wins." },
  { id: "reckoning", name: "Reckoning", sub: "Count the Sway" },
];
function stepOf(phase: string): Step | null {
  switch (phase) {
    case "dawn": case "summit": case "power": return "dawn";
    case "plan": return "plan";
    case "convergence": case "lastword": return "launch";
    case "ask": case "pledge": return "council";
    case "showtime": return "showtime";
    case "reckoning": return "reckoning";
    default: return null;
  }
}

const SFX: Record<string, Sfx> = {
  clash: "reveal", opening: "card", raise: "card", ally: "reveal", fold: "fold", rewind: "rewind", betrayal: "betrayal",
  null: "stamp", tithed: "stamp", amend: "stamp", echo: "echo", bet: "coin", pay: "coin", lastword: "alarm", result: "impact",
  precedent: "card", audit: "stamp", "fold-space": "reveal", mandate: "win", "summit-win": "stamp", shatter: "echo",
};

const TOAST: Record<string, { big: string; tone: string }> = {
  betrayal: { big: "BETRAYAL", tone: "red" }, amend: { big: "AMENDED", tone: "cyan" }, "fold-space": { big: "SPACE FOLDS", tone: "green" },
  echo: { big: "ECHO", tone: "red" }, audit: { big: "AUDIT", tone: "" }, tithed: { big: "TITHED", tone: "" },
  lastword: { big: "LAST WORD", tone: "red" }, mandate: { big: "MANDATE", tone: "green" }, "summit-win": { big: "LAW SUMMIT", tone: "cyan" },
  final: { big: "FINAL CYCLE", tone: "" }, shatter: { big: "SHATTERED", tone: "red" }, rewind: { big: "REWIND", tone: "cyan" },
  anomaly: { big: "ANOMALY", tone: "green" }, over: { big: "GAME OVER", tone: "green" }, summit: { big: "LAW SUMMIT", tone: "cyan" },
};
const SHAKE = new Set(["betrayal", "echo", "shatter", "lastword"]);

function musicFor(phase: string): Track {
  if (phase === "over") return "victory";
  if (phase === "ask" || phase === "pledge" || phase === "lastword") return "council";
  if (phase === "showtime") return "showtime";
  return "plan";
}

/** Requests with nothing to choose are answered automatically, so the game doesn't stop for them. */
function autoAnswer(v: View, me: Seat, req: Request): Decision | null {
  if (req.kind === "pledge") {
    const asked = v.asks.some((a) => a.to === me);
    const fighting = v.clashes.some((c) => c.sides.some((s) => s.lead === me));
    const truce = v.proposals.some((x) => x.to === me);
    const murmur = seatOfRace(v, "murmur");
    const audit = murmur !== null && murmur !== me && v.players[me].influence >= 2;
    if (!asked && !fighting && !truce && !audit) return { kind: "pledge", pledges: [], openings: [], acceptTruces: [], audit: null };
  }
  if (req.kind === "bet") {
    const c = clashById(v, req.clash);
    if (!c || !(canBet(v, c, me)?.length)) return { kind: "bet", side: null, amount: 0 };
  }
  return null;
}

/** Plain words for what the advisor would do. */
function describe(v: View, req: Request, d: Decision): string {
  const sys = (id: number) => v.systems[id]?.name ?? "?";
  switch (d.kind) {
    case "plan": case "lastword": return d.target === null ? "Stay home this Cycle." : `Send ${d.fleets} fleet${d.fleets > 1 ? "s" : ""} to ${sys(d.target)}.`;
    case "raise": return d.action === "fold" ? "Fold." : d.action === "card" ? `Raise with your ${v.players[v.viewer ?? 0].hand.find((c) => c.id === d.card)?.value ?? ""}.` : d.action === "null" ? `NULL the ${raceDef(d.target!).short}.` : `PRECEDENT ${d.value}.`;
    case "bet": return d.side === null ? "Don't bet." : `Bet ${d.amount} on ${v.seats[clashById(v, req.clash ?? -1)?.sides[d.side].lead ?? -1]?.name ?? "the garrison"}.`;
    case "rewind": return d.rewind ? "Rewind!" : "Accept the loss.";
    case "ask": return d.asks.length ? `Ask ${[...new Set(d.asks.map((a) => v.seats[a.to].name))].join(" and ")} for help.` : "Ask nobody.";
    case "pledge": return d.pledges.length ? `Back ${d.pledges.map((p) => v.seats[clashById(v, p.clash)?.sides[p.side].lead ?? -1]?.name ?? "the garrison").join(" and ")}.` : "Keep your fleets home.";
    case "summit": return d.bid ? `Bid ${d.bid} for ${lawDef(v.summitOffer[d.law]?.id ?? "").name}.` : "Don't bid.";
    case "mandates": return `Keep ${d.keep.map((m) => mandateDef(m).name).join(" and ")}.`;
    default: return "";
  }
}

export function GameScreen({ view: v, me, onDecide, controls, tutor, onExit, label, extraTop }: Props) {
  const [mapMode, setMapMode] = useState<MapMode>(null);
  const [toasts, setToasts] = useState<{ id: number; ev: GameEvent }[]>([]);
  const [raceCard, setRaceCard] = useState<RaceId | null>(null);
  const [now, setNow] = useState(Date.now());
  const [banner, setBanner] = useState<{ id: number; step: Step; cycle: number } | null>(null);
  const [shake, setShake] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [advice, setAdvice] = useState<{ req: number; d: Decision } | null>(null);
  const lastN = useRef(-1);
  const lastStep = useRef<Step | null>(null);
  const [flashLaw, setFlashLaw] = useState<string | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  useEffect(() => { audio.music(musicFor(v.phase)); }, [v.phase]);

  // A title card whenever the Cycle moves to its next step.
  const step = stepOf(v.phase);
  useEffect(() => {
    if (!step || step === lastStep.current) return;
    lastStep.current = step;
    const id = Math.random();
    setBanner({ id, step, cycle: Math.max(1, v.cycle) });
    audio.sfx(step === "launch" ? "launch" : "whoosh");
    const t = setTimeout(() => setBanner((b) => (b?.id === id ? null : b)), 1700);
    return () => clearTimeout(t);
  }, [step]);

  // New events: sounds, toasts, law flashes, screen shake.
  useEffect(() => {
    const fresh = v.events.filter((e) => e.n > lastN.current);
    if (lastN.current >= 0) {
      for (const e of fresh) {
        const sfx = SFX[e.type];
        if (sfx && (e.loud || e.type !== "lastword")) audio.sfx(sfx);
        if (e.loud && TOAST[e.type]) {
          const id = Math.random();
          setToasts((t) => [...t.slice(-2), { id, ev: e }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3300);
        }
        if (SHAKE.has(e.type)) setShake((n) => n + 1);
        if (e.type === "amend" && e.data?.law) { setFlashLaw(e.data.law as string); setTimeout(() => setFlashLaw(null), 1700); }
      }
    }
    if (v.events.length) lastN.current = v.events[v.events.length - 1].n;
  }, [v.events.length]);

  const myReq = me !== null ? v.pending.find((r) => r.seat === me && !v.answers[r.id]) : undefined;
  const auto = myReq && onDecide && me !== null ? autoAnswer(v, me, myReq) : null;
  useEffect(() => { if (auto && onDecide) onDecide(auto); }, [myReq?.id, !!auto]);
  const waitingOnMe = me !== null && v.pending.some((r) => r.seat === me) && !myReq;
  const deadline = myReq?.deadline ?? v.pending.find((r) => r.deadline)?.deadline;
  const secs = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const acting = new Set(v.pending.filter((r) => !v.answers[r.id] || r.seat !== me).map((r) => r.seat));
  const feed = [...v.events].reverse().filter((e) => e.type !== "phase");
  const shownFeed = logOpen ? feed.slice(0, 120) : feed.slice(0, 5);
  const ask = () => {
    if (!myReq) return;
    try { setAdvice({ req: myReq.id, d: botDecide(structuredClone(v), myReq) }); } catch { /* the advisor is optional */ }
  };
  const currentAdvice = advice && myReq && advice.req === myReq.id ? advice.d : null;

  return (
    <div class={`game ${shake % 2 ? "shake-a" : shake ? "shake-b" : ""}`}>
      <div class="game-bg" style={{ backgroundImage: "url(./assets/img/galaxy-bg.webp)" }} />
      <div class="topbar">
        <button class="btn small ghost" onClick={onExit} title="Back to the menu">☰</button>
        <div class="cycle-pill" title={`Cycle ${v.cycle} of ${v.config.maxCycles}`}>
          <span class="cycle-label">Cycle</span>
          <b>{Math.max(1, v.cycle)}</b><span class="muted">/{v.config.maxCycles}</span>
        </div>
        <div class="steps">
          {STEPS.map((st) => <span class={`step ${st.id === step ? "on" : ""}`} title={st.sub}>{st.name}</span>)}
        </div>
        {secs !== null && <span class={`timer ${secs <= 5 ? "low" : ""}`}>{secs}s</span>}
        {label && <span class="chip">{label}</span>}
        <span class="spacer" />
        <div class="laws">
          {v.laws.map((l) => (
            <span class={`law ${flashLaw === l.id ? "flash" : ""}`} tabIndex={0}>
              ⚖ {lawDef(l.id).name}
              <span class="law-tip"><b>{lawDef(l.id).name}</b>{lawText(l)}</span>
            </span>
          ))}
        </div>
        {extraTop}
        {controls && (
          <span class="opts controls">
            <button class="btn small ghost" onClick={() => controls.setPaused(!controls.paused)} title={controls.paused ? "Play" : "Pause"}>{controls.paused ? "▶" : "❚❚"}</button>
            {controls.step && controls.paused && <button class="btn small ghost" onClick={controls.step}>Step</button>}
            <button class="btn small ghost" title="Game speed" onClick={() => { const xs = [0.5, 1, 2, 4]; controls.setSpeed(xs[(xs.indexOf(controls.speed) + 1) % xs.length]); }}>{controls.speed}×</button>
            {controls.setAutopilot && <button class={`btn small ghost ${controls.autopilot ? "on" : ""}`} title="Let your bot play your seat" onClick={() => controls.setAutopilot!(!controls.autopilot)}>Autopilot</button>}
          </span>
        )}
        <SoundControls />
      </div>

      <div class="left">
        {v.seats.map((s) => {
          const p = v.players[s.seat];
          const fleets = heldBy(v, s.seat).reduce((n, id) => n + Math.round(v.systems[id].fleets[s.seat]), 0);
          const sw = sway(v, s.seat);
          const pct = Math.min(1, sw / v.config.swayToWin);
          const C = 2 * Math.PI * 30;
          return (
            <div class={`player ${s.seat === me ? "me" : ""} ${acting.has(s.seat) && v.pending.length ? "acting" : ""}`} onClick={() => setRaceCard(s.race)} style={{ "--seat": s.color }}
              title={`${s.name} (${raceDef(s.race).name})\nSway ${sw} of ${v.config.swayToWin} to win\nInfluence ${p.influence} · Cards ${p.hand.length} · Fleets ${fleets}${p.drift ? ` · ${p.drift} coming back` : ""}\nClick for their power`}>
              <div class="sway-ring">
                <svg viewBox="0 0 68 68">
                  <circle cx="34" cy="34" r="30" class="ring-bg" />
                  <circle cx="34" cy="34" r="30" class="ring-fg" stroke={s.color} stroke-dasharray={`${C * pct} ${C}`} />
                </svg>
                <Portrait race={s.race} size={48} />
                <CountUp value={sw} class="sway" />
              </div>
              <div class="pinfo">
                <div class="name" style={{ color: s.color }}>{s.name}{s.controller === "bot" && <span class="badge bot">bot</span>}{p.branded >= v.cycle && v.cycle > 0 && <span class="badge">Branded</span>}</div>
                <div class="race">{raceDef(s.race).name}</div>
                <div class="stats">
                  <span title="Influence (money)">◆ <b>{p.influence}</b></span>
                  <span title="Fleets on the map">▲ <b>{fleets}</b></span>
                  {p.completed.map((m) => <span class="mini-chip" title={mandateDef(m).text}>✓ {mandateDef(m).name}</span>)}
                  {v.truces.filter((t) => t.a === s.seat || t.b === s.seat).map((t) => <span class="mini-chip" title={`Truce until end of Cycle ${t.until}`}>🤝 {v.seats[t.a === s.seat ? t.b : t.a].name}</span>)}
                </div>
              </div>
            </div>
          );
        })}
        {me !== null && v.players[me].mandates.length > 0 && (
          <div class="panel mandates">
            <h3>Secret goals</h3>
            {v.players[me].mandates.map((m) => <div class={v.players[me].completed.includes(m) ? "dim" : ""} title={mandateDef(m).text}>{v.players[me].completed.includes(m) ? "✓ " : "◎ "}<b>{mandateDef(m).name}</b> <span class="muted">{mandateDef(m).text}</span></div>)}
          </div>
        )}
      </div>

      <div class="mapwrap">
        <MapView view={v} pickable={mapMode?.pickable} selected={mapMode?.selected} onPick={mapMode?.onPick} />
        <Stage view={v} />
        {banner && (
          <div class={`phase-banner ${banner.step}`} key={banner.id}>
            {banner.step === "dawn" && <div class="pb-cycle">Cycle {banner.cycle}{banner.cycle === v.config.maxCycles ? " · final" : ""}</div>}
            <div class="pb-title">{STEPS.find((x) => x.id === banner.step)!.name}</div>
            <div class="pb-sub">{STEPS.find((x) => x.id === banner.step)!.sub}</div>
          </div>
        )}
        <div class="toasts">
          {toasts.map(({ id, ev }) => {
            const t = TOAST[ev.type];
            return <div class={`toast ${t.tone}`} key={id}><span class="big">{t.big}</span>{ev.text}</div>;
          })}
        </div>
        {v.phase === "over" && v.winners && (
          <div class="over">
            <div class="panel">
              <div class="over-portraits">{v.winners.map((w) => <Portrait race={v.seats[w].race} size={120} />)}</div>
              <h2>{v.winners.map((w) => v.seats[w].name).join(" & ")} win{v.winners.length > 1 ? "" : "s"}!</h2>
              <div class="muted" style={{ marginBottom: 10 }}>Final Sway after Cycle {v.cycle}</div>
              {[...v.seats].sort((a, b) => sway(v, b.seat) - sway(v, a.seat)).map((s) => (
                <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", margin: 4 }}>
                  <Portrait race={s.race} size={28} /> <b style={{ color: s.color }}>{s.name}</b> <span class="muted">{raceDef(s.race).short}</span> <b>{sway(v, s.seat)}</b>
                </div>
              ))}
              <Awards view={v} />
              <div style={{ marginTop: 12 }}><button class="btn primary" onClick={onExit}>Back to menu</button></div>
            </div>
          </div>
        )}
      </div>

      <div class="right">
        {tutor?.lesson && (
          <div class="lesson">
            <h3>{tutor.lesson.title}</h3>
            <p>{tutor.lesson.text}</p>
            <div class="row">
              <label class="muted" style={{ fontSize: 12, marginRight: "auto" }}><input type="checkbox" checked={tutor.pauseOnLessons} onChange={(e) => tutor.setPauseOnLessons((e.target as HTMLInputElement).checked)} /> pause on lessons</label>
              <button class="btn small primary" onClick={tutor.dismiss}>Got it</button>
            </div>
          </div>
        )}
        {tutor && tutor.thoughts.length > 0 && (
          <div class="thinking"><b>{v.seats[me ?? 0].name} is thinking:</b> {tutor.thoughts[tutor.thoughts.length - 1].text}</div>
        )}
        <div class={`panel log ${logOpen ? "open" : ""}`}>
          <h3>Captain's log <button class="btn small ghost" onClick={() => setLogOpen(!logOpen)}>{logOpen ? "Less" : "All"}</button></h3>
          <div class="feed">
            {shownFeed.map((e) => <div class={`ev ${e.loud ? "loud" : ""} ${e.only ? "private" : ""}`} key={e.n}>{e.text}</div>)}
          </div>
        </div>
      </div>

      <div class="dock">
        <div class="dock-row">
          {me !== null && (
            <div class="hand-wrap">
              <div class="dock-label">Your hand</div>
              <div class="hand fan">{v.players[me].hand.map((c) => <CardView card={c} />)}{!v.players[me].hand.length && <span class="muted">empty</span>}</div>
            </div>
          )}
          {myReq && onDecide && !auto ? (
            <div class="decision-wrap">
              <DecisionPanel key={myReq.id} view={v} me={me!} req={myReq} onDecide={onDecide} setMapMode={setMapMode} />
              <div class={`advisor ${currentAdvice ? "open" : ""}`}>
                {currentAdvice ? (
                  <>
                    <span>💡 {describe(v, myReq!, currentAdvice) && <b>{describe(v, myReq!, currentAdvice)} </b>}{currentAdvice.why && <span class="muted">{currentAdvice.why}</span>}</span>
                    <button class="btn small primary" onClick={() => onDecide(currentAdvice)}>Do it</button>
                  </>
                ) : <button class="btn small ghost" onClick={ask} title="Ask your bot what it would do">💡 Advise me</button>}
              </div>
            </div>
          ) : (
            <div class="decision">
              <div class="waiting">
                {v.phase === "over" ? "The game is over." : waitingOnMe ? "Locked in. Waiting for the others…" : v.pending.length ? `Waiting for ${[...new Set(v.pending.filter((r) => !v.answers[r.id] || r.seat !== me).map((r) => v.seats[r.seat].name))].join(", ")}…` : "Watching…"}
              </div>
            </div>
          )}
        </div>
      </div>

      {raceCard && (
        <div class="modal-back" onClick={() => setRaceCard(null)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <div class="race-card">
              <Portrait race={raceCard} size={160} />
              <div>
                <h2>{raceDef(raceCard).name}</h2>
                <dl>
                  <dt>Power</dt><dd>{raceDef(raceCard).power}</dd>
                  <dt>Tell</dt><dd>{raceDef(raceCard).tell}</dd>
                  <dt>Loud moment</dt><dd>{raceDef(raceCard).loud}</dd>
                </dl>
              </div>
            </div>
            <div style={{ textAlign: "right", marginTop: 8 }}><button class="btn" onClick={() => setRaceCard(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

/** End-of-game awards from the log. */
function Awards({ view: v }: { view: View }) {
  const awards: string[] = [];
  const count = (type: string, idx = 0) => {
    const m = new Map<number, number>();
    for (const e of v.events) if (e.type === type && e.seats?.[idx] !== undefined) m.set(e.seats[idx], (m.get(e.seats[idx]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  };
  const betr = count("betrayal");
  if (betr) awards.push(`Most shameless betrayal: ${v.seats[betr[0]].name}`);
  const allies = count("ally");
  if (allies) awards.push(`Best friend (most ally reveals): ${v.seats[allies[0]].name} ×${allies[1]}`);
  const bets = count("bet");
  if (bets) awards.push(`High roller: ${v.seats[bets[0]].name} (${bets[1]} bets)`);
  let longest = 0, who = "";
  for (const e of v.events) if (e.type === "result") { const n = Number(/\((\d+)\)/.exec(e.text)?.[1] ?? 0); if (n > longest) { longest = n; who = e.text; } }
  if (longest) awards.push(`Biggest total: ${longest} — ${who.replace(/ \(\d+\)$/, "")}`);
  if (!awards.length) return null;
  return <div style={{ marginTop: 12, textAlign: "left" }}><h3 class="muted" style={{ fontSize: 13 }}>AWARDS</h3>{awards.map((a) => <div>🏅 {a}</div>)}</div>;
}
