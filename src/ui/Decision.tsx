import { useEffect, useMemo, useState } from "preact/hooks";
import { lawDef, lawText, mandateDef, raceDef } from "../engine/content.ts";
import { canBeAsked, canBet, clashById, nullTargets, precedentCost, precedentValues } from "../engine/game.ts";
import { fleetCap, heldBy, raceOf, seatOfRace, sideTotal, spareFleets, targets } from "../engine/rules.ts";
import type { Decision, EchoEffect, Lie, RaceId, Request, Seat, View } from "../engine/types.ts";
import { CardView, Stepper, seatName } from "./common.tsx";

export type MapMode = { pickable: Set<number>; selected: number[]; onPick: (id: number) => void } | null;

type Props = { view: View; me: Seat; req: Request; onDecide: (d: Decision) => void; setMapMode: (m: MapMode) => void };

export function DecisionPanel(p: Props) {
  const { req } = p;
  useEffect(() => () => p.setMapMode(null), [req.id]);
  switch (req.kind) {
    case "mandates": return <Mandates {...p} />;
    case "summit": return <Summit {...p} />;
    case "power": return <Power {...p} />;
    case "plan": return <Plan {...p} />;
    case "lastword": return <Plan {...p} />;
    case "ask": return <Ask {...p} />;
    case "pledge": return <Pledge {...p} />;
    case "bet": return <Bet {...p} />;
    case "raise": return <Raise {...p} />;
    case "rewind": return <YesNo {...p} title="REWIND this Clash?" text="You're losing. Rewind to the start of the Raise: everyone takes their raise cards back and remembers what was played. Each opponent draws 1 card. Once per Cycle." yes={{ kind: "rewind", rewind: true }} no={{ kind: "rewind", rewind: false }} yesLabel="⟲ Rewind" noLabel="Accept the loss" />;
    case "parley": return <YesNo {...p} title="Both sides opened Parley" text="Choose a deal. If you both pick the same one, it happens. If not, each side loses a fleet and the attackers go home." yes={{ kind: "parley", choice: "cohold" }} no={{ kind: "parley", choice: "withdraw" }} yesLabel="Co-hold the system" noLabel="Attacker withdraws" />;
  }
}

function Mandates({ view: v, me, onDecide }: Props) {
  const offer = v.players[me].mandateOffer;
  const [keep, setKeep] = useState<string[]>([]);
  const toggle = (m: string) => setKeep(keep.includes(m) ? keep.filter((x) => x !== m) : keep.length < 2 ? [...keep, m] : keep);
  return (
    <div class="decision">
      <h3>Keep 2 secret Mandates</h3>
      <div class="why">Each completed Mandate is worth 2 Sway and is announced when you complete it.</div>
      <div class="opts">
        {offer.map((m) => (
          <button class={`btn ${keep.includes(m) ? "on" : ""}`} onClick={() => toggle(m)} title={mandateDef(m).text}>
            <b>{mandateDef(m).name}</b> <span class="muted">{mandateDef(m).text}</span>
          </button>
        ))}
      </div>
      <div><button class="btn primary" disabled={keep.length !== 2} onClick={() => onDecide({ kind: "mandates", keep })}>Keep these</button></div>
    </div>
  );
}

function Summit({ view: v, me, onDecide }: Props) {
  const [law, setLaw] = useState(0);
  const [replace, setReplace] = useState(0);
  const [bid, setBid] = useState(0);
  return (
    <div class="decision">
      <h3>Law Summit: sealed bid</h3>
      <div class="why">The highest bid installs one Law. The player with the lowest Sway gets +2 on their bid. Only the winner pays.</div>
      <div class="opts">Install: {v.summitOffer.map((l, i) => <button class={`btn small ${law === i ? "on" : ""}`} title={lawText(l)} onClick={() => setLaw(i)}>{lawDef(l.id).name}</button>)}</div>
      <div class="muted">{v.summitOffer[law] && lawText(v.summitOffer[law])}</div>
      {v.laws.length >= 3 && <div class="opts">Replacing: {v.laws.map((l, i) => <button class={`btn small ${replace === i ? "on" : ""}`} title={lawText(l)} onClick={() => setReplace(i)}>{lawDef(l.id).name}</button>)}</div>}
      <div class="opts">Bid <Stepper value={bid} min={0} max={v.players[me].influence} onChange={setBid} /> Influence
        <button class="btn primary" onClick={() => onDecide({ kind: "summit", law, replace, bid })}>Seal bid</button></div>
    </div>
  );
}

