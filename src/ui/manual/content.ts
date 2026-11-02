// The manual's text. Races, Laws, Mandates and traits are read from the engine's content so the
// manual stays in sync with the rules. Paragraphs use **bold** for emphasis.
import { LAWS, MANDATES, RACES, TRAIT_INFO } from "../../engine/content.ts";
import { HOME_GROUND } from "../../engine/rules.ts";
import type { RaceId } from "../../engine/types.ts";
import type { Sfx } from "../../app/audio.ts";

export type Art =
  | "goal" | "galaxy" | "cycle" | "deck" | "dawn" | "vectors" | "council" | "clash" | "raise"
  | "special" | "bets" | "betrayal" | "sway" | "mandates" | "laws" | "traits" | "race" | "modes";

export type Item = { title: string; text: string; race?: RaceId; img?: string; icon?: string; tag?: string };

export type Section = {
  id: string;
  group: string;
  title: string;
  kicker?: string;
  paras: string[];
  art?: Art;
  sfx?: Sfx;
  race?: RaceId;
  items?: Item[];
  /** Extra words that should find this section (synonyms). */
  keywords?: string;
};

const RACE_EXTRA: Record<RaceId, { tips: string; loudWord: string; sfx: Sfx }> = {
  amenders: { loudWord: "AMENDED", sfx: "stamp", tips: "Edit the Law that hurts you most this Cycle, or the one your rival relies on. Remember the edit binds you too, and anyone can read it in the top bar." },
  lastword: { loudWord: "ALARM", sfx: "alarm", tips: "Wait for Convergence, then land where the fight is thinnest. The −2 for arriving late means you want a clear edge, not a coin flip." },
  recurrent: { loudWord: "REWIND", sfx: "rewind", tips: "A REWIND replays the Raise with everyone's knowledge intact. Use it when you now know their hand is thin; each opponent draws 1, so don't waste it." },
  undertow: { loudWord: "ECHO", sfx: "echo", tips: "Plant Echoes where your rivals will be, not where they are. Neighbours feel a tremor the Cycle before, so a bluff Echo can scare people off a system too." },
  adored: { loudWord: "CROWD", sfx: "coin", tips: "Fight in public, where outsiders want to bet on you. Every bet on you is +1, every bet against is −1, so be the crowd favourite." },
  lattice: { loudWord: "SHATTER", sfx: "fold", tips: "Strength is the size of your largest connected group of systems, not your fleets. Protect the glowing bridge systems: losing one splits the web." },
  foldwrights: { loudWord: "FOLD", sfx: "reveal", tips: "Fold space to reach a distant prize. The fold is public and anyone can use it this Cycle, so fold toward places only you are ready to hit." },
  archivists: { loudWord: "PRECEDENT", sfx: "card", tips: "Every number card your opponent played face up earlier is a weapon you can replay as a faded copy (−2). Watch the big cards and keep Influence to pay for them." },
  tithe: { loudWord: "TITHED", sfx: "stamp", tips: "Watch the two races most likely to fire this Cycle. Their owner pays you 2 Influence or the power fizzles. Owners pay automatically when they can." },
  murmur: { loudWord: "LIAR?", sfx: "reveal", tips: "Lie where an attack would hurt most: show an empty system as strong, or a strong one as empty. A wrong Audit pays you 2, a caught lie costs you 3." },
};
export function raceExtra(r: RaceId) {
  return RACE_EXTRA[r];
}

const lawItems: Item[] = LAWS.map((l) => {
  const p = l.params[0];
  const range = p ? ` (Amenders can set ${p.label} from ${p.min} to ${p.max})` : l.words ? ` (Amenders can swap the word: ${l.words.join(" / ")})` : "";
  return { title: l.name, text: l.text(l.params.map((x) => x.start), l.words?.[0]) + range, icon: "§" };
});

const mandateItems: Item[] = MANDATES.map((m) => ({ title: m.name, text: m.text, icon: "✉" }));

const traitItems: Item[] = (Object.keys(TRAIT_INFO) as (keyof typeof TRAIT_INFO)[]).map((k) => ({
  title: TRAIT_INFO[k].name, text: TRAIT_INFO[k].text + ".", icon: TRAIT_INFO[k].icon,
}));

