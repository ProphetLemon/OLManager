// @vitest-environment node
// Active-pros pool, A6a: the pool overlay must fit the app's 4 MiB cap (MAX_OVERLAY_BYTES), so it is written compact and
// without the review-only `pool` summary the game ignores.
import { beforeAll, describe, expect, it } from "vitest";
import { MediaWikiClient } from "../../../scripts/world/lib/mediawiki-client.mjs";
import { serializeOverlay } from "../../../scripts/world/lib/overlay.mjs";
import { runRefresh } from "../../../scripts/world/lib/pipeline.mjs";
import { fetchPoolInputs, type PoolInputs } from "../../../scripts/world/lib/pool-fetch.mjs";
import { POOL_LIMITS, buildPoolOps, selectPool } from "../../../scripts/world/lib/pool.mjs";
import { FIXTURES } from "./fixtures";
import { baselines, context, overlayOf, stubClient, world } from "./poolFixtures";

// 4.7k adds on top of the 525 KB roster overlay must stay at or under 3.5 MiB: (3.5 MiB - 525 KB) / 4.7k.
const BYTES_PER_ADD = 700;

describe("serialising a pool overlay", () => {
  let overlay: ReturnType<typeof overlayOf>;
  beforeAll(async () => {
    const inputs = await fetchPoolInputs({ client: stubClient() });
    const ops = buildPoolOps({ selection: selectPool({ people: inputs.people, context, world }), tournamentIndex: new Map(inputs.tournaments.map((t) => [t.page, t])), games: inputs.games, baselines });
    overlay = overlayOf(ops);
  });

  it("is compact and costs at most the budgeted bytes per add", () => {
    const text = serializeOverlay(overlay as never);
    const adds = overlay.players.length + overlay.staff.length;
    expect(adds).toBeGreaterThan(40);
    expect(text).not.toContain("\n  ");
    expect(text.endsWith("\n")).toBe(true);
    expect(Buffer.byteLength(text) / adds).toBeLessThanOrEqual(BYTES_PER_ADD);
  });

  it("drops only the `pool` summary and keeps every field the game reads", () => {
    const parsed = JSON.parse(serializeOverlay(overlay as never));
    const strip = (ops: any[]) => ops.map(({ pool, ...rest }) => rest);
    expect(parsed.players).toEqual(strip(overlay.players));
    expect(parsed.staff).toEqual(strip(overlay.staff));
    expect(JSON.stringify(parsed)).not.toContain('"pool"');
    expect(parsed.schemaVersion).toBe((overlay as any).schemaVersion);
  });
});

describe("the pool-overlay-size gate", () => {
  let inputs: PoolInputs;
  const run = () =>
    runRefresh({
      dataDir: FIXTURES.dataDir, teamMapPath: FIXTURES.teamMap, idMapPath: FIXTURES.idMap, client: new MediaWikiClient({ cacheDir: FIXTURES.cacheDir, offline: true }),
      asOf: "2026-11-07", pool: { inputs } as never,
    });
  beforeAll(async () => {
    inputs = await fetchPoolInputs({ client: stubClient(), probe: "Send0o" });
  });

  it("measures the bytes the tool writes, not a bigger pretty-printed form", async () => {
    const result = await run();
    expect(result.pool!.bytes).toBe(Buffer.byteLength(serializeOverlay(result.overlay)));
    expect(result.pool!.bytes).toBeLessThan(Buffer.byteLength(JSON.stringify(result.overlay, null, 2)));
    expect(result.pool!.bytes).toBeLessThan(POOL_LIMITS.overlayBytes);
  });
});
