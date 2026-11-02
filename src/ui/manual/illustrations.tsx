// Animated illustrations for the manual. Each one plays when its section scrolls into view
// (`play` turns true) and again when clicked (the parent remounts it with a new key).
import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import { RACES, SEAT_COLORS, TRAIT_INFO, raceDef } from "../../engine/content.ts";
import { createGame } from "../../engine/setup.ts";
import { neighbours, targets } from "../../engine/rules.ts";
import type { RaceId, Trait } from "../../engine/types.ts";
import { CardView, Portrait, portraitUrl } from "../common.tsx";
import type { Art } from "./content.ts";
import { raceExtra } from "./content.ts";

type P = { play: boolean };

/** Steps 0..n-1, advancing every `ms` while playing. */
function useSteps(n: number, ms: number, play: boolean, first = 400): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!play) return;
    let k = 0;
    let t = window.setTimeout(function tick() {
      k++;
      setI(k);
      if (k < n - 1) t = window.setTimeout(tick, ms);
    }, first);
    return () => window.clearTimeout(t);
  }, [play]);
  return play ? i : 0;
}

const card = (value: number, kind: "num" | "parley" | "null" = "num") => ({ id: value + 100, kind, value });

// ---- A real galaxy from the engine (4 players) -------------------------------------------------

function useDemoGalaxy() {
  return useMemo(() => {
    const races: RaceId[] = ["amenders", "lastword", "recurrent", "adored"];
    const s = createGame({
      seed: 11, maxCycles: 8, swayToWin: 10, mandates: false, laws: true,
      seats: races.map((race, i) => ({ name: ["Nova", "Kael", "Orro", "Vess"][i], race, controller: "bot", difficulty: "officer",
        temperament: { greed: 0.5, loyalty: 0.5, vengeance: 0.5, risk: 0.5, bluff: 0.5 } })),
    });
    const edges: [number, number][] = [];
    s.adjacency.forEach((ns, a) => ns.forEach((b) => { if (a < b) edges.push([a, b]); }));
    // One Vector per seat: seats 0 and 1 hit the same neutral, seat 2 crosses a border.
    const neutral = s.systems.find((x) => x.home === null && targets(s, 0).includes(x.id) && targets(s, 1).includes(x.id))
      ?? s.systems.find((x) => x.home === null && targets(s, 0).includes(x.id))!;
    const border = targets(s, 2).find((id) => s.systems[id].home === 3) ?? targets(s, 2)[0];
    const fromFor = (seat: number, target: number) =>
      s.systems.find((x) => x.home === seat && neighbours(s, x.id).includes(target)) ?? s.systems.find((x) => x.home === seat)!;
    const vectors = [
      { seat: 0, to: neutral.id, from: fromFor(0, neutral.id).id },
      { seat: 1, to: neutral.id, from: fromFor(1, neutral.id).id },
      { seat: 2, to: border, from: fromFor(2, border).id },
    ].filter((v) => v.from !== undefined);
    return { s, edges, vectors };
  }, []);
}

