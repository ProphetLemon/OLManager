// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_PAGE_SIZE, clampPageSize, fetchAllRows, scoreboardParams } from "../../../scripts/champions/pro-matchups.mjs";

type CargoRow = { title: Record<string, string> };

/** Fake Cargo client: honours offset, never returns more than 500 rows whatever limit is asked. */
function fakeCargo(total: number) {
  const calls: Record<string, string>[] = [];
  const all: CargoRow[] = Array.from({ length: total }, (_, index) => ({
    title: { GameId: `g${Math.floor(index / 2)}`, Champion: "Ahri", Role: "Mid", PlayerWin: index % 2 === 0 ? "Yes" : "No" },
  }));
  return {
    calls,
    client: {
      async get(params: Record<string, string>) {
        calls.push(params);
        const offset = Number(params.offset);
        const limit = Math.min(Number(params.limit), 500);
        return { cargoquery: all.slice(offset, offset + limit) };
      },
    },
  };
}

describe("clampPageSize", () => {
  it("caps at the Cargo limit and keeps smaller sizes", () => {
    expect(MAX_PAGE_SIZE).toBe(500);
    expect(clampPageSize(500)).toBe(500);
    expect(clampPageSize(501)).toBe(500);
    expect(clampPageSize("5000")).toBe(500);
    expect(clampPageSize(250)).toBe(250);
    expect(clampPageSize(250.9)).toBe(250);
  });

  it("rejects sizes that would never advance", () => {
    for (const bad of [0, -1, Number.NaN, "abc", undefined]) expect(() => clampPageSize(bad)).toThrow(/invalid page size/);
  });
});

describe("fetchAllRows", () => {
  it("keeps paging when a page size above 500 is requested", async () => {
    const { client, calls } = fakeCargo(1200);
    const rows = await fetchAllRows(client, { since: "2025-01-01", until: "2027-01-01", pageSize: 1000 });
    expect(rows).toHaveLength(1200);
    expect(calls.map((call) => [call.limit, call.offset])).toEqual([["500", "0"], ["500", "500"], ["500", "1000"]]);
  });

  it("stops after the first short page and orders by a total key", async () => {
    const { client, calls } = fakeCargo(40);
    const rows = await fetchAllRows(client, { since: "2025-01-01", until: "2027-01-01", pageSize: 500 });
    expect(rows).toHaveLength(40);
    expect(calls).toHaveLength(1);
    expect(scoreboardParams({ since: "a", until: "b", offset: 0, pageSize: 500 }).order_by).toBe("GameId,Role,PlayerWin");
  });
});
