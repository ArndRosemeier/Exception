import { raceDef } from "../engine/content.ts";
import type { Card, RaceId, View } from "../engine/types.ts";

const FILES: Partial<Record<RaceId, string>> = { lastword: "last-word" };

export function portraitUrl(race: RaceId): string {
  return `./assets/img/races/${FILES[race] ?? race}.webp`;
}

export function Portrait({ race, size = 44 }: { race: RaceId; size?: number }) {
  const r = raceDef(race);
  return (
    <img
      class="portrait"
      src={portraitUrl(race)}
      alt={r.name}
      width={size}
      height={size}
      style={{ width: size, height: size, background: `hsl(${r.hue} 60% 30%)` }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
    />
  );
}

export function CardView({ card, hidden, ghost, garrison, onClick, selected, title, big }: {
  card?: Card | null; hidden?: boolean; ghost?: number; garrison?: boolean; onClick?: () => void; selected?: boolean; title?: string; big?: boolean;
}) {
  const size = big ? " big" : "";
  if (ghost !== undefined) return <div class={`card ghost${size}`} title="PRECEDENT (a faded copy)"><span>{ghost}</span></div>;
  if (hidden || !card || card.id === -1) return <div class={`card back${size}`} title="Face down" />;
  const cls = ["card", card.kind === "parley" ? "parley" : card.kind === "null" ? "null" : "", garrison ? "garrison" : "", onClick ? "pick" : "", selected ? "sel" : "", big ? "big" : "", card.kind === "num" && card.value >= 8 ? "high" : ""].join(" ");
  const label = card.kind === "parley" ? "PARLEY" : card.kind === "null" ? "NULL" : String(card.value);
  const tip = title ?? (card.kind === "parley" ? "Parley: opening only. If both sides Parley they can deal; alone you back off with Salvage." : card.kind === "null" ? "Null: as a raise, switch off one race power for this Clash." : `Number card: +${card.value}`);
  return <div class={cls} onClick={onClick} title={tip}><span>{label}</span></div>;
}

export function seatName(v: View, seat: number): string {
  if (seat < 0) return "Garrison";
  return v.seats[seat].name;
}

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span class="stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
      <b style={{ minWidth: 18, textAlign: "center" }}>{value}</b>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </span>
  );
}
