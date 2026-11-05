import { useEffect, useMemo, useState } from "preact/hooks";
import { audio } from "../app/audio.ts";
import { Controller } from "../app/controller.ts";
import type { Driver } from "../app/controller.ts";
import { BOT_NAMES, RACES, raceDef } from "../engine/content.ts";
import { shuffle } from "../engine/rng.ts";
import { createGame } from "../engine/setup.ts";
import type { Difficulty, GameConfig, RaceId } from "../engine/types.ts";
import { omniscientView, viewFor } from "../engine/view.ts";
import { hubConfigured } from "../net/session.ts";
import { randomTemperament } from "../sim/auto.ts";
import { TUTORIAL_SEAT, Tutor, tutorialConfig } from "../tutorial/tutor.ts";
import { Portrait } from "./common.tsx";
import { GameScreen } from "./GameScreen.tsx";
import { Lobby } from "./Lobby.tsx";
import { Manual } from "./manual/Manual.tsx";
import { SoundControls, WhatsNew } from "./Settings.tsx";
import { VERSION } from "../changelog.ts";

type Screen =
  | { name: "menu" }
  | { name: "solo-setup" }
  | { name: "local"; mode: "tutorial" | "solo" | "watch"; config: GameConfig; drivers: Driver[]; timers?: boolean }
  | { name: "multi"; room?: string }
  | { name: "manual"; start?: string };

export function App() {
  const params = new URLSearchParams(location.search);
  const [screen, setScreen] = useState<Screen>(
    params.get("room") ? { name: "multi", room: params.get("room")! }
      : params.has("manual") ? { name: "manual", start: params.get("manual") || undefined }
      : { name: "menu" },
  );
  useEffect(() => { if (screen.name === "menu" || screen.name === "solo-setup") audio.music("title"); }, [screen.name]);
  const toMenu = () => setScreen({ name: "menu" });

  if (screen.name === "local") return <LocalGame key={screen.config.seed} {...screen} onExit={toMenu} />;
  if (screen.name === "multi") return <Lobby room={screen.room} onExit={toMenu} />;
  if (screen.name === "manual") return <Manual start={screen.start} onExit={toMenu} />;
  return (
    <div class="menu" style={{ backgroundImage: "url(./assets/img/title.webp)" }}>
      {screen.name === "menu" ? <Menu go={setScreen} /> : <SoloSetup go={setScreen} />}
    </div>
  );
}

function Menu({ go }: { go: (s: Screen) => void }) {
  const [news, setNews] = useState(false);
  const watch = () => {
    const seed = (Date.now() % 100000) + 1;
    const r = { rng: seed };
    const races = shuffle(r, RACES.map((x) => x.id)).slice(0, 5);
    const names = shuffle(r, [...BOT_NAMES]);
    const config: GameConfig = {
      seed, maxCycles: 8, swayToWin: 10, mandates: true, laws: true,
      seats: races.map((race, i) => ({ name: names[i], race, controller: "bot", difficulty: "admiral" as Difficulty, temperament: randomTemperament(r) })),
    };
    go({ name: "local", mode: "watch", config, drivers: races.map(() => "bot") });
  };
  return (
    <div class="menu-card">
      <div class="logo">EXCEPTION</div>
      <div class="tagline">Every alien race is a patch to the rulebook.</div>
      <button class="btn primary" onClick={() => go({ name: "local", mode: "tutorial", config: tutorialConfig(), drivers: tutorialConfig().seats.map(() => "bot") })}>
        Watch the tutorial game <small>A full game played by bots, seen through one player's eyes, with lessons along the way.</small>
      </button>
      <button class="btn" onClick={() => go({ name: "solo-setup" })}>
        Solo skirmish <small>You against bots with their own personalities.</small>
      </button>
      <button class="btn" onClick={() => go({ name: "multi" })}>
        Multiplayer <small>{hubConfigured() ? "Create or join a room. Empty seats are filled by bots." : "Needs a GameHub key (not configured in this build)."}</small>
      </button>
      <button class="btn" onClick={watch}>
        Watch bots play <small>A spectator game with every card visible.</small>
      </button>
      <button class="btn" onClick={() => go({ name: "manual" })}>
        Manual <small>Scroll through every rule and race, animated and searchable.</small>
      </button>
      <div class="menu-foot">
        <span>v{VERSION} <button class="btn small ghost" onClick={() => setNews(true)}>What's new</button></span>
        <SoundControls />
      </div>
      {news && <WhatsNew onClose={() => setNews(false)} />}
    </div>
  );
}