function Power({ view: v, me, onDecide, setMapMode }: Props) {
  const race = raceOf(v, me);
  const [sel, setSel] = useState<number[]>([]);
  useEffect(() => {
    if (race !== "foldwrights") return;
    const all = new Set(v.systems.map((s) => s.id));
    setMapMode({ pickable: all, selected: sel, onPick: (id) => setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2))) });
  }, [sel.join(",")]);
  if (race === "amenders") {
    const edits: { label: string; d: Decision }[] = [];
    v.laws.forEach((l, li) => {
      const def = lawDef(l.id);
      def.params.forEach((pp, pi) => {
        for (const dv of [-1, 1]) {
          const nv = l.params[pi] + dv;
          if (nv < pp.min || nv > pp.max) continue;
          edits.push({ label: `${def.name}: ${pp.label} ${l.params[pi]} → ${nv}`, d: { kind: "power", amend: { law: li, param: pi, value: nv } } });
        }
      });
      for (const w of def.words ?? []) if (w !== l.word) edits.push({ label: `${def.name}: ties go to the ${w}`, d: { kind: "power", amend: { law: li, word: w } } });
    });
    return (
      <div class="decision">
        <h3>Amend a Law</h3>
        <div class="why">Change one number or word in an active Law. Everyone sees it, and it binds you too.</div>
        <div class="opts">{edits.map((e) => <button class="btn small" onClick={() => onDecide(e.d)}>{e.label}</button>)}</div>
        <div><button class="btn small" onClick={() => onDecide({ kind: "power", amend: null })}>No amendment</button></div>
      </div>
    );
  }
  const ok = sel.length === 2 && !v.adjacency[sel[0]].includes(sel[1]);
  return (
    <div class="decision">
      <h3>Fold space</h3>
      <div class="why">Click two systems on the map that aren't connected. They touch for this Cycle, for everyone.</div>
      <div>{sel.map((id) => <span class="chip">{v.systems[id].name}</span>)}</div>
      <div class="opts">
        <button class="btn primary" disabled={!ok} onClick={() => onDecide({ kind: "power", fold: { a: sel[0], b: sel[1] } })}>Fold</button>
        <button class="btn small" onClick={() => onDecide({ kind: "power", fold: null })}>Don't fold</button>
      </div>
    </div>
  );
}

