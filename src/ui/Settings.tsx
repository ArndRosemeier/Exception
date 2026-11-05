import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { SFX_INFO, TRACK_INFO, audio } from "../app/audio.ts";
import { CHANGELOG } from "../changelog.ts";

function useAudio() {
  const [, set] = useState(0);
  useEffect(() => audio.subscribe(() => set((n) => n + 1)), []);
}

/** Volume slider plus a gear that opens Settings. */
export function SoundControls() {
  useAudio();
  const [open, setOpen] = useState(false);
  const v = audio.volume;
  return (
    <span class="sound-controls">
      <button class="btn small ghost" title={v ? "Mute" : "Unmute"} onClick={() => audio.setMuted(v > 0)}>{v === 0 ? "🔇" : v < 0.4 ? "🔈" : "🔊"}</button>
      <input type="range" class="volume" min={0} max={100} value={Math.round(v * 100)} title={`Volume ${Math.round(v * 100)}%`}
        onInput={(e) => audio.setVolume(Number((e.target as HTMLInputElement).value) / 100)} />
      <button class="btn small ghost" title="Settings" onClick={() => setOpen(true)}>⚙</button>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </span>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  useAudio();
  const row = (kind: "sfx" | "music", id: string, name: string, when: string) => {
    const on = audio.isOn(kind, id);
    return (
      <label class="sound-row">
        <input type="checkbox" checked={on} onChange={() => { audio.setOn(kind, id, !on); audio.preview(kind, id); }} />
        <span class="sound-name">{name}</span>
        <span class="muted">{when}</span>
        <button class="btn small ghost" title="Play it" onClick={(e) => { e.preventDefault(); audio.preview(kind, id); }}>▶</button>
      </label>
    );
  };
  return createPortal(
    <div class="modal-back" onClick={onClose}>
      <div class="modal settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div class="settings-vol">Volume
          <input type="range" class="volume wide" min={0} max={100} value={Math.round(audio.volume * 100)} onInput={(e) => audio.setVolume(Number((e.target as HTMLInputElement).value) / 100)} />
          <b>{Math.round(audio.volume * 100)}%</b>
        </div>
        <h3>Sound effects</h3>
        <div class="muted small-note">Ticking or unticking a sound plays it once, so you can tell which is which.</div>
        {SFX_INFO.map((s) => row("sfx", s.id, s.name, s.when))}
        <h3>Music</h3>
        {TRACK_INFO.map((t) => row("music", t.id, t.name, t.when))}
        <div style={{ textAlign: "right", marginTop: 10 }}><button class="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </div>,
    document.body,
  );
}

export function WhatsNew({ onClose }: { onClose: () => void }) {
  const n = CHANGELOG.length;
  return createPortal(
    <div class="modal-back" onClick={onClose}>
      <div class="modal whatsnew" onClick={(e) => e.stopPropagation()}>
        <h2>What's new</h2>
        {CHANGELOG.map((r, i) => (
          <div class="release">
            <h3>v{((n - i) * 0.001).toFixed(3)} <span class="muted">{r.date}</span></h3>
            <ul>{r.notes.map((t) => <li>{t}</li>)}</ul>
          </div>
        ))}
        <div style={{ textAlign: "right", marginTop: 10 }}><button class="btn primary" onClick={onClose}>Close</button></div>
      </div>
    </div>,
    document.body,
  );
}
