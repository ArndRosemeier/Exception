import { useEffect, useRef, useState } from "preact/hooks";
import { audio } from "../app/audio.ts";
import type { Sfx, Track } from "../app/audio.ts";
import { lawDef, lawText, mandateDef, raceDef } from "../engine/content.ts";
import { heldBy, sway } from "../engine/rules.ts";
import type { Decision, GameEvent, RaceId, Seat, View } from "../engine/types.ts";
import type { Lesson, Thought } from "../tutorial/tutor.ts";
import { CardView, Portrait } from "./common.tsx";
import { DecisionPanel } from "./Decision.tsx";
import type { MapMode } from "./Decision.tsx";
import { MapView } from "./MapView.tsx";
import { Stage } from "./Stage.tsx";

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

const PHASE_NAMES: Record<string, string> = {
  mandates: "Mandates", dawn: "Dawn", summit: "Law Summit", power: "Dawn powers", plan: "Plan", convergence: "Convergence",
  lastword: "The Last Word", ask: "Council", pledge: "Council", showtime: "Showtime", reckoning: "Reckoning", over: "Game over",
};

const SFX: Record<string, Sfx> = {
  clash: "reveal", opening: "card", raise: "card", ally: "reveal", fold: "fold", rewind: "rewind", betrayal: "betrayal",
  null: "stamp", tithed: "stamp", amend: "stamp", echo: "echo", bet: "coin", pay: "coin", lastword: "alarm", result: "win",
  precedent: "card", audit: "stamp", "fold-space": "reveal", mandate: "win", "summit-win": "stamp", shatter: "echo",
};

const TOAST: Record<string, { big: string; tone: string }> = {
  betrayal: { big: "BETRAYAL", tone: "red" }, amend: { big: "AMENDED", tone: "cyan" }, "fold-space": { big: "SPACE FOLDS", tone: "green" },
  echo: { big: "ECHO", tone: "red" }, audit: { big: "AUDIT", tone: "" }, tithed: { big: "TITHED", tone: "" },
  lastword: { big: "LAST WORD", tone: "red" }, mandate: { big: "MANDATE", tone: "green" }, "summit-win": { big: "LAW SUMMIT", tone: "cyan" },
  final: { big: "FINAL CYCLE", tone: "" }, shatter: { big: "SHATTERED", tone: "red" }, rewind: { big: "REWIND", tone: "cyan" },
  anomaly: { big: "ANOMALY", tone: "green" }, over: { big: "GAME OVER", tone: "green" }, summit: { big: "LAW SUMMIT", tone: "cyan" },
};

function musicFor(phase: string): Track {
  if (phase === "over") return "victory";
  if (phase === "ask" || phase === "pledge" || phase === "lastword") return "council";
  if (phase === "showtime") return "showtime";
  return "plan";
}