const raceSections: Section[] = RACES.map((r) => ({
  id: "race-" + r.id,
  group: "Races",
  title: r.name,
  kicker: "Race",
  race: r.id,
  art: "race" as Art,
  sfx: RACE_EXTRA[r.id].sfx,
  paras: [
    `**Power.** ${r.power}`,
    `**Tell.** ${r.tell}`,
    `**Loud moment.** ${r.loud}`,
    `**Playing them.** ${RACE_EXTRA[r.id].tips}`,
  ],
}));

const GLOSSARY: Item[] = [
  ["Ally", "A player who secretly pledges fleets to one side of a Clash. Allies flip one by one in Showtime."],
  ["Audit", "Pay 2 Influence to check a Murmur system for lies. A caught lie pays you 3; a wrong Audit pays the Murmur 2."],
  ["Betting book", "Players outside a Clash may bet up to 2 Influence on a side. Winners split the whole pool."],
  ["Branded", "A truce-breaker. Everyone fighting a Branded player gets +1 until the end of next Cycle."],
  ["Clash", "A fight over one system: the defender (or garrison) against every attacker who sent a Vector there."],
  ["Cycle", "One round: Dawn, Laws, Plan, Convergence, Council, Showtime, Reckoning. A game lasts at most 8."],
  ["Drift", "Where destroyed fleets wait. Up to 2 come back each Dawn (more with Shipyards or Repair Docks)."],
  ["Echo", "The Undertow's sealed time bomb on a system. It goes off 1 to 3 Cycles later on whoever holds it."],
  ["Fleet", "Your ships. Each fleet adds 1 strength in a Clash. You always keep at least 1 on every system you hold."],
  ["Fold", "Folding in the Raise: give up the Clash. Folding space: the Foldwrights' power that makes two systems touch."],
  ["Garrison", "The neutral defenders of an unclaimed system: 3 fleets and a hidden number card. Garrisons never raise."],
  ["Head-on", "Two or more attackers meet on an empty system. They fight each other; nobody defends."],
  ["Home ground", `Defending one of your own home systems is worth +${HOME_GROUND}.`],
  ["Influence", "The money of the galaxy. Earned at Dawn and from Rich systems, spent on deals, bets, Summits and powers."],
  ["Law", "A rule that bends the game for everyone. Three are active; Summits can swap them, the Amenders can edit them."],
  ["Mandate", "A secret goal. Keep 2 of the 4 you're dealt; completing one is worth +2 Sway for the rest of the game."],
  ["Null", "A card played as a raise to switch off one race power for the rest of that Clash."],
  ["Parley", "An opening card that offers a deal. Both Parley: share the system or the attacker leaves. Alone: back off with Salvage."],
  ["Pledge", "Your secret answer in the Council: which side you join, with how many fleets, and your opening card."],
  ["PRECEDENT", "The Archivists' ghost card: a faded copy (−2) of a card their opponent played face up earlier."],
  ["Raise", "After openings flip, the side that is behind plays another card face up or folds. Max 3 raises per side."],
  ["Receipt", "The line-by-line breakdown under each side in a Clash. Every point shows where it came from."],
  ["REWIND", "The Recurrent's power: once per Cycle, roll a lost Clash back to the start of the Raise."],
  ["Summit", "In Cycles 3 and 6, sealed Influence bids decide which new Law replaces an old one. The lowest Sway bids +2."],
  ["Sway", "Victory points. 1 per neutral or shared system, 2 per opponent home held alone, +2 per completed Mandate. First to 10 wins."],
  ["Truce", "A public deal not to attack each other for 2 Cycles. Breaking it is a BETRAYAL."],
  ["Vector", "Your one move per Cycle: a target system next to one you hold, plus up to 4 fleets."],
].map(([title, text]) => ({ title, text }));

