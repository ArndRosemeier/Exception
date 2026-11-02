import { TRAIT_INFO } from "../engine/content.ts";
import { currentClash } from "../engine/game.ts";
import { heldBy, latticeBridges, neighbours, seatOfRace } from "../engine/rules.ts";
import type { View } from "../engine/types.ts";

type Props = {
  view: View;
  pickable?: Set<number>;
  selected?: number[];
  onPick?: (id: number) => void;
};

const R = 34;

export function MapView({ view: v, pickable, selected = [], onPick }: Props) {
  const clash = currentClash(v);
  const lattice = seatOfRace(v, "lattice");
  const bridges = new Set(lattice !== null ? latticeBridges(v, lattice) : []);
  const tremors = new Set(v.events.filter((e) => e.type === "tremor" && e.cycle === v.cycle).map((e) => e.data?.system as number));
  const showVectors = v.phase !== "plan" || true;

  // Edges (drawn once per pair).
  const edges: [number, number][] = [];
  v.adjacency.forEach((ns, a) => ns.forEach((b) => { if (a < b) edges.push([a, b]); }));

  // Where each vector comes from: the held neighbour closest to the target.
  const vectorLines = showVectors ? v.vectors.map((vec) => {
    const t = v.systems[vec.target];
    const srcIds = heldBy(v, vec.seat).filter((id) => neighbours(v, id).includes(vec.target));
    const ids = srcIds.length ? srcIds : Object.keys(vec.from).map(Number);
    const src = v.systems[ids[0] ?? vec.target];
    return { vec, x1: src.x, y1: src.y, x2: t.x, y2: t.y };
  }) : [];

  return (
    <svg viewBox="-20 -20 1040 1040" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Galaxy map">
      <defs>
        {v.seats.map((s) => (
          <marker id={`arrow-${s.seat}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={s.color} />
          </marker>
        ))}
        <radialGradient id="sysfill"><stop offset="0%" stop-color="#2a2466" /><stop offset="100%" stop-color="#0d0b2a" /></radialGradient>
      </defs>

      {edges.map(([a, b]) => (
        <line x1={v.systems[a].x} y1={v.systems[a].y} x2={v.systems[b].x} y2={v.systems[b].y} stroke="rgba(160,150,255,0.22)" stroke-width="2" />
      ))}
      {v.folds.filter((f) => f.cycle === v.cycle).map((f) => {
        const a = v.systems[f.a], b = v.systems[f.b];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const cx = mx + (500 - mx) * 0.6, cy = my + (500 - my) * 0.6;
        return <path class="foldline" d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}><title>Folded space</title></path>;
      })}

      {vectorLines.map(({ vec, x1, y1, x2, y2 }) => {
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
        const sx = x1 + (dx / len) * (R + 4), sy = y1 + (dy / len) * (R + 4);
        const ex = x2 - (dx / len) * (R + 10), ey = y2 - (dy / len) * (R + 10);
        const color = v.seats[vec.seat].color;
        return (
          <g>
            <line class={`vector ${v.phase === "convergence" || v.phase === "lastword" ? "new" : ""}`} x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} style={{ color }} marker-end={`url(#arrow-${vec.seat})`} />
            <text x={(sx + ex) / 2} y={(sy + ey) / 2 - 8} text-anchor="middle" class="fleet-badge" fill={color} style={{ paintOrder: "stroke", stroke: "#050414", strokeWidth: 4 }}>{vec.fleets}{vec.late ? "!" : ""}</text>
          </g>
        );
      })}

      {v.systems.map((sys) => {
        const homeColor = sys.home !== null ? v.seats[sys.home].color : "rgba(200,200,255,0.5)";
        const entries = Object.entries(sys.fleets).filter(([, n]) => n > 0).map(([k, n]) => ({ seat: Number(k), n: Math.round(n) }));
        const canPick = pickable?.has(sys.id);
        const isSel = selected.includes(sys.id);
        const traitInfo = sys.trait ? TRAIT_INFO[sys.trait] : null;
        const title = `${sys.name}${sys.home !== null ? ` — ${v.seats[sys.home].name}'s home` : " — neutral"}${traitInfo ? `\n${traitInfo.name}: ${traitInfo.text}` : ""}\n${entries.map((e) => `${e.seat < 0 ? "Garrison" : v.seats[e.seat].name}: ${e.n}`).join(", ") || "empty"}`;
        return (
          <g class={canPick ? "clickable" : ""} onClick={() => canPick && onPick?.(sys.id)}>
            <title>{title}</title>
            {canPick && <circle cx={sys.x} cy={sys.y} r={R + 12} fill="none" stroke="var(--cyan)" stroke-width="3" class="target-glow" />}
            {isSel && <circle cx={sys.x} cy={sys.y} r={R + 12} fill="none" stroke="var(--amber)" stroke-width="4" />}
            {bridges.has(sys.id) && <circle cx={sys.x} cy={sys.y} r={R + 7} fill="none" stroke="#ffe066" stroke-width="2" stroke-dasharray="4 4"><title>Lattice bridge</title></circle>}
            {tremors.has(sys.id) && <circle cx={sys.x} cy={sys.y} r={R + 18} fill="none" stroke="var(--red)" stroke-width="2" stroke-dasharray="2 6" class="target-glow"><title>Tremor: an Echo may erupt here next Dawn</title></circle>}
            {clash?.system === sys.id && <circle cx={sys.x} cy={sys.y} r={R + 6} class="clash-ring" />}
            <circle cx={sys.x} cy={sys.y} r={R} fill="url(#sysfill)" stroke={homeColor} stroke-width={sys.home !== null ? 4 : 2} stroke-dasharray={sys.home !== null ? "" : "6 4"} />
            {traitInfo && <text x={sys.x} y={sys.y - 8} text-anchor="middle" class="sys-trait">{traitInfo.icon}</text>}
            <text x={sys.x} y={sys.y + R + 20} text-anchor="middle" class="sys-name">{sys.name}</text>
            {entries.map((e, i) => {
              const w = entries.length;
              const bx = sys.x + (i - (w - 1) / 2) * 30;
              const by = sys.y + 12;
              const color = e.seat < 0 ? "#9a9ab8" : v.seats[e.seat].color;
              return (
                <g>
                  <rect x={bx - 13} y={by - 12} width="26" height="22" rx="6" fill={color} />
                  <text x={bx} y={by + 4} text-anchor="middle" class="fleet-badge" fill="#0a0820">{e.n}</text>
                </g>
              );
            })}
            {v.echoes.filter((e) => e.system === sys.id).map((e) => (
              <text x={sys.x + R - 4} y={sys.y - R + 8} class="sys-trait" fill="var(--green)"><title>Your Echo ({e.effect}) fires in Cycle {e.fireOn}</title>≋</text>
            ))}
            {v.lies.filter((l) => l.system === sys.id).map(() => (
              <text x={sys.x - R} y={sys.y - R + 8} class="sys-trait"><title>You are lying about this system</title>🎭</text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
