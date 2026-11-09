import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { MAX_REROLLS } from "@/lib/customTeam/founders";
import { useFoundingSquad } from "./useFoundingSquad";
import { TAKEN_NICK, previewInvoke, squadFor } from "./foundersTestKit";
import type { PreviewCall } from "./foundersTestKit";

let calls: PreviewCall[] = [];

const input = { enabled: true, competitionId: "les", replacedTeamId: "les-a", shortName: "RAY" };

beforeEach(() => {
  calls = [];
  invoke.mockReset();
  invoke.mockImplementation(previewInvoke(calls));
});

describe("useFoundingSquad", () => {
  it("stays idle until the squad step is on screen", () => {
    renderHook(() => useFoundingSquad({ ...input, enabled: false }));
    expect(calls).toHaveLength(0);
  });

  it("previews the generated squad and reports it in sync", async () => {
    const { result } = renderHook(() => useFoundingSquad(input));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.inSync).toBe(true);
    expect(result.current.squad).toEqual(squadFor(result.current.seed));
    expect(result.current.generated).toEqual(result.current.squad);
    expect(calls).toHaveLength(1);
  });

  it("caps rerolls at three, draws a new seed each time and clears the edits", async () => {
    const { result } = renderHook(() => useFoundingSquad(input));
    await waitFor(() => expect(result.current.inSync).toBe(true));
    await act(async () => {
      await result.current.applyOverrides({ mid: { nick: "Ray" } });
    });
    expect(result.current.overrides).toEqual({ mid: { nick: "Ray" } });

    const seeds = [result.current.seed];
    for (let left = MAX_REROLLS - 1; left >= 0; left -= 1) {
      act(() => result.current.reroll());
      await waitFor(() => expect(result.current.inSync).toBe(true));
      expect(result.current.rerollsLeft).toBe(left);
      expect(result.current.overrides).toEqual({});
      seeds.push(result.current.seed);
    }
    expect(new Set(seeds).size).toBe(MAX_REROLLS + 1);

    const before = result.current.seed;
    act(() => result.current.reroll());
    expect(result.current.seed).toBe(before);
    expect(result.current.rerollsLeft).toBe(0);
  });

  it("keeps the shown squad and the edits when a candidate is rejected", async () => {
    const { result } = renderHook(() => useFoundingSquad(input));
    await waitFor(() => expect(result.current.inSync).toBe(true));
    const shown = result.current.squad;

    let error: unknown;
    await act(async () => {
      error = await result.current.applyOverrides({ mid: { nick: TAKEN_NICK } });
    });
    expect(error).toEqual({ kind: "invalid_field", role: "MID", field: "nick", reason: "taken" });
    expect(result.current.squad).toBe(shown);
    expect(result.current.overrides).toEqual({});
    expect(result.current.inSync).toBe(true);
  });

  it("is in sync only with the inputs the last preview used", async () => {
    const { result, rerender } = renderHook((props) => useFoundingSquad(props), { initialProps: input });
    await waitFor(() => expect(result.current.inSync).toBe(true));

    rerender({ ...input, shortName: "RYO" });
    expect(result.current.inSync).toBe(false);
    await waitFor(() => expect(result.current.inSync).toBe(true));
    expect(calls[calls.length - 1]?.shortName).toBe("RYO");
  });

  it("drops edits that no longer fit after the club changes and says so", async () => {
    const { result, rerender } = renderHook((props) => useFoundingSquad(props), { initialProps: input });
    await waitFor(() => expect(result.current.inSync).toBe(true));
    await act(async () => {
      await result.current.applyOverrides({ mid: { nick: "Ray" } });
    });

    // The backend now reports the edit as taken for the other club.
    invoke.mockImplementation(async (command: string, args?: unknown) => {
      const call = args as PreviewCall;
      if (call.replacedTeamId === "les-b" && call.founderOverrides?.mid) {
        throw JSON.stringify({ kind: "invalid_field", role: "MID", field: "nick", reason: "taken" });
      }
      return previewInvoke(calls)(command, args);
    });
    rerender({ ...input, replacedTeamId: "les-b" });
    await waitFor(() => expect(result.current.editsDropped).toBe(true));
    await waitFor(() => expect(result.current.inSync).toBe(true));
    expect(result.current.overrides).toEqual({});
    expect(result.current.squad).toEqual(result.current.generated);
  });

  it("ignores a slow response that a newer request replaced", async () => {
    const resolvers: Array<() => void> = [];
    const fake = previewInvoke(calls);
    invoke.mockImplementation(
      (command: string, args?: unknown) =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(fake(command, args)));
        }),
    );
    const { result } = renderHook(() => useFoundingSquad(input));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    const firstSeed = result.current.seed;

    act(() => result.current.reroll());
    const secondSeed = result.current.seed;
    await waitFor(() => expect(resolvers).toHaveLength(2));

    // The older request answers last and must not win.
    await act(async () => {
      resolvers[1]();
    });
    await waitFor(() => expect(result.current.squad).toEqual(squadFor(secondSeed)));
    await act(async () => {
      resolvers[0]();
    });
    expect(result.current.squad).toEqual(squadFor(secondSeed));
    expect(result.current.seed).not.toBe(firstSeed);
  });

  it("reports a failed preview and recovers on retry", async () => {
    invoke.mockRejectedValueOnce("backend down");
    const { result } = renderHook(() => useFoundingSquad(input));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("backend down");
    expect(result.current.inSync).toBe(false);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.inSync).toBe(true));
  });
});