export function GameScreen({ view: v, me, onDecide, controls, tutor, onExit, label, extraTop }: Props) {
  const [mapMode, setMapMode] = useState<MapMode>(null);
  const [toasts, setToasts] = useState<{ id: number; ev: GameEvent }[]>([]);
  const [raceCard, setRaceCard] = useState<RaceId | null>(null);
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(audio.muted);
  const lastN = useRef(-1);
  const [flashLaw, setFlashLaw] = useState<string | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  useEffect(() => { audio.music(musicFor(v.phase)); }, [v.phase]);

  // New events: sounds, toasts, law flashes.
  useEffect(() => {
    const fresh = v.events.filter((e) => e.n > lastN.current);
    if (lastN.current >= 0) {
      for (const e of fresh) {
        const sfx = SFX[e.type];
        if (sfx) audio.sfx(sfx);
        if (e.loud && TOAST[e.type]) {
          const id = Math.random();
          setToasts((t) => [...t.slice(-2), { id, ev: e }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3300);
        }
        if (e.type === "amend" && e.data?.law) { setFlashLaw(e.data.law as string); setTimeout(() => setFlashLaw(null), 1700); }
      }
    }
    if (v.events.length) lastN.current = v.events[v.events.length - 1].n;
  }, [v.events.length]);

  const myReq = me !== null ? v.pending.find((r) => r.seat === me && !v.answers[r.id]) : undefined;
  const waitingOnMe = me !== null && v.pending.some((r) => r.seat === me) && !myReq;
  const deadline = myReq?.deadline ?? v.pending.find((r) => r.deadline)?.deadline;
  const secs = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const acting = new Set(v.pending.filter((r) => !v.answers[r.id] || r.seat !== me).map((r) => r.seat));
  const feed = [...v.events].reverse().slice(0, 80);

  return (
    <div class="game" style={{ backgroundImage: "url(./assets/img/galaxy-bg.webp)" }}>
      <div class="topbar">
        <button class="btn small" onClick={onExit}>☰ Menu</button>
        <span class="phase">Cycle {v.cycle}/{v.config.maxCycles} · {PHASE_NAMES[v.phase] ?? v.phase}</span>
        {secs !== null && <span class={`timer ${secs <= 5 ? "low" : ""}`}>{secs}s</span>}
        {label && <span class="chip">{label}</span>}
        <div class="laws">
          {v.laws.map((l) => <span class={`chip law ${flashLaw === l.id ? "flash" : ""}`} title={lawText(l)}>⚖ {lawDef(l.id).name}: {lawText(l)}</span>)}
        </div>
        <span class="spacer" />
        {extraTop}
        {controls && (
          <span class="opts">
            <button class="btn small" onClick={() => controls.setPaused(!controls.paused)}>{controls.paused ? "▶ Play" : "⏸ Pause"}</button>
            {controls.step && <button class="btn small" onClick={controls.step} disabled={!controls.paused}>Step</button>}
            {[0.5, 1, 2, 4].map((x) => <button class={`btn small ${controls.speed === x ? "on" : ""}`} onClick={() => controls.setSpeed(x)}>{x}×</button>)}
            {controls.setAutopilot && <button class={`btn small ${controls.autopilot ? "on" : ""}`} title="Let your bot play your seat" onClick={() => controls.setAutopilot!(!controls.autopilot)}>Autopilot</button>}
          </span>
        )}
        <button class="btn small" onClick={() => { audio.setMuted(!muted); setMuted(!muted); }}>{muted ? "🔇" : "🔊"}</button>
      </div>

      <div class="left">
        {v.seats.map((s) => {
          const p = v.players[s.seat];
          const fleets = heldBy(v, s.seat).reduce((n, id) => n + Math.round(v.systems[id].fleets[s.seat]), 0);
          return (
            <div class={`player ${s.seat === me ? "me" : ""} ${acting.has(s.seat) && v.pending.length ? "acting" : ""}`} onClick={() => setRaceCard(s.race)} style={{ borderLeft: `4px solid ${s.color}` }}>
              <Portrait race={s.race} />
              <div>
                <div class="name" style={{ color: s.color }}>{s.name}{s.controller === "bot" && <span class="badge bot">bot</span>}{p.branded >= v.cycle && v.cycle > 0 && <span class="badge">Branded</span>}</div>
                <div class="race">{raceDef(s.race).name}</div>
                <div class="stats">
                  <span title="Influence">◆ <b>{p.influence}</b></span>
                  <span title="Cards in hand">🂠 <b>{p.hand.length}</b></span>
                  <span title="Fleets on the map">▲ <b>{fleets}</b></span>
                  <span title="Fleets in the Drift (coming back)">↺ <b>{p.drift}</b></span>
                </div>
                {p.completed.length > 0 && <div class="stats">{p.completed.map((m) => <span class="chip" title={mandateDef(m).text}>✓ {mandateDef(m).name}</span>)}</div>}
                {v.truces.filter((t) => t.a === s.seat || t.b === s.seat).map((t) => <span class="chip" title={`Truce until end of Cycle ${t.until}`}>🤝 {v.seats[t.a === s.seat ? t.b : t.a].name}</span>)}
              </div>
              <div class="sway" title="Sway">{sway(v, s.seat)}</div>
            </div>
          );
        })}
        {me !== null && v.players[me].mandates.length > 0 && (
          <div class="panel">
            <h3>Your secret Mandates</h3>
            {v.players[me].mandates.map((m) => <div class={v.players[me].completed.includes(m) ? "dim" : ""}>{v.players[me].completed.includes(m) ? "✓ " : ""}<b>{mandateDef(m).name}</b>: {mandateDef(m).text}</div>)}
          </div>
        )}
      </div>

      <div class="mapwrap">
        <MapView view={v} pickable={mapMode?.pickable} selected={mapMode?.selected} onPick={mapMode?.onPick} />
        <Stage view={v} />
        <div class="toasts">
          {toasts.map(({ id, ev }) => {
            const t = TOAST[ev.type];
            return <div class={`toast ${t.tone}`} key={id}><span class="big">{t.big}</span>{ev.text}</div>;
          })}
        </div>
        {v.phase === "over" && v.winners && (
          <div class="over">
            <div class="panel">
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
        <div class="panel">
          <h3>Feed</h3>
          <div class="feed">
            {feed.map((e) => <div class={`ev ${e.type === "phase" ? "phase" : ""} ${e.loud ? "loud" : ""} ${e.only ? "private" : ""}`}>{e.text}</div>)}
          </div>
        </div>
      </div>

      <div class="dock">
        <div class="dock-row">
          {me !== null && (
            <div>
              <div class="muted" style={{ fontSize: 12, marginBottom: 4 }}>Your hand</div>
              <div class="hand">{v.players[me].hand.map((c) => <CardView card={c} />)}{!v.players[me].hand.length && <span class="muted">empty</span>}</div>
            </div>
          )}
          {myReq && onDecide ? (
            <DecisionPanel key={myReq.id} view={v} me={me!} req={myReq} onDecide={onDecide} setMapMode={setMapMode} />
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
              <Portrait race={raceCard} size={120} />
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