function SoloSetup({ go }: { go: (s: Screen) => void }) {
  const [count, setCount] = useState(4);
  const [mine, setMine] = useState<RaceId>("amenders");
  const [difficulty, setDifficulty] = useState<Difficulty>("officer");
  const [name, setName] = useState(() => { try { return localStorage.getItem("exception.name") || "Commander"; } catch { return "Commander"; } });
  const [mandates, setMandates] = useState(true);
  const [timers, setTimers] = useState(false);
  const start = () => {
    try { localStorage.setItem("exception.name", name); } catch { /* ignore */ }
    const seed = (Date.now() % 1000000) + 1;
    const r = { rng: seed };
    const others = shuffle(r, RACES.map((x) => x.id).filter((x) => x !== mine)).slice(0, count - 1);
    const names = shuffle(r, BOT_NAMES.filter((x) => x !== name));
    const config: GameConfig = {
      seed, maxCycles: 8, swayToWin: 10, mandates, laws: true,
      seats: [
        { name, race: mine, controller: "human", difficulty, temperament: randomTemperament(r) },
        ...others.map((race, i) => ({ name: names[i], race, controller: "bot" as const, difficulty, temperament: randomTemperament(r) })),
      ],
    };
    go({ name: "local", mode: "solo", config, drivers: config.seats.map((_, i) => (i === 0 ? "local" : "bot")), timers });
  };
  return (
    <div class="menu-card">
      <h2>Solo skirmish</h2>
      <div class="setup">
        <label>Your name <input class="field" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value.slice(0, 16) || "Commander")} /></label>
        <label>Players <select value={count} onChange={(e) => setCount(Number((e.target as HTMLSelectElement).value))}>{[3, 4, 5, 6].map((n) => <option value={n}>{n}</option>)}</select></label>
        <label>Bot skill <select value={difficulty} onChange={(e) => setDifficulty((e.target as HTMLSelectElement).value as Difficulty)}><option value="cadet">Cadet</option><option value="officer">Officer</option><option value="admiral">Admiral</option></select></label>
        <label>Secret Mandates <input type="checkbox" checked={mandates} onChange={(e) => setMandates((e.target as HTMLInputElement).checked)} /></label>
        <label>Turn timers <input type="checkbox" checked={timers} onChange={(e) => setTimers((e.target as HTMLInputElement).checked)} /></label>
        <div class="muted">Your race:</div>
        <div class="race-grid">
          {RACES.map((r) => (
            <button class={`race-pick ${mine === r.id ? "sel" : ""}`} onClick={() => setMine(r.id)} title={`${r.power}\nTell: ${r.tell}`}>
              <Portrait race={r.id} size={40} /><span>{r.short}</span>
            </button>
          ))}
        </div>
        <div class="muted" style={{ fontSize: 13 }}><b>{raceDef(mine).name}:</b> {raceDef(mine).power} <i>{raceDef(mine).tell}</i></div>
      </div>
      <div class="opts" style={{ justifyContent: "space-between" }}>
        <button class="btn" onClick={() => go({ name: "menu" })}>Back</button>
        <button class="btn primary" onClick={start}>Start</button>
      </div>
    </div>
  );
}

function LocalGame({ mode, config, drivers, onExit, timers }: { mode: "tutorial" | "solo" | "watch"; config: GameConfig; drivers: Driver[]; onExit: () => void; timers?: boolean }) {
  const [, setTick] = useState(0);
  const tutor = useMemo(() => (mode === "tutorial" ? new Tutor() : null), []);
  const ctl = useMemo(() => {
    const c = new Controller(createGame(config), { drivers, timers: !!timers, speed: mode === "solo" ? 1 : 1, botThinkMs: mode === "solo" ? 350 : 500 });
    c.onChange = (s) => { tutor?.observe(s); setTick((t) => t + 1); };
    c.onBotDecision = (seat, req, d) => tutor?.onDecision(seat, req, d, c.state.cycle);
    if (tutor) c.canProceed = () => !tutor.blocking;
    return c;
  }, []);
  useEffect(() => { ctl.start(); tutor?.observe(ctl.state); setTick((t) => t + 1); return () => ctl.stop(); }, []);

  const me = mode === "tutorial" ? TUTORIAL_SEAT : mode === "solo" ? 0 : null;
  const view = mode === "watch" ? omniscientView(ctl.state) : viewFor(ctl.state, me);
  const rerender = () => setTick((t) => t + 1);
  return (
    <GameScreen
      view={view}
      me={mode === "solo" ? 0 : mode === "tutorial" ? TUTORIAL_SEAT : null}
      onDecide={mode === "solo" ? (d) => ctl.submit(0, d) : undefined}
      onExit={() => { ctl.stop(); onExit(); }}
      label={mode === "tutorial" ? "Tutorial" : mode === "watch" ? "Spectating" : undefined}
      controls={{
        speed: ctl.speed, setSpeed: (x) => { ctl.setSpeed(x); rerender(); },
        paused: ctl.paused, setPaused: (p) => { ctl.setPaused(p); rerender(); },
        step: mode !== "solo" ? () => { ctl.stepOnce(); rerender(); } : undefined,
        autopilot: mode === "solo" ? ctl.autopilot[0] : undefined,
        setAutopilot: mode === "solo" ? (on) => { ctl.setAutopilot(0, on); rerender(); } : undefined,
      }}
      tutor={tutor ? {
        lesson: tutor.current, thoughts: tutor.thoughts,
        dismiss: () => { tutor.dismiss(); rerender(); },
        pauseOnLessons: tutor.pauseOnLessons, setPauseOnLessons: (b) => { tutor.pauseOnLessons = b; rerender(); },
      } : undefined}
    />
  );
}
