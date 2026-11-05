import { useMemo } from "preact/hooks";
import { TRAIT_INFO } from "../engine/content.ts";
import { currentClash } from "../engine/game.ts";
import { heldBy, latticeBridges, neighbours, seatOfRace } from "../engine/rules.ts";
import type { System, View } from "../engine/types.ts";
import { stageClash } from "./Stage.tsx";

type Props = {
  view: View;
  pickable?: Set<number>;
  selected?: number[];
  onPick?: (id: number) => void;
};

const R = 34;
const PLANET = "./assets/img/planets/";

/** Which painted planet a system uses. Traits get their own art; plain worlds vary by id. */
function planetFor(sys: System): { src: string; scale: number } {
  if (sys.trait) return { src: PLANET + sys.trait + ".webp", scale: sys.trait === "shipyard" || sys.trait === "anomaly" ? 1.05 : 0.95 };
  const pool = ["home", "plain1", "plain2", "plain3"];
  const pick = pool[(sys.id * 7 + (sys.home ?? 0)) % pool.length];
  if (sys.home !== null) return { src: PLANET + pick + ".webp", scale: 1.0 };
  return { src: PLANET + pick + ".webp", scale: 0.78 + ((sys.id * 37) % 4) * 0.05 };
}

// A tiny ship pointing along +x (for animateMotion rotate="auto").
const SHIP_X = "M10,0 L-6,-6 L-3,0 L-6,6 Z";
// The same ship pointing up (-y), for ships in orbit.
const SHIP_UP = "M0,-6 L4,4 L0,2 L-4,4 Z";

function stars(n: number) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: n }, () => ({ x: rnd() * 1080 - 40, y: rnd() * 1080 - 40, r: 0.5 + rnd() * 1.6, d: rnd() * 4, t: 2 + rnd() * 4 }));
}

