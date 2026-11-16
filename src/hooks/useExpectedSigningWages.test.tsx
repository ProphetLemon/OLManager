import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerData } from "@/store/gameStore";

const getExpectedSigningWages = vi.fn();
vi.mock("@/services/transfersService", () => ({
  getExpectedSigningWages: (ids: string[]) => getExpectedSigningWages(ids),
}));

import { effectiveWage, useExpectedSigningWages } from "./useExpectedSigningWages";

function player(overrides: Partial<PlayerData>): PlayerData {
  return { id: "p", team_id: null, wage: 0, ...overrides } as PlayerData;
}

describe("useExpectedSigningWages", () => {
  beforeEach(() => {
    getExpectedSigningWages.mockReset();
  });

  it("asks only for free agents whose wage is 0 and returns the backend figure", async () => {
    getExpectedSigningWages.mockResolvedValue({ send0o: 211_000 });
    const players = [
      player({ id: "send0o" }),
      player({ id: "paid-fa", wage: 90_000 }),
      player({ id: "signed", team_id: "t1", wage: 0 }),
    ];

    const { result } = renderHook(() => useExpectedSigningWages(players));

    await waitFor(() => expect(result.current).toEqual({ send0o: 211_000 }));
    expect(getExpectedSigningWages).toHaveBeenCalledTimes(1);
    expect(getExpectedSigningWages).toHaveBeenCalledWith(["send0o"]);
  });

  it("does not call the backend when no player needs it", () => {
    renderHook(() => useExpectedSigningWages([player({ id: "paid", wage: 50_000 })]));
    expect(getExpectedSigningWages).not.toHaveBeenCalled();
  });

  it("keeps working when the lookup fails", async () => {
    getExpectedSigningWages.mockRejectedValue(new Error("no game"));
    const { result } = renderHook(() => useExpectedSigningWages([player({ id: "x" })]));
    await waitFor(() => expect(getExpectedSigningWages).toHaveBeenCalled());
    expect(result.current).toEqual({});
  });
});

describe("effectiveWage", () => {
  it("uses the expected wage only for a wage-0 free agent", () => {
    const map = { fa: 211_000, paid: 999 };
    expect(effectiveWage(player({ id: "fa" }), map)).toBe(211_000);
    expect(effectiveWage(player({ id: "paid", wage: 80_000 }), map)).toBe(80_000);
    expect(effectiveWage(player({ id: "none" }), map)).toBe(0);
  });
});
