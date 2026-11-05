import { useEffect, useRef, useState } from "preact/hooks";
import { TRAIT_INFO, raceDef } from "../engine/content.ts";
import { currentClash } from "../engine/game.ts";
import { raceOf, sideReceipt, sideTotal } from "../engine/rules.ts";
import type { Clash, View } from "../engine/types.ts";
import { CardView, Portrait, seatName } from "./common.tsx";

/** A number that counts up (or down) to its value and bumps when it changes. */
export function CountUp({ value, class: cls = "" }: { value: number; class?: string }) {
  const [shown, setShown] = useState(value);
  const [bump, setBump] = useState(0);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    setBump((b) => b + 1);
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 650);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <span class={`${cls} ${bump ? "bump" : ""}`} key={bump}>{shown}</span>;
}

/** The Showtime stage. It follows the event stream, so a just-settled Clash stays up with its result. */
export function Stage({ view: v }: { view: View }) {
  const [why, setWhy] = useState(false);
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
  const totals = clash.sides.map((_, i) => sideTotal(v, clash, i));
  const leader = clash.resolved ? clash.winner : totals.indexOf(Math.max(...totals.map((t, i) => (clash.sides[i].folded ? -99 : t))));

  return (
    <div class="stage-wrap">
      <div class={`stage ${clash.resolved ? "resolved" : ""}`} key={clash.id}>
        <div class="stage-bg" style={{ backgroundImage: "url(./assets/img/clash-bg.webp)" }} />
        <div class="stage-head">
          <div class="kicker">Clash</div>
          <h2>{sys.name}</h2>
          {trait && <span class="chip" title={trait.text}>{trait.icon} {trait.name}</span>}
          {clash.headOn && <span class="chip" title="Two attackers met each other">Head-on</span>}
          {rewound && <span class="chip" style={{ color: "var(--violet)" }}>⟲ Rewound</span>}
          <span class="spacer" style={{ flex: 1 }} />
          {betting && <span class="chip bets-open">Bets open</span>}
          <button class={`btn small ${why ? "on" : ""}`} onClick={() => setWhy(!why)} title="Show how each total is made up">{why ? "Hide maths" : "Why?"}</button>
        </div>
        <div class="stage-sides">
          {clash.sides.map((side, i) => {
            const total = totals[i];
            const won = clash.resolved && clash.winner === i;
            const lost = clash.resolved && clash.winner !== i;
            const isActing = acting && v.pending.find((r) => r.clash === clash.id)?.seat === side.lead;
            const stamp = stampFor(i);
            const color = side.lead >= 0 ? v.seats[side.lead].color : "#b9b6d8";
            return (
              <>
                {i > 0 && <div class="vs">VS</div>}
                <div class={`side ${won ? "winner" : ""} ${lost ? "loser" : ""} ${side.folded ? "folded" : ""} ${isActing ? "acting" : ""} ${!clash.resolved && leader === i ? "ahead" : ""}`} style={{ "--side": color }}>
                  <div class="side-top">
                    <div class="side-portrait">
                      {side.lead >= 0 ? <Portrait race={v.seats[side.lead].race} size={84} /> : <div class="portrait garrison-portrait">⚔</div>}
                    </div>
                    <div class="side-id">
                      <div class="side-name" style={{ color }}>{seatName(v, side.lead)}</div>
                      <div class="muted side-role">{side.role}{side.late ? " · late" : ""}{side.folded ? " · folded" : ""}</div>
                      <div class="allies">
                        {side.allies.map((a) => (
                          <span class="ally" title={`${v.seats[a.seat].name} joins with ${a.fleets} fleet${a.fleets > 1 ? "s" : ""}${a.revealed ? "" : " (secret)"}`} style={{ borderColor: v.seats[a.seat].color }}>
                            <Portrait race={v.seats[a.seat].race} size={22} /> +{a.fleets}
                          </span>
                        ))}
                      </div>
                    </div>
                    <CountUp value={total} class="total" />
                  </div>
                  <div class="cards">
                    {side.opening !== null && <CardView big card={side.opening} hidden={!side.openingRevealed && side.opening.id === -1} garrison={side.lead < 0} />}
                    {side.cards.map((c) => <CardView big card={c} />)}
                    {side.precedents.map((p) => <CardView big ghost={p} />)}
                  </div>
                  {why && (
                    <div class="receipt">
                      {sideReceipt(v, clash, i).map((l) => <><span>{l.label}</span><span class={`v ${l.value < 0 ? "neg" : ""}`}>{l.value > 0 ? "+" : ""}{l.value}</span></>)}
                    </div>
                  )}
                  {stamp && <div class="stamp" key={stamp}>{stamp}</div>}
                  {won && <div class="stamp win" key="win">VICTORY</div>}
                </div>
              </>
            );
          })}
        </div>
        <div class="stage-foot">
          {clash.bets.map((b) => <span class="chip bet" style={{ borderColor: v.seats[b.seat].color }}>🪙 {v.seats[b.seat].name} bets {b.amount} on {seatName(v, clash.sides[b.side].lead)}</span>)}
          {adoredIdx >= 0 && (() => {
            const pro = clash.bets.filter((b) => b.side === adoredIdx).length;
            const con = clash.bets.length - pro;
            return <span title="The Adored gain +1 per bettor backing them and −1 per bettor against">Crowd <span class="crowd"><div style={{ width: `${Math.max(5, Math.min(100, 50 + (pro - con) * 20))}%` }} /></span></span>;
          })()}
          {acting && !clash.resolved && <span class="waiting">{v.seats[acting.seat].name} {acting.kind === "raise" ? "is behind: raise or fold…" : acting.kind === "rewind" ? "may REWIND…" : "is negotiating…"}</span>}
        </div>
        {resultEv && <div class="result-banner">{resultEv.text}</div>}
      </div>
    </div>
  );
}
