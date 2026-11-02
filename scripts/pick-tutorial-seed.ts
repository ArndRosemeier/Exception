// Finds a tutorial seed whose game shows off most ideas. Prints the top candidates.
//   npx vite-node scripts/pick-tutorial-seed.ts
import { runBotGame } from "../src/sim/auto.ts";
import { tutorialConfig } from "../src/tutorial/tutor.ts";

const want = ["amend", "lastword", "rewind", "ally", "bet", "raise", "fold", "truce", "pay", "result", "opening"];
const bonus = ["betrayal", "parley", "null", "anomaly"];
const scored: { seed: number; score: number; cycles: number; winner: string; has: string[] }[] = [];
for (let seed = 1; seed <= 400; seed++) {
  const c = tutorialConfig();
  c.seed = seed;
  const s = runBotGame(c);
  const types = new Set(s.events.map((e) => e.type));
  if (s.events.some((e) => e.type === "lastword" && !e.text.includes("ALARM"))) types.delete("lastword");
  const has = [...want, ...bonus].filter((t) => types.has(t));
  let score = want.filter((t) => types.has(t)).length * 2 + bonus.filter((t) => types.has(t)).length;
  if (s.cycle >= 5) score += 3;
  if (s.cycle >= 7) score += 1;
  const novaSway = 0;
  scored.push({ seed, score: score + novaSway, cycles: s.cycle, winner: s.winners!.map((w) => s.seats[w].name).join("+"), has });
}
scored.sort((a, b) => b.score - a.score || b.cycles - a.cycles);
for (const x of scored.slice(0, 8)) console.log(x.seed, x.score, x.cycles, x.winner, x.has.join(","));