export const SECTIONS: Section[] = [
  {
    id: "goal", group: "Basics", title: "Win the galaxy", kicker: "The goal", art: "goal", sfx: "win",
    keywords: "victory win points score objective aim",
    paras: [
      "EXCEPTION is a game for 2 to 6 players (best with 4 to 6) where every alien race **breaks one rule** of the game. You plan together, then watch together.",
      "You win by being the first to **10 Sway** at the end of a Cycle. If nobody gets there, the highest Sway after **Cycle 8** wins. Players who tie for the lead **win together**.",
      "Sway comes from systems you take from others or from the neutral middle, and from secret **Mandates** you complete.",
    ],
  },
  {
    id: "galaxy", group: "Basics", title: "The galaxy", kicker: "The map", art: "galaxy",
    keywords: "map board systems setup start home neutral",
    paras: [
      "Each player starts with **3 home systems** on the outer ring, one of them **Rich**, with **4 fleets** on each. You also start with **3 Influence** and **5 cards**.",
      "The inner ring holds **one neutral system per player**, each with a trait and a **garrison** of 3 fleets plus a hidden card. Neighbouring home systems touch across the border, so you're never far from a fight.",
      "Lines show which systems touch. You can only reach a system that touches one you hold, unless someone folds space.",
    ],
  },
  {
    id: "deck", group: "Basics", title: "The deck", kicker: "Cards", art: "deck", sfx: "card",
    keywords: "cards hand number parley null deck",
    paras: [
      "The deck holds **number cards from 1 to 8** (more low cards than high: four 1s, five each of 2 to 5, four 6s, three 7s and three 8s), plus **4 Parley** and **4 Null** cards.",
      "You draw 2 cards every Dawn, up to your hand limit (7, unless a Law or race says otherwise). Every card you play in a Clash is spent, **win or lose**, so a full hand is power and a thin hand is a target.",
    ],
  },
  {
    id: "cycle", group: "A Cycle", title: "The Cycle", kicker: "Plan together, then watch together", art: "cycle",
    keywords: "round turn phases order sequence",
    paras: [
      "The game is played in **Cycles**, and everyone acts at the same time. There are no turns to wait for.",
      "**Dawn** pays you. **Laws** lets some races use their power (and in Cycles 3 and 6 holds a Summit). In **Plan** everyone secretly picks a Vector. **Convergence** reveals them all at once. The **Council** is the loud part where fighters ask for help. **Showtime** plays every Clash one at a time while everyone watches. **Reckoning** counts Sway.",
    ],
  },
  {
    id: "dawn", group: "A Cycle", title: "Dawn", kicker: "Phase 1", art: "dawn", sfx: "coin",
    keywords: "income influence draw recover drift start of cycle",
    paras: [
      "Every player gains **1 Influence, +1 per Rich system** they hold. Up to **2 destroyed fleets** come back from the Drift onto your weakest home (+1 per Shipyard). Everyone draws **2 cards** up to their hand limit.",
      "Undertow Echoes go off at Dawn, and players near a coming Echo feel a **tremor** one Cycle early.",
    ],
  },
  {
    id: "laws-phase", group: "A Cycle", title: "Laws and powers", kicker: "Phase 2", art: "laws", sfx: "stamp",
    keywords: "summit bid amend fold space power phase",
    paras: [
      "Races with a once-per-Cycle power that shapes the board act here: the **Amenders** rewrite a Law, the **Foldwrights** fold space.",
      "In **Cycles 3 and 6** a **Law Summit** is held. Three candidate Laws are offered, and everyone makes a sealed Influence bid for one of them and the Law it should replace. The **lowest Sway** player gets +2 on their bid. The top bid wins and pays.",
    ],
  },
  {
    id: "plan", group: "A Cycle", title: "Plan and Convergence", kicker: "Phases 3 and 4", art: "vectors", sfx: "reveal",
    keywords: "vector attack move target secret simultaneous reveal arrows last word",
    paras: [
      "Everyone secretly picks **one Vector**: a target system next to one they hold, and up to **4 fleets** (the Fleet Cap). You always leave at least 1 fleet on every system you hold. You may also stay home.",
      "At **Convergence** all Vectors appear at once, and the arrows on the map become this Cycle's fight card. A lone Vector into an empty system takes it straight away. Everything else becomes a **Clash**: against the holder, against a neutral garrison, or **head-on** when attackers meet on an empty system.",
      "Attacking someone you have a truce with is a **BETRAYAL** (see Truces).",
    ],
  },
  {
    id: "council", group: "A Cycle", title: "The Council", kicker: "Phase 5", art: "council",
    keywords: "ask allies ally help offer influence pledge truce negotiate diplomacy",
    paras: [
      "The loud phase. Fighters **ask for allies in public** and can offer Influence for help. Anyone can propose a **truce**.",
      "Then everyone **pledges in secret**: which side to join and with how many fleets, plus each fighter's face-down **opening card**. An ask is public, but nobody knows who will actually show up.",
      "Deals are enforced: if someone you paid shows up for you, the promised Influence moves automatically when they flip. Promises about the future can still be broken.",
    ],
  },
  {
    id: "showtime", group: "A Cycle", title: "Showtime: the Clash", kicker: "Phase 6", art: "clash", sfx: "card",
    keywords: "clash fight battle combat strength receipt allies flip openings reveal",
    paras: [
      "Clashes play out **one at a time, smallest first**, in front of everyone. First bets are placed, then **allies flip** one by one, then the **opening cards** flip.",
      `Strength is **fleets + allies' fleets + cards**, plus bonuses: **+${HOME_GROUND} for defending your own home**, +2 in a Nebula, and anything from Laws and race powers. The **receipt** under each side shows every point.`,
      "If the attacker wins, its allies **co-hold** the system with it. If the defender wins, each defending ally earns **1 Influence per fleet** it sent. Losing fleets go to the **Drift**. A dead heat with nobody ahead destroys everyone's fleets in it.",
    ],
  },
  {
    id: "raise", group: "A Cycle", title: "The Raise", kicker: "Inside a Clash", art: "raise", sfx: "fold",
    keywords: "raise fold behind tie tiebreak card bluff",
    paras: [
      "After the openings flip, the side that is **behind** must play another number card face up, or **fold**. Then the other side may be behind, and so on.",
      "**Ties count the defender as ahead** (the Tiebreak Law can flip that). Each side can raise **3 times**. Read their hand size before you commit: every card played is gone, even if you win.",
    ],
  },
  {
    id: "special-cards", group: "A Cycle", title: "Parley and Null", kicker: "Special cards", art: "special",
    keywords: "parley null deal salvage switch off cancel power",
    paras: [
      "**Parley** is an opening card. If both sides open with it, they get a moment to deal: share the system, or the attacker withdraws. Disagree and each side loses a fleet. Parley alone and you back off, collecting **Salvage** (Influence for your fleets).",
      "**Null** is played as a raise. It switches off **one race power** for the rest of that Clash.",
    ],
  },
  {
    id: "bets", group: "A Cycle", title: "The betting book", kicker: "Showtime side game", art: "bets", sfx: "coin",
    keywords: "bet gamble wager pool adored",
    paras: [
      "Players who aren't fighting in a Clash may bet **up to 2 Influence** on a side before the reveals. Allies can only back their own side.",
      "Winners split the whole pool in proportion to their bets. If nobody backed the winner, bets are returned. The **Adored** gain strength from every bet on them.",
    ],
  },
  {
    id: "truces", group: "A Cycle", title: "Truces and betrayal", kicker: "Diplomacy", art: "betrayal", sfx: "betrayal",
    keywords: "truce betrayal branded peace deal break pact",
    paras: [
      "A truce is offered in the Council and lasts **2 Cycles**. While it holds, attacking the other player is a public **BETRAYAL**.",
      "The traitor pays the victim **3 Influence** and is **Branded** until the end of next Cycle: everyone fighting them gets **+1**.",
    ],
  },
  {
    id: "reckoning", group: "A Cycle", title: "Reckoning and Sway", kicker: "Phase 7", art: "sway", sfx: "win",
    keywords: "score sway points count end of cycle victory",
    paras: [
      "At the end of each Cycle, completed Mandates are revealed and Sway is counted.",
      "**1 Sway** per neutral system you hold. **2 Sway** per opponent home you hold alone. **1 Sway** for any system you share with someone. **+2 Sway** per completed Mandate. Your own homes are worth nothing: you have to go out and take things.",
      "Reach **10** and you win. After Cycle 8 the highest Sway wins.",
    ],
  },
  {
    id: "mandates", group: "Rules that bend", title: "Secret Mandates", kicker: "Hidden goals", art: "mandates", sfx: "reveal",
    keywords: "mandate secret objective goal mission",
    paras: [
      "At the start you're dealt 4 Mandates and **keep 2 in secret**. Each one you complete is worth **+2 Sway** for the rest of the game, and is revealed to everyone at Reckoning.",
    ],
    items: mandateItems,
  },
  {
    id: "laws", group: "Rules that bend", title: "Laws", kicker: "The rulebook is live", art: "laws",
    keywords: "law rule modifier summit amend",
    paras: [
      "Three Laws are active each game (hover the chips in the top bar to read them). They change the rules for everyone. Summits in Cycles 3 and 6 can swap one, and the Amenders can rewrite their numbers.",
    ],
    items: lawItems,
  },
  {
    id: "traits", group: "Rules that bend", title: "System traits", kicker: "Not all stars are equal", art: "traits", sfx: "reveal",
    keywords: "trait rich shipyard nebula anomaly system bonus",
    paras: ["Neutral systems and one of each player's homes carry a trait. Holding them pays off in different ways."],
    items: traitItems,
  },
  ...raceSections,
  {
    id: "coming", group: "Races", title: "Coming later", kicker: "Not built yet",
    keywords: "future planned brokers fine print superposed unwritten",
    paras: ["These races are designed and have portraits, but aren't in the game yet."],
    items: [
      { title: "Brokers of Vey", text: "Traders of the galaxy. Their power is being redesigned.", img: "brokers", tag: "Soon" },
      { title: "Fine Print", text: "Masters of the small print in every deal.", img: "fine-print", tag: "Soon" },
      { title: "Superposed", text: "In two places at once until someone looks.", img: "superposed", tag: "Soon" },
      { title: "Unwritten", text: "A race whose rules nobody has written yet.", img: "unwritten", tag: "Soon" },
    ],
  },
  {
    id: "modes", group: "Playing", title: "Ways to play", kicker: "Menu", art: "modes",
    keywords: "tutorial solo multiplayer bots autopilot timers spectate watch room invite",
    paras: [
      "**Watch the tutorial game**: a full bot game seen through Nova's eyes (the Amenders), with lessons the first time each idea appears and a panel showing what Nova's bot is thinking. Pause, step, and change the speed.",
      "**Solo skirmish**: you against 2 to 5 bots (Cadet, Officer or Admiral), with optional turn timers. The **Autopilot** button lets a bot play your seat for a while.",
      "**Multiplayer**: create or join a room and share the invite link. Empty seats are bots. If someone drops, a bot takes over until they return; if the host leaves, another player's browser carries on.",
      "**Watch bots play**: a spectator game with every card visible.",
    ],
  },
  {
    id: "glossary", group: "Playing", title: "Glossary", kicker: "A to Z",
    keywords: "terms definitions words dictionary",
    paras: ["Every term in one place."],
    items: GLOSSARY,
  },
];

