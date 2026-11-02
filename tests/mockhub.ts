// In-memory stand-in for GameHub, enough to test NetSession: rooms, host, state, messages, migration.
import type { GameHub, HubEvents, PlayerInfo, RoomSummary } from "../src/net/gamehub.ts";

type Client = { id: number; name: string; handlers: Map<string, Set<(...a: any[]) => void>>; room: Room | null; closed: boolean };
type Room = { id: string; clients: Client[]; host: number; snapshot: unknown; summary: RoomSummary };

export class MockServer {
  rooms = new Map<string, Room>();
  nextId = 1;
  connect = (<S, D, M>(opts: { name?: string }) => this.client<S, D, M>(opts.name ?? "?")) as any;

  private emit(c: Client, ev: string, ...args: unknown[]) {
    if (c.closed) return;
    queueMicrotask(() => { for (const fn of c.handlers.get(ev) ?? []) fn(...args); });
  }

  client<S, D, M>(name: string): GameHub<S, D, M> {
    const server = this;
    const c: Client = { id: this.nextId++, name, handlers: new Map(), room: null, closed: false };
    const info = (x: Client): PlayerInfo => ({ id: x.id, name: x.name });
    const enter = (room: Room) => {
      c.room = room;
      room.clients.push(c);
      for (const o of room.clients) if (o !== c) server.emit(o, "player+", info(c));
      server.emit(c, "joined", room.summary, { you: c.id, host: room.host, players: room.clients.map(info) });
      if (room.snapshot !== null) server.emit(c, "state", room.snapshot, 1);
      return room.summary;
    };
    const hub: GameHub<S, D, M> = {
      ready: Promise.resolve({ you: c.id, name }),
      get you() { return c.id; },
      get host() { return c.room?.host ?? null; },
      get isHost() { return c.room?.host === c.id; },
      get room() { return c.room?.summary ?? null; },
      get players() { return c.room ? c.room.clients.map(info) : []; },
      on<E extends keyof HubEvents<S, D, M>>(ev: E, fn: HubEvents<S, D, M>[E]) {
        if (!c.handlers.has(ev)) c.handlers.set(ev, new Set());
        c.handlers.get(ev)!.add(fn as any);
        return () => c.handlers.get(ev)!.delete(fn as any);
      },
      async listRooms() { return [...server.rooms.values()].map((r) => r.summary); },
      watchLobby() { return () => {}; },
      async create(opts = {}) {
        const id = Math.random().toString(36).slice(2, 8).toUpperCase();
        const room: Room = { id, clients: [], host: c.id, snapshot: null, summary: { id, name: opts.name ?? "", public: !!opts.public, players: 0, maxPlayers: opts.maxPlayers ?? 8, meta: opts.meta, host: c.id, createdAt: 0 } };
        server.rooms.set(id, room);
        return enter(room);
      },
      async join(id) {
        const room = server.rooms.get(id);
        if (!room) throw new Error("no_such_room");
        return enter(room);
      },
      async leave() { return null; },
      setState(data) { if (c.room && c.room.host === c.id) { c.room.snapshot = structuredClone(data); for (const o of c.room.clients) if (o !== c) server.emit(o, "state", structuredClone(data), 1); } },
      sendDelta() {},
      send(data, to) { if (!c.room) return; for (const o of c.room.clients) if (o !== c && (to === undefined || o.id === to)) server.emit(o, "msg", structuredClone(data), c.id); },
      sendBinary() {},
      setRoom() {},
      close() {
        c.closed = true;
        const room = c.room;
        if (!room) return;
        room.clients = room.clients.filter((x) => x !== c);
        for (const o of room.clients) server.emit(o, "player-", c.id);
        if (room.host === c.id && room.clients.length) {
          room.host = room.clients[0].id;
          for (const o of room.clients) server.emit(o, "host", room.host);
        }
      },
    };
    return hub;
  }
}
