// Balance sim: runs many bot-only games and prints win rates per race and pacing stats.
//   npm run sim -- 500
import { RACES } from "../src/engine/content.ts";
import { botConfig, runBotGame } from "../src/sim/auto.ts";

const games = Number(process.argv[2] ?? 300);
const wins: Record<string, number> = {}, plays: Record<string, number> = {};
let cycles = 0, clashes = 0, raises = 0, folds = 0, asks = 0, allies = 0, bets = 0, betrayals = 0, ties = 0, swaySum = 0;
for (let g = 0; g < games; g++) {
  const n = 4 + (g % 3);
  const s = runBotGame(botConfig(1000 + g, n));
  cycles += s.cycle;
  for (const seat of s.seats) {
    plays[seat.race] = (plays[seat.race] ?? 0) + 1;
    if (s.winners!.includes(seat.seat)) wins[seat.race] = (wins[seat.race] ?? 0) + 1 / s.winners!.length;
  }
  for (const e of s.events) {
    if (e.type === "clash") clashes++;
    if (e.type === "raise") raises++;
    if (e.type === "fold") folds++;
    if (e.type === "ask") asks++;
    if (e.type === "ally") allies++;
    if (e.type === "bet") bets++;
    if (e.type === "betrayal") betrayals++;
    if (e.type === "result" && e.text.startsWith("Dead heat")) ties++;
  }
  swaySum += Math.max(...s.events.filter((e) => e.type === "over").map(() => 0));
}
console.log(`${games} games: ${(cycles / games).toFixed(1)} cycles/game, ${(clashes / cycles).toFixed(1)} clashes/cycle`);
console.log(`per clash: ${(raises / clashes).toFixed(2)} raises, ${(folds / clashes).toFixed(2)} folds, ${(allies / clashes).toFixed(2)} allies, ${(bets / clashes).toFixed(2)} bets, ties ${(100 * ties / clashes).toFixed(1)}%`);
console.log(`per cycle: ${(asks / cycles).toFixed(1)} asks, betrayals per game ${(betrayals / games).toFixed(2)}`);
for (const r of RACES) {
  const p = plays[r.id] ?? 0;
  console.log(`${r.short.padEnd(12)} win ${p ? ((100 * (wins[r.id] ?? 0)) / p).toFixed(1) : "-"}%  (${p} games)`);
}
