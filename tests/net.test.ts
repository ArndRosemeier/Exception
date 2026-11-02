import { afterEach, describe, expect, it, vi } from "vitest";
import { NetSession } from "../src/net/session.ts";
import { MockServer } from "./mockhub.ts";

const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

describe("multiplayer session (mock GameHub)", () => {
  afterEach(() => vi.useRealTimers());

  it("hosts, joins, starts, relays decisions, and survives the host leaving", async () => {
    vi.useFakeTimers();
    const server = new MockServer();
    const host = new NetSession("Arnd", server.connect);
    const guest = new NetSession("Bea", server.connect);
    await host.ready; await guest.ready;
    const room = await host.create("test");
    await flush();
    await guest.join(room.id);
    await flush();
    expect(host.shared?.type).toBe("lobby");
    guest.chooseRace("murmur");
    await flush();
    expect(host.shared?.type === "lobby" && host.shared.players.find((p) => p.name === "Bea")?.race).toBe("murmur");

    host.start();
    await flush(200);
    expect(guest.shared?.type).toBe("game");
    const gs = guest.mySeat();
    expect(gs).not.toBeNull();
    const st = guest.state()!;
    expect(st.seats[gs!].race).toBe("murmur");
    expect(st.seats.length).toBe(4); // 2 humans + 2 bots

    // The guest answers its mandates request through the host.
    const req = st.pending.find((r) => r.seat === gs && r.kind === "mandates")!;
    expect(req).toBeTruthy();
    const offer = st.players[gs!].mandateOffer.slice(0, 2);
    guest.decide(req.id, { kind: "mandates", keep: offer });
    await flush(200);
    expect(host.state()!.answers[req.id]).toEqual({ kind: "mandates", keep: offer });
    // A forged decision for someone else's seat is ignored.
    const other = host.state()!.pending.find((r) => r.seat !== gs)!;
    guest.decide(other.id, { kind: "mandates", keep: [] });
    await flush(50);
    expect(host.state()!.answers[other.id]).toBeUndefined();

    // Host leaves mid-game: the guest takes over, the host's seat goes to a bot, and play continues.
    const cycleBefore = guest.state()!.cycle;
    host.close();
    await flush(10);
    expect(guest.isHost).toBe(true);
    expect(guest.ctl).not.toBeNull();
    const hostSeat = guest.state()!.seats.find((s) => s.name === "Arnd")!;
    expect(hostSeat.controller).toBe("bot");
    guest.ctl!.setAutopilot(gs!, true);
    for (let i = 0; i < 400 && guest.state()!.cycle === cycleBefore; i++) await flush(1000);
    expect(guest.state()!.cycle).toBeGreaterThan(cycleBefore);
    guest.close();
  }, 30000);
});