export function MapView({ view: v, pickable, selected = [], onPick }: Props) {
  const clash = currentClash(v);
  const lattice = seatOfRace(v, "lattice");
  const bridges = new Set(lattice !== null ? latticeBridges(v, lattice) : []);
  const tremors = new Set(v.events.filter((e) => e.type === "tremor" && e.cycle === v.cycle).map((e) => e.data?.system as number));
  const starField = useMemo(() => stars(140), []);
  // Camera: during a Clash, fly onto the contested planet and hold it above the Clash panel.
  const onStage = stageClash(v);
  const focus = onStage ? v.systems[onStage.system] : null;
  const K = 3.2;
  const camera = focus
    ? { transform: `translate(${500 - focus.x * K}px, ${190 - focus.y * K}px) scale(${K})` }
    : { transform: "translate(0px, 0px) scale(1)" };
  const starCam = focus
    ? { transform: `translate(${(500 - focus.x) * 0.3}px, ${(200 - focus.y) * 0.3}px) scale(1.25)` }
    : { transform: "translate(0px, 0px) scale(1)" };
  const flying = v.phase === "convergence" || v.phase === "lastword" || v.phase === "ask" || v.phase === "pledge";

  const edges: [number, number][] = [];
  v.adjacency.forEach((ns, a) => ns.forEach((b) => { if (a < b) edges.push([a, b]); }));

  const vectorLines = v.vectors.map((vec) => {
    const t = v.systems[vec.target];
    const srcIds = heldBy(v, vec.seat).filter((id) => neighbours(v, id).includes(vec.target));
    const ids = srcIds.length ? srcIds : Object.keys(vec.from).map(Number);
    const src = v.systems[ids[0] ?? vec.target];
    return { vec, x1: src.x, y1: src.y, x2: t.x, y2: t.y };
  });

  return (
    <svg viewBox="-20 -20 1040 1040" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Galaxy map" class={`map ${focus ? "zoomed" : ""}`}>
      <defs>
        {v.seats.map((s) => (
          <>
            <marker id={`arrow-${s.seat}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={s.color} />
            </marker>
            <radialGradient id={`aura-${s.seat}`}>
              <stop offset="55%" stop-color={s.color} stop-opacity="0.55" />
              <stop offset="100%" stop-color={s.color} stop-opacity="0" />
            </radialGradient>
          </>
        ))}
        <radialGradient id="flare">
          <stop offset="0%" stop-color="#fff" stop-opacity="1" />
          <stop offset="35%" stop-color="#ffbf5e" stop-opacity="0.8" />
          <stop offset="100%" stop-color="#ff6b6b" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="shade">
          <stop offset="0%" stop-color="#000" stop-opacity="0.55" />
          <stop offset="100%" stop-color="#000" stop-opacity="0" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>

      <g class="camera stars-cam" style={starCam}>
      <g class="stars">
        {starField.map((s) => <circle cx={s.x} cy={s.y} r={s.r} fill="#fff" style={{ animationDelay: `${s.d}s`, animationDuration: `${s.t}s` }} />)}
      </g>
      </g>
      <g class="camera" style={camera}>

      {edges.map(([a, b]) => (
        <g>
          <line x1={v.systems[a].x} y1={v.systems[a].y} x2={v.systems[b].x} y2={v.systems[b].y} stroke="rgba(94,231,255,0.06)" stroke-width="8" />
          <line x1={v.systems[a].x} y1={v.systems[a].y} x2={v.systems[b].x} y2={v.systems[b].y} class="lane" />
        </g>
      ))}
      {v.folds.filter((f) => f.cycle === v.cycle).map((f) => {
        const a = v.systems[f.a], b = v.systems[f.b];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const cx = mx + (500 - mx) * 0.6, cy = my + (500 - my) * 0.6;
        return <path class="foldline" d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}><title>Folded space</title></path>;
      })}

      {v.systems.map((sys) => {
        // Territory aura: the strongest holder's colour glows under the planet.
        const entries = Object.entries(sys.fleets).filter(([, n]) => n > 0).map(([k, n]) => ({ seat: Number(k), n: Math.round(n) }));
        const owner = entries.filter((e) => e.seat >= 0).sort((a, b) => b.n - a.n)[0];
        const home = sys.home !== null ? sys.home : null;
        const auraSeat = owner?.seat ?? home;
        if (auraSeat === null || auraSeat === undefined) return null;
        return <circle cx={sys.x} cy={sys.y} r={R * (home !== null ? 1.9 : 1.6)} fill={`url(#aura-${auraSeat})`} class="aura" />;
      })}

      {v.systems.map((sys) => {
        const entries = Object.entries(sys.fleets).filter(([, n]) => n > 0).map(([k, n]) => ({ seat: Number(k), n: Math.round(n) }));
        const canPick = pickable?.has(sys.id);
        const isSel = selected.includes(sys.id);
        const traitInfo = sys.trait ? TRAIT_INFO[sys.trait] : null;
        const planet = planetFor(sys);
        const size = R * 2 * planet.scale;
        const title = `${sys.name}${sys.home !== null ? ` — ${v.seats[sys.home].name}'s home` : ""}${traitInfo ? `\n${traitInfo.icon} ${traitInfo.name}: ${traitInfo.text}` : ""}\n${entries.map((e) => `${e.seat < 0 ? "Garrison" : v.seats[e.seat].name}: ${e.n} fleets`).join(", ") || "empty"}`;
        const nameY = sys.y + size / 2 + 18;
        return (
          <g class={`sys ${canPick ? "clickable" : ""}`} onClick={() => canPick && onPick?.(sys.id)}>
            <title>{title}</title>
            {canPick && <circle cx={sys.x} cy={sys.y} r={size / 2 + 10} fill="rgba(94,231,255,0.08)" stroke="var(--cyan)" stroke-width="3" class="target-glow" />}
            {isSel && <circle cx={sys.x} cy={sys.y} r={size / 2 + 12} fill="none" stroke="var(--amber)" stroke-width="5" class="sel-ring" />}
            {bridges.has(sys.id) && <circle cx={sys.x} cy={sys.y} r={size / 2 + 6} fill="none" stroke="#ffe066" stroke-width="2" stroke-dasharray="4 4"><title>Lattice bridge</title></circle>}
            {tremors.has(sys.id) && <circle cx={sys.x} cy={sys.y} r={size / 2 + 16} fill="none" stroke="var(--red)" stroke-width="2" stroke-dasharray="2 6" class="target-glow"><title>Tremor: an Echo may erupt here next Dawn</title></circle>}
            {sys.home !== null && <circle cx={sys.x} cy={sys.y} r={size / 2 + 2} fill="none" stroke={v.seats[sys.home].color} stroke-width="3" class="home-ring" />}
            <g class="planet" style={{ transformOrigin: `${sys.x}px ${sys.y}px` }}>
              <image href={planet.src} x={sys.x - size / 2} y={sys.y - size / 2} width={size} height={size} />
              <circle cx={sys.x + size * 0.22} cy={sys.y + size * 0.22} r={size * 0.45} fill="url(#shade)" pointer-events="none" />
            </g>
            {clash?.system === sys.id && (
              <>
                <circle cx={sys.x} cy={sys.y} r={size / 2 + 6} class="clash-ring" />
                <circle cx={sys.x} cy={sys.y} r={size * 0.7} fill="url(#flare)" class="flare" style={{ transformOrigin: `${sys.x}px ${sys.y}px` }} />
              </>
            )}
            {/* Ships in orbit, one per fleet (capped), each holder on its own ring. */}
            {entries.map((e, i) => {
              const color = e.seat < 0 ? "#b9b6d8" : v.seats[e.seat].color;
              const r = size / 2 + 9 + i * 9;
              const shown = Math.min(e.n, 8);
              return (
                <g class="orbit" style={{ transformOrigin: `${sys.x}px ${sys.y}px`, animationDuration: `${18 + i * 7 + (sys.id % 5)}s`, animationDirection: i % 2 ? "reverse" : "normal" }}>
                  {Array.from({ length: shown }, (_, k) => {
                    const a = (k / shown) * Math.PI * 2 + sys.id;
                    const x = sys.x + Math.cos(a) * r, y = sys.y + Math.sin(a) * r;
                    const deg = (a * 180) / Math.PI + (i % 2 ? 0 : 180);
                    return <path d={SHIP_UP} transform={`translate(${x},${y}) rotate(${deg}) scale(${e.seat < 0 ? 0.8 : 1})`} fill={color} class="ship" />;
                  })}
                </g>
              );
            })}
            <text x={sys.x} y={nameY} text-anchor="middle" class="sys-name">{sys.name}</text>
            <g>
              {entries.map((e, i) => {
                const w = entries.length;
                const bx = sys.x + (i - (w - 1) / 2) * 30;
                const color = e.seat < 0 ? "#b9b6d8" : v.seats[e.seat].color;
                return (
                  <g class="fleet-pill">
                    <rect x={bx - 13} y={nameY + 5} width="26" height="19" rx="9.5" fill="rgba(5,4,20,0.85)" stroke={color} stroke-width="1.5" />
                    <text x={bx} y={nameY + 19.5} text-anchor="middle" class="fleet-badge" fill={color}>{e.n}</text>
                  </g>
                );
              })}
            </g>
            {v.echoes.filter((e) => e.system === sys.id).map((e) => (
              <text x={sys.x + size / 2 - 4} y={sys.y - size / 2 + 8} class="sys-trait" fill="var(--green)"><title>Your Echo ({e.effect}) fires in Cycle {e.fireOn}</title>≋</text>
            ))}
            {v.lies.filter((l) => l.system === sys.id).map(() => (
              <text x={sys.x - size / 2} y={sys.y - size / 2 + 8} class="sys-trait"><title>You are lying about this system</title>🎭</text>
            ))}
          </g>
        );
      })}

      {/* Vectors last, so fleets fly over the planets. */}
      {vectorLines.map(({ vec, x1, y1, x2, y2 }) => {
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
        const sx = x1 + (dx / len) * (R + 6), sy = y1 + (dy / len) * (R + 6);
        const ex = x2 - (dx / len) * (R + 14), ey = y2 - (dy / len) * (R + 14);
        const color = v.seats[vec.seat].color;
        const path = `M${sx},${sy} L${ex},${ey}`;
        const ships = Math.min(5, Math.max(1, vec.fleets));
        return (
          <g class="vector-g">
            <line class={`vector ${flying ? "new" : ""}`} x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} style={{ color }} marker-end={`url(#arrow-${vec.seat})`} />
            {Array.from({ length: ships }, (_, k) => (
              <path d={SHIP_X} fill={color} class="flyer" style={{ color }}>
                <animateMotion {...({ dur: `${Math.max(1.2, len / 260)}s`, begin: `${(k * 0.22).toFixed(2)}s`, repeatCount: "indefinite", rotate: "auto", path, keyPoints: "0;1", keyTimes: "0;1", calcMode: "spline", keySplines: "0.4 0 0.6 1" } as Record<string, string>)} />
              </path>
            ))}
            <g transform={`translate(${(sx + ex) / 2},${(sy + ey) / 2 - 14})`}>
              <rect x="-15" y="-11" width="30" height="20" rx="10" fill="rgba(5,4,20,0.9)" stroke={color} stroke-width="2" />
              <text y="4" text-anchor="middle" class="fleet-badge" fill={color}>{vec.fleets}{vec.late ? "!" : ""}</text>
            </g>
          </g>
        );
      })}
      </g>
    </svg>
  );
}
