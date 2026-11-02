import { TRAIT_INFO, raceDef } from "../engine/content.ts";
import { currentClash } from "../engine/game.ts";
import { raceOf, sideReceipt, sideTotal } from "../engine/rules.ts";
import type { Clash, View } from "../engine/types.ts";
import { CardView, Portrait, seatName } from "./common.tsx";

/** The Showtime stage. It follows the event stream, so a just-settled Clash stays up with its result. */
export function Stage({ view: v }: { view: View }) {
  if (v.phase !== "showtime" && v.phase !== "reckoning") return null;
  const last = [...v.events].reverse().find((e) => e.data && typeof e.data.clash === "number");
  const recent = last ? v.clashes.find((c) => c.id === last.data!.clash) : null;
  const clash: Clash | null = recent?.resolved && last?.cycle === v.cycle ? recent : currentClash(v);
  if (!clash) return null;
  if (v.phase === "reckoning" && !clash.resolved) return null;

  const sys = v.systems[clash.system];
  const trait = sys.trait ? TRAIT_INFO[sys.trait] : null;
  const acting = v.pending.find((r) => r.clash === clash.id && (r.kind === "raise" || r.kind === "rewind" || r.kind === "parley"));
  const betting = v.pending.some((r) => r.clash === clash.id && r.kind === "bet");
  const stampFor = (i: number) => {
    const e = clash.log.filter((x) => x.side === i).slice(-1)[0];
    if (!e) return null;
    if (e.kind === "null") return `NULLED: ${raceDef(e.target!).short}`;
    if (e.kind === "precedent") return "PRECEDENT";
    return null;
  };
  const rewound = clash.rewound && v.events.some((e) => e.type === "rewind" && e.data?.clash === clash.id);
  const resultEv = clash.resolved ? [...v.events].reverse().find((e) => (e.type === "result" || e.type === "deal") && e.data?.clash === clash.id) : null;
  const adoredIdx = clash.sides.findIndex((s) => s.lead >= 0 && raceOf(v, s.lead) === "adored");

  return (
    <div class="stage" key={clash.id}>
      <div class="stage-head">
        <h2>Clash at {sys.name}</h2>
        {trait && <span class="chip" title={trait.text}>{trait.icon} {trait.name}</span>}
        {clash.headOn && <span class="chip">Head-on</span>}
        {rewound && <span class="chip" style={{ color: "var(--violet)" }}>⟲ Rewound</span>}
        <span class="spacer" style={{ flex: 1 }} />
        {betting && <span class="chip" style={{ color: "var(--amber)" }}>Bets open</span>}
      </div>
      <div class="stage-sides">
        {clash.sides.map((side, i) => {
          const total = sideTotal(v, clash, i);
          const lines = sideReceipt(v, clash, i);
          const won = clash.resolved && clash.winner === i;
          const isActing = acting && v.pending.find((r) => r.clash === clash.id)?.seat === side.lead;
          const stamp = stampFor(i);
          return (
            <div class={`side ${won ? "winner" : ""} ${side.folded ? "folded" : ""} ${isActing ? "acting" : ""}`}>
              <div class="side-top">
                {side.lead >= 0 ? <Portrait race={v.seats[side.lead].race} size={48} /> : <div class="portrait" style={{ width: 48, height: 48, background: "#555" }} />}
                <div>
                  <div style={{ fontWeight: 700, color: side.lead >= 0 ? v.seats[side.lead].color : "#bbb" }}>{seatName(v, side.lead)}</div>
                  <div class="muted" style={{ fontSize: 12 }}>{side.role}{side.late ? " · late" : ""}{side.folded ? " · folded" : ""}</div>
                </div>
                <div class="total">{total}</div>
              </div>
              <div class="opts" style={{ marginTop: 6 }}>
                {side.allies.map((a) => (
                  <span class="chip ally" style={{ borderColor: v.seats[a.seat].color }}>+{a.fleets} {v.seats[a.seat].name}{a.revealed ? "" : " (secret)"}</span>
                ))}
              </div>
              <div class="cards">
                {side.opening !== null && <CardView card={side.opening} hidden={!side.openingRevealed && side.opening.id === -1} garrison={side.lead < 0} />}
                {side.cards.map((c) => <CardView card={c} />)}
                {side.precedents.map((p) => <CardView ghost={p} />)}
              </div>
              <div class="receipt">
                {lines.map((l) => <><span>{l.label}</span><span class={`v ${l.value < 0 ? "neg" : ""}`}>{l.value > 0 ? "+" : ""}{l.value}</span></>)}
              </div>
              {stamp && <div class="stamp" key={stamp}>{stamp}</div>}
            </div>
          );
        })}
      </div>
      <div class="stage-foot">
        {clash.bets.length > 0 && <span class="muted">Bets:</span>}
        {clash.bets.map((b) => <span class="chip">{v.seats[b.seat].name} {b.amount}◆ on {seatName(v, clash.sides[b.side].lead)}</span>)}
        {adoredIdx >= 0 && (() => {
          const pro = clash.bets.filter((b) => b.side === adoredIdx).length;
          const con = clash.bets.length - pro;
          return <span title="The Adored gain +1 per bettor backing them and −1 per bettor against">Crowd <span class="crowd"><div style={{ width: `${Math.max(5, Math.min(100, 50 + (pro - con) * 20))}%` }} /></span></span>;
        })()}
        {acting && !clash.resolved && <span class="waiting">{v.seats[acting.seat].name} {acting.kind === "raise" ? "must raise or fold…" : acting.kind === "rewind" ? "may REWIND…" : "is negotiating…"}</span>}
      </div>
      {resultEv && <div class="result-banner">{resultEv.text}</div>}
    </div>
  );
}
