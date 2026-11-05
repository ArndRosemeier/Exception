// Music and sound effects (generated with OpenRouter, see public/assets/CREDITS.json).
// Missing files are ignored, so the game works without assets.
// One master volume, plus a switch per sound and per music track (Settings), all kept in localStorage.
import { VERSION } from "../changelog.ts";

const BASE = "./assets/";
// The version in the URL makes browsers fetch a replaced sound instead of a cached copy.
const bust = `?v=${VERSION}`;

export type Track = "title" | "plan" | "council" | "showtime" | "victory";
export type Sfx = "whoosh" | "launch" | "impact" | "tick" | "reveal" | "card" | "fold" | "rewind" | "betrayal" | "stamp" | "echo" | "coin" | "alarm" | "win";

/** Every sound with what triggers it in a game (shown in Settings). */
export const SFX_INFO: { id: Sfx; name: string; when: string }[] = [
  { id: "whoosh", name: "Whoosh", when: "A new step of the Cycle begins" },
  { id: "launch", name: "Launch", when: "All fleets launch" },
  { id: "reveal", name: "Reveal sting", when: "A Clash starts, an ally joins, space folds" },
  { id: "card", name: "Card", when: "A card is played" },
  { id: "fold", name: "Fold", when: "A side folds in the Raise" },
  { id: "impact", name: "Impact", when: "A Clash is decided" },
  { id: "coin", name: "Coins", when: "Bets and payments" },
  { id: "stamp", name: "Stamp", when: "Null, Tithe, Amend, Audit, Law Summit" },
  { id: "rewind", name: "Rewind", when: "The Recurrent rewind a Clash" },
  { id: "betrayal", name: "Betrayal", when: "Someone breaks a truce" },
  { id: "echo", name: "Rumble", when: "An Echo erupts, the Lattice shatters" },
  { id: "alarm", name: "Last Word", when: "The Last Word lands late" },
  { id: "win", name: "Chime", when: "A secret goal is completed" },
];
export const TRACK_INFO: { id: Track; name: string; when: string }[] = [
  { id: "title", name: "Title theme", when: "Menu" },
  { id: "plan", name: "Plan", when: "Dawn and Plan" },
  { id: "council", name: "Council", when: "Council and the manual" },
  { id: "showtime", name: "Showtime", when: "Clashes" },
  { id: "victory", name: "Victory", when: "Game over" },
];

const load = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : (JSON.parse(raw) as T); } catch { return fallback; }
};
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } };

class AudioManager {
  /** Master volume 0..1. */
  volume = 0.8;
  musicVolume = 0.35;
  sfxVolume = 0.7;
  off = new Set<string>(); // ids of switched-off sounds ("sfx:fold") and tracks ("music:showtime")
  private lastVolume = 0.8;
  private current: { name: Track; el: HTMLAudioElement } | null = null;
  private unlocked = false;
  private wanted: Track | null = null;
  private sfxCache = new Map<Sfx, HTMLAudioElement>();
  private lastSfx = new Map<Sfx, number>();
  private listeners = new Set<() => void>();

  constructor() {
    this.volume = load("exception.volume", load<number>("exception.muted", 0) === 1 ? 0 : 0.8);
    this.lastVolume = this.volume || 0.8;
    this.off = new Set(load<string[]>("exception.soundsOff", []));
    if (typeof window !== "undefined") {
      const unlock = () => {
        this.unlocked = true;
        if (this.wanted) this.music(this.wanted);
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      };
      window.addEventListener("pointerdown", unlock);
      window.addEventListener("keydown", unlock);
    }
  }

  get muted(): boolean { return this.volume === 0; }

  /** Re-render hook for components that show the volume. */
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed(): void { this.listeners.forEach((f) => f()); }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.volume > 0) this.lastVolume = this.volume;
    save("exception.volume", this.volume);
    if (this.current) this.current.el.volume = this.musicLevel(this.current.name);
    this.changed();
  }
  setMuted(m: boolean): void { this.setVolume(m ? 0 : this.lastVolume); }

  isOn(kind: "sfx" | "music", id: string): boolean { return !this.off.has(`${kind}:${id}`); }
  setOn(kind: "sfx" | "music", id: string, on: boolean): void {
    const key = `${kind}:${id}`;
    if (on) this.off.delete(key); else this.off.add(key);
    save("exception.soundsOff", [...this.off]);
    if (kind === "music" && this.current?.name === id) this.current.el.volume = this.musicLevel(this.current.name);
    this.changed();
  }

  private musicLevel(name: Track): number { return this.isOn("music", name) ? this.musicVolume * this.volume : 0; }

  music(name: Track): void {
    this.wanted = name;
    if (!this.unlocked || this.current?.name === name) return;
    const old = this.current;
    const el = new Audio(BASE + "music/" + name + ".mp3" + bust);
    el.loop = name !== "victory";
    el.volume = 0;
    el.play().catch(() => {});
    this.current = { name, el };
    this.fade(el, this.musicLevel(name), 1200);
    if (old) { this.fade(old.el, 0, 1200, () => old.el.pause()); }
  }

  sfx(name: Sfx): void {
    if (this.volume === 0 || !this.unlocked || !this.isOn("sfx", name)) return;
    const now = performance.now();
    if (now - (this.lastSfx.get(name) ?? 0) < 120) return;
    this.lastSfx.set(name, now);
    this.play(name);
  }

  /** Play a sound now, even if it is switched off (Settings preview). */
  preview(kind: "sfx" | "music", id: string): void {
    this.unlocked = true;
    if (kind === "sfx") { this.play(id as Sfx, true); return; }
    const el = new Audio(BASE + "music/" + id + ".mp3" + bust);
    el.volume = this.musicVolume * (this.volume || 0.5);
    el.play().catch(() => {});
    setTimeout(() => this.fade(el, 0, 800, () => el.pause()), 4000);
  }

  private play(name: Sfx, forced = false): void {
    let base = this.sfxCache.get(name);
    if (!base) { base = new Audio(BASE + "sfx/" + name + ".mp3" + bust); this.sfxCache.set(name, base); }
    const el = base.cloneNode() as HTMLAudioElement;
    el.volume = this.sfxVolume * (this.volume || (forced ? 0.5 : 0));
    el.play().catch(() => {});
  }

  private fade(el: HTMLAudioElement, to: number, ms: number, done?: () => void): void {
    const from = el.volume;
    const t0 = performance.now();
    const stepFn = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(stepFn);
      else done?.();
    };
    requestAnimationFrame(stepFn);
  }
}

export const audio = new AudioManager();