function Plan({ view: v, me, req, onDecide, setMapMode }: Props) {
  const race = raceOf(v, me);
  const legal = useMemo(() => new Set(targets(v, me)), [v.cycle, v.phase]);
  const max = Math.min(spareFleets(v, me), fleetCap(v));
  const [target, setTarget] = useState<number | null>(null);
  const [fleets, setFleets] = useState(Math.min(max, race === "lattice" ? 2 : max));
  const [echo, setEcho] = useState<{ system: number; effect: EchoEffect; delay: number } | null>(null);
  const [echoMode, setEchoMode] = useState(false);
  const [lies, setLies] = useState<{ system: number; preset: Lie["preset"]; target: Seat | "all" }[]>([]);
  const [tithe, setTithe] = useState<RaceId[]>([]);
  useEffect(() => {
    if (echoMode) setMapMode({ pickable: new Set(v.systems.map((s) => s.id)), selected: echo ? [echo.system] : [], onPick: (id) => { setEcho({ system: id, effect: echo?.effect ?? "destroy", delay: echo?.delay ?? 1 }); setEchoMode(false); } });
    else setMapMode({ pickable: legal, selected: target !== null ? [target] : [], onPick: (id) => setTarget(id) });
  }, [target, echoMode, echo?.system]);
  const late = req.kind === "lastword";
  const send = () => {
    if (late) onDecide({ kind: "lastword", target, fleets });
    else onDecide({ kind: "plan", target, fleets, echo: echo ?? undefined, lies: lies.length ? lies : undefined, tithe: tithe.length ? tithe : undefined });
  };
  const others = v.seats.filter((s) => s.seat !== me && s.race !== "tithe").map((s) => s.race);
  return (
    <div class="decision">
      <h3>{late ? "The Last Word: everyone's Vectors are on the map" : "Plan: choose your Vector"}</h3>
      <div class="why">{late ? "Pick your target now. You arrive late (−2 strength)." : "Click a glowing system next to yours, then choose how many fleets to send. Each system you hold keeps at least 1 fleet."}</div>
      <div class="opts">
        Target: <b>{target !== null ? v.systems[target].name : "—"}</b>
        {max > 0 && <>Fleets <Stepper value={fleets} min={1} max={max} onChange={setFleets} /></>}
        {race === "lattice" && <span class="muted">(your ships don't add strength; your network does)</span>}
      </div>
      {race === "undertow" && !late && (
        <div class="ask-row">
          <b>Echo</b>
          <button class={`btn small ${echoMode ? "on" : ""}`} onClick={() => setEchoMode(!echoMode)}>{echo ? `on ${v.systems[echo.system].name}` : "pick a system"}</button>
          {echo && <>
            {(["destroy", "steal", "cancel", "discard"] as EchoEffect[]).map((e) => <button class={`btn small ${echo.effect === e ? "on" : ""}`} onClick={() => setEcho({ ...echo, effect: e })}>{e}</button>)}
            in <Stepper value={echo.delay} min={1} max={3} onChange={(d) => setEcho({ ...echo, delay: d })} /> Cycles
            <button class="btn small" onClick={() => setEcho(null)}>✕</button>
          </>}
        </div>
      )}
      {race === "murmur" && !late && (
        <div class="ask-row">
          <b>Lies</b> (max 2 active)
          {heldBy(v, me).slice(0, 8).map((id) => {
            const cur = lies.find((l) => l.system === id);
            const cycle = () => {
              const order: (Lie["preset"] | null)[] = [null, "empty", "double", "plus3"];
              const next = order[(order.indexOf(cur?.preset ?? null) + 1) % order.length];
              const rest = lies.filter((l) => l.system !== id);
              setLies(next ? [...rest, { system: id, preset: next, target: "all" as const }].slice(-2) : rest);
            };
            return <button class={`btn small ${cur ? "on" : ""}`} onClick={cycle}>{v.systems[id].name}{cur ? `: ${cur.preset === "plus3" ? "+3" : cur.preset}` : ""}</button>;
          })}
        </div>
      )}
      {race === "tithe" && !late && (
        <div class="ask-row">
          <b>Watch 2 races</b>
          {others.map((r) => <button class={`btn small ${tithe.includes(r) ? "on" : ""}`} onClick={() => setTithe(tithe.includes(r) ? tithe.filter((x) => x !== r) : [...tithe, r].slice(-2))}>{raceDef(r).short}</button>)}
        </div>
      )}
      <div class="opts">
        <button class="btn primary" disabled={target === null || max < 1} onClick={send}>Launch Vector</button>
        <button class="btn" onClick={() => { setTarget(null); late ? onDecide({ kind: "lastword", target: null, fleets: 0 }) : onDecide({ kind: "plan", target: null, fleets: 0, echo: echo ?? undefined, lies: lies.length ? lies : undefined, tithe: tithe.length ? tithe : undefined }); }}>Stay home</button>
      </div>
    </div>
  );
}

function Ask({ view: v, me, onDecide }: Props) {
  const mine = v.clashes.filter((c) => c.sides.some((s) => s.lead === me));
  const [asks, setAsks] = useState<Record<string, number>>({}); // "clash:seat" -> offer (present = asked)
  const [truces, setTruces] = useState<Seat[]>([]);
  const toggle = (key: string) => { const n = { ...asks }; if (key in n) delete n[key]; else n[key] = 0; setAsks(n); };
  const send = () => onDecide({
    kind: "ask",
    asks: Object.entries(asks).map(([k, offer]) => { const [c, s] = k.split(":").map(Number); return { clash: c, to: s, offer }; }),
    truces,
  });
  return (
    <div class="decision">
      <h3>Council: ask for allies in public</h3>
      <div class="why">Everyone sees who you ask and what you offer. Offers are paid automatically when the ally's pledge is revealed. Allies of a winning attacker co-hold the system.</div>
      {mine.length === 0 && <div class="muted">You aren't fighting this Cycle. You can still offer truces.</div>}
      {mine.map((c) => (
        <div class="ask-row">
          <b>{v.systems[c.system].name}</b>
          {v.seats.filter((s) => canBeAsked(v, c, s.seat)).map((s) => {
            const key = `${c.id}:${s.seat}`;
            const on = key in asks;
            return (
              <span class="opts">
                <button class={`btn small ${on ? "on" : ""}`} onClick={() => toggle(key)} style={{ borderColor: s.color }}>{s.name}</button>
                {on && <><Stepper value={asks[key]} min={0} max={v.players[me].influence} onChange={(n) => setAsks({ ...asks, [key]: n })} />◆</>}
              </span>
            );
          })}
        </div>
      ))}
      <div class="ask-row">
        <b>Offer a truce (2 Cycles)</b>
        {v.seats.filter((s) => s.seat !== me).map((s) => (
          <button class={`btn small ${truces.includes(s.seat) ? "on" : ""}`} onClick={() => setTruces(truces.includes(s.seat) ? truces.filter((x) => x !== s.seat) : [...truces, s.seat])}>{s.name}</button>
        ))}
      </div>
      <div><button class="btn primary" onClick={send}>Post</button></div>
    </div>
  );
}

function Pledge({ view: v, me, onDecide }: Props) {
  const toMe = v.asks.filter((a) => a.to === me);
  const myClashes = v.clashes.filter((c) => c.sides.some((s) => s.lead === me));
  const hand = v.players[me].hand.filter((c) => c.kind !== "null");
  const spare = spareFleets(v, me);
  const [pledges, setPledges] = useState<Record<number, { side: number; fleets: number }>>({});
  const [openings, setOpenings] = useState<Record<number, number | null>>({});
  const [accept, setAccept] = useState<Seat[]>([]);
  const [audit, setAudit] = useState<number | null>(null);
  const used = Object.values(pledges).reduce((n, p) => n + p.fleets, 0);
  const murmur = seatOfRace(v, "murmur");
  const send = () => onDecide({
    kind: "pledge",
    pledges: Object.entries(pledges).map(([c, p]) => ({ clash: Number(c), side: p.side, fleets: p.fleets })),
    openings: myClashes.map((c) => ({ clash: c.id, card: openings[c.id] ?? null })),
    acceptTruces: accept, audit,
  });
  const byClash = new Map<number, typeof toMe>();
  for (const a of toMe) byClash.set(a.clash, [...(byClash.get(a.clash) ?? []), a]);
  const usedCards = new Set(Object.values(openings).filter((x) => x !== null) as number[]);
  return (
    <div class="decision">
      <h3>Council: seal your choices</h3>
      {myClashes.map((c) => (
        <div class="ask-row">
          <b>Opening card at {v.systems[c.system].name}</b>
          <div class="hand">
            {hand.map((card) => (
              <CardView card={card} selected={openings[c.id] === card.id} onClick={() => { if (usedCards.has(card.id) && openings[c.id] !== card.id) return; setOpenings({ ...openings, [c.id]: openings[c.id] === card.id ? null : card.id }); }} />
            ))}
            {!hand.length && <span class="muted">No cards: you open with nothing.</span>}
          </div>
        </div>
      ))}
      {[...byClash.entries()].map(([cid, list]) => {
        const c = clashById(v, cid)!;
        const cur = pledges[cid];
        return (
          <div class="ask-row">
            <b>{v.systems[c.system].name}</b>
            {list.map((a) => {
              const side = c.sides.findIndex((s) => s.lead === a.from);
              const on = cur?.side === side;
              return <button class={`btn small ${on ? "on" : ""}`} onClick={() => { const n = { ...pledges }; if (on) delete n[cid]; else n[cid] = { side, fleets: Math.min(2, Math.max(1, spare - used)) }; setPledges(n); }}>Back {seatName(v, a.from)}{a.offer ? ` (+${a.offer}◆)` : ""}</button>;
            })}
            {cur && <>fleets <Stepper value={cur.fleets} min={1} max={Math.max(1, Math.min(4, spare - used + cur.fleets))} onChange={(n) => setPledges({ ...pledges, [cid]: { ...cur, fleets: n } })} /></>}
          </div>
        );
      })}
      {!toMe.length && !myClashes.length && <div class="muted">Nobody asked you for help this Cycle.</div>}
      {v.proposals.filter((x) => x.to === me).map((x) => (
        <div class="ask-row">Truce offer from <b>{seatName(v, x.from)}</b>
          <button class={`btn small ${accept.includes(x.from) ? "on" : ""}`} onClick={() => setAccept(accept.includes(x.from) ? accept.filter((s) => s !== x.from) : [...accept, x.from])}>{accept.includes(x.from) ? "Accepted" : "Accept"}</button>
        </div>
      ))}
      {murmur !== null && murmur !== me && v.players[me].influence >= 2 && (
        <div class="ask-row">Audit the Murmur (2◆):
          {heldBy(v, murmur).map((id) => <button class={`btn small ${audit === id ? "on" : ""}`} onClick={() => setAudit(audit === id ? null : id)}>{v.systems[id].name}</button>)}
        </div>
      )}
      <div><button class="btn primary" disabled={used > spare} onClick={send}>Seal</button> <span class="muted">{spare - used} spare fleets left</span></div>
    </div>
  );
}

function Bet({ view: v, me, req, onDecide }: Props) {
  const c = clashById(v, req.clash)!;
  const sides = canBet(v, c, me) ?? [];
  const [amount, setAmount] = useState(1);
  return (
    <div class="decision">
      <h3>Place a bet on {v.systems[c.system].name}?</h3>
      <div class="why">Winners split the pool. Allies can only back their own side.</div>
      <div class="opts">
        Amount <Stepper value={amount} min={1} max={Math.min(2, v.players[me].influence)} onChange={setAmount} />
        {sides.map((i) => <button class="btn" onClick={() => onDecide({ kind: "bet", side: i, amount })}>On {seatName(v, c.sides[i].lead)}</button>)}
        <button class="btn small" onClick={() => onDecide({ kind: "bet", side: null, amount: 0 })}>No bet</button>
      </div>
    </div>
  );
}

function Raise({ view: v, me, req, onDecide }: Props) {
  const c = clashById(v, req.clash)!;
  const idx = c.sides.findIndex((s) => s.lead === me);
  const mine = sideTotal(v, c, idx);
  const best = Math.max(...c.sides.map((_, i) => (i === idx || c.sides[i].folded ? -99 : sideTotal(v, c, i))));
  const hand = v.players[me].hand;
  const nulls = hand.find((x) => x.kind === "null") ? nullTargets(v, c, idx) : [];
  const prec = c.nulled.includes("archivists") ? [] : precedentValues(v, me);
  const maxR = v.laws.find((l) => l.id === "raises")?.params[0] ?? 3;
  return (
    <div class="decision">
      <h3>The Raise: you're behind, {mine} to {best}</h3>
      <div class="why">Play one more card face up, or fold. Every card played is spent, win or lose. Raise {c.sides[idx].raises + 1} of {maxR}.</div>
      <div class="hand">
        {hand.filter((x) => x.kind === "num").map((card) => <CardView card={card} onClick={() => onDecide({ kind: "raise", action: "card", card: card.id })} title={`Raise +${card.value} → ${mine + card.value}`} />)}
      </div>
      <div class="opts">
        {nulls.map((r) => <button class="btn small" onClick={() => onDecide({ kind: "raise", action: "null", target: r, card: hand.find((x) => x.kind === "null")!.id })}>NULL the {raceDef(r).short}</button>)}
        {prec.map((val) => <button class="btn small" onClick={() => onDecide({ kind: "raise", action: "precedent", value: val })}>PRECEDENT {val} → +{Math.max(1, val - 2)} ({precedentCost(val)}◆)</button>)}
        <button class="btn danger" onClick={() => onDecide({ kind: "raise", action: "fold" })}>Fold</button>
      </div>
    </div>
  );
}

function YesNo({ onDecide, title, text, yes, no, yesLabel, noLabel }: Props & { title: string; text: string; yes: Decision; no: Decision; yesLabel: string; noLabel: string }) {
  return (
    <div class="decision">
      <h3>{title}</h3>
      <div class="why">{text}</div>
      <div class="opts">
        <button class="btn primary" onClick={() => onDecide(yes)}>{yesLabel}</button>
        <button class="btn" onClick={() => onDecide(no)}>{noLabel}</button>
      </div>
    </div>
  );
}
