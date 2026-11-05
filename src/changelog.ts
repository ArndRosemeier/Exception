// Release notes. Every build that ships adds one entry at the top; the version is 0.001 per entry,
// so it can never be forgotten or go backwards.
export type Release = { date: string; notes: string[] };

export const CHANGELOG: Release[] = [
  {
    date: "2026-11-05",
    notes: [
      "Clashes: the camera flies onto the contested planet and holds it above the Clash panel, then pulls back out afterwards.",
      "Clashes with 4 or 5 sides wrap into rows with smaller pieces, so totals and cards are no longer clipped.",
    ],
  },
  {
    date: "2026-11-05",
    notes: [
      "Version numbers and this What's new list.",
      "Sound: a volume slider instead of the on/off button.",
      "Settings: switch each sound effect and music track on or off. Clicking one plays it, so you can find the one that bothers you.",
      "Sound files now reload when a build replaces them, instead of playing an old cached copy.",
      "Earlier today: painted planets, orbiting ships and flying fleets on the map; Clashes as a face-to-face showdown; Sway rings; Cycle title cards; the Advise me button; empty choices answered for you.",
      "Earlier today: softer Last Word sound, a short Fold sound, a shorter Echo rumble.",
    ],
  },
];

export const VERSION = (CHANGELOG.length * 0.001).toFixed(3);
