// Music and sound effects (generated with OpenRouter, see public/assets/CREDITS.json).
// Missing files are ignored, so the game works without assets.
const BASE = "./assets/";

export type Track = "title" | "plan" | "council" | "showtime" | "victory";
export type Sfx = "reveal" | "card" | "fold" | "rewind" | "betrayal" | "stamp" | "echo" | "coin" | "alarm" | "win";

class AudioManager {
  muted = false;
  musicVolume = 0.35;
  sfxVolume = 0.7;
  private current: { name: Track; el: HTMLAudioElement } | null = null;
  private unlocked = false;
  private wanted: Track | null = null;
  private sfxCache = new Map<Sfx, HTMLAudioElement>();
  private lastSfx = new Map<Sfx, number>();

  constructor() {
    try { this.muted = localStorage.getItem("exception.muted") === "1"; } catch { /* storage blocked */ }
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

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem("exception.muted", m ? "1" : "0"); } catch { /* ignore */ }
    if (this.current) this.current.el.volume = m ? 0 : this.musicVolume;
  }

  music(name: Track): void {
    this.wanted = name;
    if (!this.unlocked || this.current?.name === name) return;
    const old = this.current;
    const el = new Audio(BASE + "music/" + name + ".mp3");
    el.loop = name !== "victory";
    el.volume = 0;
    el.play().catch(() => {});
    this.current = { name, el };
    this.fade(el, this.muted ? 0 : this.musicVolume, 1200);
    if (old) { this.fade(old.el, 0, 1200, () => old.el.pause()); }
  }

  sfx(name: Sfx): void {
    if (this.muted || !this.unlocked) return;
    const now = performance.now();
    if (now - (this.lastSfx.get(name) ?? 0) < 120) return;
    this.lastSfx.set(name, now);
    let base = this.sfxCache.get(name);
    if (!base) { base = new Audio(BASE + "sfx/" + name + ".mp3"); this.sfxCache.set(name, base); }
    const el = base.cloneNode() as HTMLAudioElement;
    el.volume = this.sfxVolume;
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
