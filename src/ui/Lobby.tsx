import { useEffect, useRef, useState } from "preact/hooks";
import { RACES, raceDef } from "../engine/content.ts";
import type { Difficulty, RaceId } from "../engine/types.ts";
import { viewFor } from "../engine/view.ts";
import type { RoomSummary } from "../net/gamehub.ts";
import { HUB, NetSession, PROTOCOL, hubConfigured } from "../net/session.ts";
import { Portrait } from "./common.tsx";
import { GameScreen } from "./GameScreen.tsx";

export function Lobby({ room, onExit }: { room?: string; onExit: () => void }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem("exception.name") || ""; } catch { return ""; } });
  const [session, setSession] = useState<NetSession | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [code, setCode] = useState(room ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const auto = useRef(false);

  useEffect(() => () => session?.close(), [session]);

  const connectHub = async (): Promise<NetSession | null> => {
    if (session) return session;
    const nm = name.trim() || "Player";
    try { localStorage.setItem("exception.name", nm); } catch { /* ignore */ }
    const s = new NetSession(nm);
    s.onChange = () => setTick((t) => t + 1);
    setStatus("Connecting…");
    try {
      await s.ready;
      setStatus(null);
      setSession(s);
      s.watchLobby((r) => setRooms(r.filter((x) => (x.meta as { protocol?: number })?.protocol === PROTOCOL)));
      return s;
    } catch {
      setStatus("Could not connect to GameHub. Check the app key and that the app is registered.");
      s.close();
      return null;
    }
  };

  useEffect(() => {
    if (room && name && !auto.current && hubConfigured()) {
      auto.current = true;
      connectHub().then((s) => s?.join(room).catch(() => setStatus(`Room ${room} not found.`)));
    }
  }, []);

  if (!hubConfigured()) {
    return (
      <div class="menu" style={{ backgroundImage: "url(./assets/img/title.webp)" }}>
        <div class="menu-card">
          <h2>Multiplayer</h2>
          <p>This build has no GameHub app key. Register the game on GameHub and set <code>VITE_GAMEHUB_KEY</code> (and <code>VITE_GAMEHUB_APP</code>, default <code>{HUB.app}</code>) in <code>.env.local</code>, then rebuild. See README.</p>
          <button class="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  const sh = session?.shared;
  if (session && sh?.type === "game") {
    const st = session.state()!;
    const me = session.mySeat();
    const view = viewFor(st, me);
    const myReq = me !== null ? st.pending.find((r) => r.seat === me && !st.answers[r.id]) : undefined;
    return (
      <GameScreen
        view={view}
        me={me}
        onDecide={(d) => myReq && session.decide(myReq.id, d)}
        onExit={() => { session.close(); onExit(); }}
        label={`Room ${session.roomCode ?? ""}${session.isHost ? " · host" : ""}`}
      />
    );
  }

  const inRoom = session?.roomCode;
  const lobby = sh?.type === "lobby" ? sh : null;
  const mine = lobby?.players.find((p) => p.hubId === session?.you);
  const link = inRoom ? `${location.origin}${location.pathname}?room=${inRoom}` : "";

  return (
    <div class="menu" style={{ backgroundImage: "url(./assets/img/title.webp)" }}>
      <div class="menu-card">
        <h2>Multiplayer</h2>
        {status && <div class="muted">{status}</div>}
        {session?.error && <div style={{ color: "var(--red)" }}>Error: {session.error}</div>}
        {!inRoom && (
          <div class="setup">
            <label>Your name <input class="field" value={name} maxLength={16} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Name" /></label>
            <div class="opts">
              <button class="btn primary" disabled={!name.trim()} onClick={async () => { const s = await connectHub(); s?.create(`${name.trim()}'s galaxy`).catch((e) => setStatus(String(e.message))); }}>Create a room</button>
              <input class="field" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())} placeholder="CODE" maxLength={6} style={{ width: 90 }} />
              <button class="btn" disabled={!name.trim() || code.length !== 6} onClick={async () => { const s = await connectHub(); s?.join(code).catch(() => setStatus(`Room ${code} not found.`)); }}>Join</button>
            </div>
            {session && (
              <div>
                <div class="muted">Open rooms</div>
                {rooms.length === 0 && <div class="dim">None right now.</div>}
                {rooms.map((r) => <div class="ask-row"><b>{r.name}</b> <span class="muted">{r.players}/{r.maxPlayers}</span> <button class="btn small" onClick={() => session.join(r.id)}>Join</button></div>)}
              </div>
            )}
            {!session && <button class="btn small" disabled={!name.trim()} onClick={connectHub}>Browse open rooms</button>}
          </div>
        )}
        {inRoom && lobby && (
          <div class="setup">
            <div>Room <b style={{ fontFamily: "var(--head)", fontSize: 20, letterSpacing: "0.1em" }}>{inRoom}</b> <button class="btn small" onClick={() => navigator.clipboard?.writeText(link)}>Copy invite link</button></div>
            <div class="muted">Players ({lobby.players.length}). Empty seats up to {lobby.settings.count} are filled by bots.</div>
            {lobby.players.map((p) => (
              <div class="ask-row">{p.race !== "random" && <Portrait race={p.race} size={28} />}<b>{p.name}</b><span class="muted">{p.race === "random" ? "random race" : raceDef(p.race).name}</span>{p.hubId === session?.you && <span class="chip">you</span>}</div>
            ))}
            <div class="muted">Your race</div>
            <div class="race-grid">
              <button class={`race-pick ${mine?.race === "random" ? "sel" : ""}`} onClick={() => session!.chooseRace("random")}>🎲 Random</button>
              {RACES.map((r) => {
                const taken = lobby.players.some((p) => p.race === r.id && p.hubId !== session?.you);
                return <button class={`race-pick ${mine?.race === r.id ? "sel" : ""}`} disabled={taken} onClick={() => session!.chooseRace(r.id as RaceId)} title={r.power}><Portrait race={r.id} size={32} />{r.short}</button>;
              })}
            </div>
            {session!.isHost ? (
              <>
                <label>Seats <select value={lobby.settings.count} onChange={(e) => session!.setSettings({ count: Number((e.target as HTMLSelectElement).value) })}>{[3, 4, 5, 6].map((n) => <option value={n}>{n}</option>)}</select></label>
                <label>Bot skill <select value={lobby.settings.difficulty} onChange={(e) => session!.setSettings({ difficulty: (e.target as HTMLSelectElement).value as Difficulty })}><option value="cadet">Cadet</option><option value="officer">Officer</option><option value="admiral">Admiral</option></select></label>
                <label>Secret Mandates <input type="checkbox" checked={lobby.settings.mandates} onChange={(e) => session!.setSettings({ mandates: (e.target as HTMLInputElement).checked })} /></label>
                <button class="btn primary" onClick={() => session!.start()}>Start game</button>
              </>
            ) : <div class="waiting">Waiting for the host to start…</div>}
          </div>
        )}
        <button class="btn small" onClick={() => { session?.close(); onExit(); }}>Back</button>
      </div>
    </div>
  );
}