function GalaxySvg({ play, showVectors }: P & { showVectors?: boolean }) {
  const { s, edges, vectors } = useDemoGalaxy();
  return (
    <svg class={`m-galaxy ${play ? "on" : ""}`} viewBox="20 30 960 1000" role="img" aria-label="A four-player galaxy">
      <defs>
        {SEAT_COLORS.slice(0, 4).map((c, i) => (
          <marker id={`m-arrow-${i}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={c} />
          </marker>
        ))}
      </defs>
      {edges.map(([a, b], i) => {
        const A = s.systems[a], B = s.systems[b];
        return <line class="m-edge" style={{ animationDelay: `${300 + i * 25}ms` }} x1={A.x} y1={A.y} x2={B.x} y2={B.y} pathLength={1} />;
      })}
      {showVectors && vectors.map((v, i) => {
        const A = s.systems[v.from], B = s.systems[v.to];
        const k = 0.78;
        return (
          <line class="m-vector" style={{ animationDelay: `${1500 + (v.seat === 1 ? 0 : 0) + i * 30}ms`, stroke: SEAT_COLORS[v.seat] }}
            x1={A.x} y1={A.y} x2={A.x + (B.x - A.x) * k} y2={A.y + (B.y - A.y) * k} pathLength={1} marker-end={`url(#m-arrow-${v.seat})`} />
        );
      })}
      {s.systems.map((x, i) => {
        const owner = x.home;
        const color = owner === null ? "#8a84c0" : SEAT_COLORS[owner];
        const fleets = owner === null ? x.fleets["-1"] : x.fleets[owner];
        return (
          <g class="m-node" style={{ animationDelay: `${i * 45}ms`, transformOrigin: `${x.x}px ${x.y}px` }}>
            <circle cx={x.x} cy={x.y} r={owner === null ? 30 : 34} fill="rgba(10,8,32,0.85)" stroke={color} stroke-width={owner === null ? 3 : 5}
              stroke-dasharray={owner === null ? "6 5" : undefined} />
            <text x={x.x} y={x.y + 9} text-anchor="middle" class="m-node-n" fill={color}>{fleets}</text>
            {x.trait && <text x={x.x + 26} y={x.y - 24} class="m-node-t">{TRAIT_INFO[x.trait].icon}</text>}
            <text x={x.x} y={x.y + 58} text-anchor="middle" class="m-node-l">{x.name}</text>
          </g>
        );
      })}
      {showVectors && (
        <g class="m-hidden-plans">
          {vectors.map((v) => {
            const A = s.systems[v.from];
            return <text x={A.x} y={A.y - 44} text-anchor="middle" class="m-q" fill={SEAT_COLORS[v.seat]}>?</text>;
          })}
        </g>
      )}
    </svg>
  );
}

// ---- Individual illustrations ------------------------------------------------------------------

function Goal({ play }: P) {
  const n = useSteps(11, 170, play, 300);
  return (
    <div class="m-goal">
      <div class="m-sway-big"><span>{n}</span><small>/ 10 Sway</small></div>
      <div class="m-pips">{Array.from({ length: 10 }, (_, i) => <i class={i < n ? "lit" : ""} />)}</div>
      <div class={`m-goal-cap ${n >= 10 ? "show" : ""}`}>First to 10 wins · or best after Cycle 8</div>
    </div>
  );
}

function Deck({ play }: P) {
  const counts = [4, 5, 5, 5, 5, 4, 3, 3];
  return (
    <div class="m-deck">
      <div class="m-bars">
        {counts.map((c, i) => (
          <div class="m-bar-col">
            <div class="m-bar" style={{ height: play ? `${c * 18}px` : "0px", transitionDelay: `${i * 70}ms` }}><b>{c}</b></div>
            <CardView card={card(i + 1)} />
          </div>
        ))}
      </div>
      <div class="m-deck-special">
        <span><CardView card={card(0, "parley")} /> ×4</span>
        <span><CardView card={card(0, "null")} /> ×4</span>
      </div>
    </div>
  );
}

const PHASES = ["Dawn", "Laws", "Plan", "Convergence", "Council", "Showtime", "Reckoning"];
function Cycle({ play }: P) {
  const R = 118;
  return (
    <div class={`m-cycle ${play ? "on" : ""}`}>
      <svg viewBox="-170 -170 340 340">
        <circle r={R} class="m-ring" />
        <g class="m-orbit"><circle cx={0} cy={-R} r={11} class="m-orbiter" /></g>
        {PHASES.map((p, i) => {
          const a = (i / PHASES.length) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(a) * R, y = Math.sin(a) * R;
          return (
            <g class="m-phase" style={{ animationDelay: `${i * 120}ms` }}>
              <circle cx={x} cy={y} r={6} />
              <text x={x * 1.27} y={y * 1.2 + 4} text-anchor="middle">{p}</text>
            </g>
          );
        })}
        <text y={-4} text-anchor="middle" class="m-cycle-mid">CYCLE</text>
        <text y={18} text-anchor="middle" class="m-cycle-sub">1 → 8</text>
      </svg>
    </div>
  );
}

function Dawn({ play }: P) {
  const i = useSteps(4, 650, play);
  return (
    <div class="m-dawn">
      <div class={`m-dawn-row ${i >= 1 ? "show" : ""}`}><span class="m-coin">◆</span> +1 Influence, +1 per Rich system</div>
      <div class={`m-dawn-row ${i >= 2 ? "show" : ""}`}><span class="m-fleet">▲▲</span> 2 fleets return from the Drift</div>
      <div class={`m-dawn-row ${i >= 3 ? "show" : ""}`}>
        <span class="m-dealt"><CardView hidden /><CardView hidden /></span> draw 2 cards
      </div>
    </div>
  );
}

function Council({ play }: P) {
  const i = useSteps(5, 900, play, 300);
  const lines: { race: RaceId; who: string; text: string; cls?: string }[] = [
    { race: "lastword", who: "Kael", text: "Vess, join me at Vesper. I'll pay 2 Influence." },
    { race: "amenders", who: "Nova", text: "Orro, defend Vesper with me. You earn 1 Influence per fleet." },
    { race: "recurrent", who: "Orro", text: "Offers Nova a truce for 2 Cycles.", cls: "sys" },
    { race: "adored", who: "Vess", text: "Pledges sealed. Nobody knows who shows up.", cls: "seal" },
  ];
  return (
    <div class="m-council">
      {lines.map((l, k) => (
        <div class={`m-bubble ${l.cls ?? ""} ${i > k ? "show" : ""}`}>
          <Portrait race={l.race} size={34} />
          <div><b style={{ color: `hsl(${raceDef(l.race).hue} 80% 70%)` }}>{l.who}</b><div>{l.text}</div></div>
        </div>
      ))}
    </div>
  );
}

type Line = [string, number];
function Receipt({ lines, show }: { lines: Line[]; show: number }) {
  const vis = lines.slice(0, show);
  const total = vis.reduce((n, l) => n + l[1], 0);
  return (
    <>
      <div class="receipt">
        {vis.map(([l, v]) => <><span class="m-pop">{l}</span><span class={`v m-pop ${v < 0 ? "neg" : ""}`}>{v > 0 ? `+${v}` : v}</span></>)}
      </div>
      <div class="m-total">{total}</div>
    </>
  );
}

function Clash({ play }: P) {
  const i = useSteps(8, 1100, play, 500);
  // Step: 0 fleets · 1 ally flips · 2 openings flip · 3 bonuses · 4 Kael raises · 5 Nova raises · 6 Kael folds · 7 result
  const att: Line[] = [["Kael's fleets", 4], ["Vess (ally)", 2], ["Opening card", 5], ["Raise", 3]];
  const def: Line[] = [["Nova's fleets", 3], ["Opening card", 4], ["Home ground", 2], ["Home Turf (Law)", 2], ["Raise", 4]];
  const aShow = i >= 4 ? 4 : i >= 2 ? 3 : i >= 1 ? 2 : 1;
  const dShow = i >= 5 ? 5 : i >= 3 ? 4 : i >= 2 ? 2 : 1;
  const caption = ["Kael attacks Nova's home system Vesper.", "Allies flip: Vess joins Kael with 2 fleets!", "Opening cards flip.",
    "Bonuses for the defender. 11 to 11: ties count the defender as ahead.", "Kael is behind, so Kael raises a 3.",
    "Now Nova is behind and raises a 4.", "Kael folds.", "Nova holds Vesper! Kael's and Vess's fleets go to the Drift."][i];
  return (
    <div class="m-clash">
      <div class={`m-side ${i >= 7 ? "lost" : ""}`}>
        <div class="side-top"><Portrait race="lastword" size={44} /><div><b>Kael</b><div class="dim">attacker</div></div>
          {i >= 1 && <span class="m-ally"><Portrait race="adored" size={28} /></span>}</div>
        <div class="cards">
          <CardView card={i >= 2 ? card(5) : null} hidden={i < 2} />
          {i >= 4 && <CardView card={card(3)} />}
        </div>
        <Receipt lines={att} show={aShow} />
        {i >= 6 && <div class="m-fold">FOLD</div>}
      </div>
      <div class="m-vs">VS</div>
      <div class={`m-side ${i >= 7 ? "won" : ""}`}>
        <div class="side-top"><Portrait race="amenders" size={44} /><div><b>Nova</b><div class="dim">defender · home</div></div></div>
        <div class="cards">
          <CardView card={i >= 2 ? card(4) : null} hidden={i < 2} />
          {i >= 5 && <CardView card={card(4)} />}
        </div>
        <Receipt lines={def} show={dShow} />
      </div>
      <div class="m-caption" key={i}>{caption}</div>
    </div>
  );
}

function Raise({ play }: P) {
  const i = useSteps(6, 900, play, 400);
  const a = [9, 9, 12, 12, 17, 17][i];
  const d = [10, 10, 10, 14, 14, 14][i];
  const pct = 50 + Math.max(-40, Math.min(40, (a - d) * 5));
  const behind = a > d ? "Defender" : "Attacker";
  return (
    <div class="m-raise">
      <div class="m-tug-labels"><span>Attacker <b>{a}</b></span><span><b>{d}</b> Defender</span></div>
      <div class="m-tug"><div class="m-tug-fill" style={{ width: `${pct}%` }} /><div class="m-tug-mid" /></div>
      <div class="m-raise-note" key={i}>
        {i === 0 ? "Openings flipped." : i === 5 ? "The defender is out of good cards and folds." : `${behind} is behind: raise or fold.`}
      </div>
      <div class="m-raise-count">
        <span>Raises</span>
        {[0, 1, 2].map((k) => <i class={(k === 0 && i >= 2) || (k === 1 && i >= 4) ? "used a" : ""} />)}
        <span style={{ marginLeft: 12 }} />
        {[0, 1, 2].map((k) => <i class={k === 0 && i >= 3 ? "used d" : ""} />)}
      </div>
    </div>
  );
}

function Special({ play }: P) {
  return (
    <div class={`m-special ${play ? "on" : ""}`}>
      <div class="m-sp-col">
        <div class="m-sp-cards"><CardView card={card(0, "parley")} /><span class="m-hand">🤝</span><CardView card={card(0, "parley")} /></div>
        <div class="dim">Both Parley: deal</div>
      </div>
      <div class="m-sp-col">
        <div class="m-sp-cards"><CardView card={card(0, "null")} /><span class="m-nulled"><Portrait race="recurrent" size={46} /></span></div>
        <div class="dim">Null: power off</div>
      </div>
    </div>
  );
}

function Bets({ play }: P) {
  const i = useSteps(4, 800, play);
  return (
    <div class="m-bets">
      <div class="m-bettors">
        {(["tithe", "murmur", "foldwrights"] as RaceId[]).map((r, k) => (
          <div class="m-bettor"><Portrait race={r} size={38} /><span class={`m-chip ${i > k ? "fly" : ""}`} style={{ animationDelay: `${k * 120}ms` }}>2</span></div>
        ))}
      </div>
      <div class={`m-pool ${i >= 3 ? "full" : ""}`}>Pool <b>{Math.min(i, 3) * 2}</b></div>
    </div>
  );
}

function Betrayal({ play }: P) {
  const i = useSteps(4, 1100, play);
  return (
    <div class="m-betray">
      <Portrait race="foldwrights" size={64} />
      <div class={`m-bond ${i >= 2 ? "broken" : i >= 1 ? "on" : ""}`}><span>{i >= 2 ? "" : "TRUCE · 2 Cycles"}</span></div>
      <Portrait race="undertow" size={64} />
      {i >= 2 && <div class="stamp m-stamp-betray">BETRAYAL</div>}
      {i >= 3 && <div class="m-betray-note">−3 Influence to the victim · Branded: +1 for everyone fighting them</div>}
    </div>
  );
}

function Sway({ play }: P) {
  const rows: [string, number][] = [["Neutral Rich system", 1], ["Kael's home, held alone", 2], ["Shared with Vess", 1], ["Mandate: Tycoon", 2], ["Your own 3 homes", 0]];
  const i = useSteps(rows.length + 1, 600, play);
  const total = rows.slice(0, i).reduce((n, r) => n + r[1], 0);
  return (
    <div class="m-sway">
      {rows.map(([l, v], k) => <div class={`m-sway-row ${k < i ? "show" : ""}`}><span>{l}</span><b>{v ? `+${v}` : "0"}</b></div>)}
      <div class="m-sway-total"><span>Sway</span><b>{total}</b><div class="m-meter"><div style={{ width: `${total * 10}%` }} /></div></div>
    </div>
  );
}

function Mandates({ play }: P) {
  return (
    <div class={`m-mandates ${play ? "on" : ""}`}>
      {["Tycoon", "Invader", "Guardian", "Gambler"].map((m, k) => (
        <div class={`m-mcard ${k < 2 ? "kept" : "gone"}`} style={{ animationDelay: `${k * 150}ms` }}>
          <div class="m-mcard-in"><div class="m-mcard-back">✉</div><div class="m-mcard-front">{m}<small>{k < 2 ? "kept" : "discarded"}</small></div></div>
        </div>
      ))}
    </div>
  );
}

function Laws({ play }: P) {
  const i = useSteps(4, 900, play);
  return (
    <div class="m-laws">
      <div class={`m-lawchip ${i >= 2 ? "flash" : ""}`}>
        <b>Home Turf</b> Defenders get +
        <span class="m-num"><s class={i >= 1 ? "struck" : ""}>2</s>{i >= 2 && <span class="m-new">4</span>}</span> strength.
      </div>
      <div class={`m-amender ${i >= 1 ? "show" : ""}`}><Portrait race="amenders" size={40} /> <span>The Amenders rewrite a number.</span></div>
      {i >= 3 && <div class="stamp m-stamp-law">AMENDED</div>}
    </div>
  );
}

function Traits({ play }: P) {
  return (
    <div class={`m-traits ${play ? "on" : ""}`}>
      {(Object.keys(TRAIT_INFO) as Trait[]).map((t, k) => (
        <div class={`m-trait t-${t}`} style={{ animationDelay: `${k * 140}ms` }}><span>{TRAIT_INFO[t].icon}</span><b>{TRAIT_INFO[t].name}</b></div>
      ))}
    </div>
  );
}

function Modes({ play }: P) {
  return (
    <div class={`m-modes ${play ? "on" : ""}`}>
      {RACES.slice(0, 6).map((r, k) => (
        <div class="m-seat" style={{ animationDelay: `${k * 110}ms` }}>
          <Portrait race={r.id} size={44} />
          <small>{k === 0 ? "You" : k === 2 ? "Friend" : "Bot"}</small>
        </div>
      ))}
    </div>
  );
}

export function RaceArt({ race, play }: P & { race: RaceId }) {
  const r = raceDef(race);
  const x = raceExtra(race);
  return (
    <div class={`m-race-art fx-${race} ${play ? "on" : ""}`} style={{ "--hue": r.hue } as JSX.CSSProperties}>
      <div class="m-race-glow" />
      <img src={portraitUrl(race)} alt={r.name} class="m-race-img" />
      <div class="m-race-fx" />
      <div class="m-race-stamp">{x.loudWord}</div>
    </div>
  );
}

export function Illustration({ art, play, race }: P & { art: Art; race?: RaceId }) {
  switch (art) {
    case "goal": return <Goal play={play} />;
    case "galaxy": return <GalaxySvg play={play} />;
    case "vectors": return <GalaxySvg play={play} showVectors />;
    case "cycle": return <Cycle play={play} />;
    case "deck": return <Deck play={play} />;
    case "dawn": return <Dawn play={play} />;
    case "council": return <Council play={play} />;
    case "clash": return <Clash play={play} />;
    case "raise": return <Raise play={play} />;
    case "special": return <Special play={play} />;
    case "bets": return <Bets play={play} />;
    case "betrayal": return <Betrayal play={play} />;
    case "sway": return <Sway play={play} />;
    case "mandates": return <Mandates play={play} />;
    case "laws": return <Laws play={play} />;
    case "traits": return <Traits play={play} />;
    case "modes": return <Modes play={play} />;
    case "race": return race ? <RaceArt race={race} play={play} /> : null;
  }
}
