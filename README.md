# EXCEPTION

A computer-native game of rule-breaking aliens, built from design doc **EXCEPTION v2** (including
"Bots: any seat, any time"). Every alien race is a patch to the rulebook. Plan together, then watch together.

## Play

```bash
npm install
npm run dev          # http://localhost:5175
npm run build        # static site in dist/ (relative paths, works from any sub-folder)
```

Menu modes:

- **Watch the tutorial game**: a full bot-only game seen through one player's eyes (Nova, the Amenders).
  Lessons pop up the first time each idea appears, and a panel shows what Nova's bot is thinking.
  Pause, step, and 0.5× to 4× speed.
- **Solo skirmish**: you against 2 to 5 bots (Cadet, Officer, Admiral), optional timers, Autopilot button.
- **Multiplayer**: GameHub rooms; empty seats are bots; dropped players are replaced by bots and get
  their seat back when they return; if the host leaves, another player's browser takes over.
- **Watch bots play**: spectator mode with every card visible.
- **Manual**: one animated page to scroll through every rule and race, with search (press `/`). Link straight to it with `?manual` or `?manual=race-tithe`.

## How it's built

| Path | What |
|---|---|
| `src/engine/` | The rules as a resumable state machine. `advance()` runs one beat or posts Requests; `submit()` answers them. State is plain JSON. |
| `src/engine/rules.ts` | Adjacency, Sway, and Clash strength with an itemised receipt (base, traits, Laws, race powers). |
| `src/engine/view.ts` | Per-seat views. Bots and screens only ever get a view, so bots can't cheat. |
| `src/bots/bot.ts` | Bots: tactics simulate options with the real rule functions; strategy scores targets; politics uses a trust record rebuilt from the public log; temperament sliders (greed, loyalty, vengeance, risk, bluff). Every decision carries a `why`. |
| `src/app/controller.ts` | Decides who answers each Request (local, bot, remote), timers (a missed deadline is played by the seat's bot), pacing. |
| `src/net/session.ts` | GameHub multiplayer (host-authoritative, turn-based). |
| `src/tutorial/tutor.ts` | Tutorial lessons and the narrated seat. |
| `src/ui/` | Preact UI: painted galaxy map (planets, orbiting ships, flying fleets), Showtime showdown, phase title cards, decision panels with an advisor ("Advise me" asks your bot), captain's log, toasts. Choices with nothing to decide are answered automatically. |
| `src/ui/manual/` | The animated, searchable manual. Races, Laws and Mandates are read from the engine content, so it stays in sync. |
| `public/assets/` | Art, music and sounds generated with OpenRouter (prompts, models and seeds in `CREDITS.json`). |

Versions: every shipped build adds one entry at the top of `src/changelog.ts` (shown under "What's new" in the menu); the version is 0.001 per entry, so v0.001 was the first.

Tests: `npm test` (60 bot-only games, fleet conservation, every race power fires, determinism, hidden
info, and a multiplayer session against an in-memory GameHub). Balance sim: `npm run sim -- 500`.

## Multiplayer (GameHub)

Uses Arnd's GameHub (`games.futuremagic.de`, docs in `ArndRosemeier/gameserver`). The app id is
`exception` and its key is built in (app keys are not secrets; they ship in the bundle). To override,
copy `.env.example` to `.env.local`.

Invite links are `?room=CODE`. To list the game in the lobby at `apps.futuremagic.de/lobby/`, add to its
`apps.json` entry:

```json
"gamehub": { "app": "exception", "key": "ghk_exception_…", "join": "?room={code}" }
```

Known limit: every client receives the full game state and shows only its own view, which keeps host
migration simple. A player could read hidden cards from devtools; fine among friends.

## Where this differs from the v2 doc (tuned with the balance sim)

- **Win at 10 Sway** (doc: 8). With 8, games ended after about 2 Cycles. Now games run about 4 to 6 Cycles (cap still 8).
- **Shared systems are worth 1 Sway to each holder**; an opponent's home held alone is worth 2.
- **Home ground: defending your own home is +2.** Homes start with 4 fleets, neutrals with a 3-fleet garrison plus a hidden card.
- **Mandates are harder** (e.g. hold 3 Rich systems, win 3 Clashes as attacker).
- **The Lattice can't be an ally** (it was winning 55% of games as everyone's favourite ally).
- **The Last Word can be asked as an ally** (with the ban it won 4%).
- **The Archivists' PRECEDENT** copies a card their current opponent played, as a faded copy (−2), for half its value in Influence (was winning 35%).
- **The Tithe** watches 2 races per Cycle in secret (a pre-commit instead of an interrupt). Owners pay automatically if they can.
- Sim win rates now: every race between about 13% and 24% (5-player average is 20%). The Tithe is the weakest.

## Not built yet

- Races: Brokers of Vey, Fine Print, Superposed, Unwritten (portraits exist).
- Async play (two windows per Cycle, raise orders, conditional pledges), the full contract builder, straight trades, free-text negotiation with bots.
- Solo campaign, daily galaxy, emotes, "Pact victory" ranking, chaos dial.