export const GROUPS = [...new Set(SECTIONS.map((s) => s.group))];

/** Plain text of a string with **bold** markers removed. */
export function plain(t: string): string {
  return t.replace(/\*\*/g, "");
}

function norm(t: string): string {
  return t.toLowerCase();
}

/** Splits a query into lowercase words. */
export function terms(q: string): string[] {
  return norm(q).split(/\s+/).filter((w) => w.length > 0);
}

function hit(text: string, words: string[]): boolean {
  const t = norm(plain(text));
  return words.every((w) => t.includes(w));
}

export type Match = { section: Section; items: Item[] | undefined; score: number };

/**
 * Which sections match a query. A section matches when its own text has every word; otherwise it
 * still shows if some of its list items match (only those items are shown).
 */
export function search(q: string, sections: Section[] = SECTIONS): Match[] {
  const words = terms(q);
  if (!words.length) return sections.map((s) => ({ section: s, items: s.items, score: 0 }));
  const out: Match[] = [];
  for (const s of sections) {
    const head = [s.title, s.kicker ?? "", s.group, s.keywords ?? ""].join(" ");
    const all = [head, ...s.paras].join(" ");
    const items = s.items?.filter((it) => hit(`${it.title} ${it.text}`, words));
    if (hit(all, words)) {
      out.push({ section: s, items: s.items, score: hit(s.title, words) ? 3 : hit(head, words) ? 2 : 1 });
    } else if (items?.length) {
      out.push({ section: s, items, score: 1 });
    }
  }
  return out;
}
