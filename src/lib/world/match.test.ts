// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildIndex, matchPerson, type Entity, type IdMap } from "../../../scripts/world/lib/match.mjs";

const entity = (id: string, ign: string, name: string, nat = "KR", stale = false): Entity => ({ id, ign, name, nat, stale, ref: { id } });
const person = (ign: string, realName: string, country: string | null = "South Korea", page: string = ign) => ({ ign, page, realName, country });
const match = (p: ReturnType<typeof person>, entities: Entity[], overrides: IdMap = {}) =>
  matchPerson(p, buildIndex(entities), { kind: "player", overrides });

describe("matchPerson", () => {
  it("matches on IGN plus real name regardless of word order and hyphenation", () => {
    const result = match(person("DuDu", "Lee Dong-ju"), [entity("p1", "DuDu", "Dong-ju Lee "), entity("p2", "Dudu", "Other Person")]);
    expect(result).toMatchObject({ status: "matched", confidence: "ign+name" });
    expect(result.entity?.id).toBe("p1");
  });

  it("refuses an IGN-only hit whose real name conflicts", () => {
    const result = match(person("Oner", "Mun Hyeon-jun"), [entity("p1", "Oner", "Lee Sang-hyeok")]);
    expect(result.status).toBe("refused");
    expect(result.reason).toMatch(/real name conflicts/);
  });

  it("refuses an IGN-only hit whose nationality conflicts when the name is unknown", () => {
    const placeholder = match(person("Ghost", "Ghost Person", "Spain"), [entity("p1", "Ghost", "Ghost", "KR")]);
    expect(placeholder).toMatchObject({ status: "refused", reason: expect.stringMatching(/nationality conflicts/) });
    const sameCountry = match(person("Ghost", "Ghost Person", "South Korea"), [entity("p1", "Ghost", "Ghost", "KR")]);
    expect(sameCountry.status).toBe("matched");
  });

  it("accepts an IGN-only hit when the record only stores the IGN as its name", () => {
    const result = match(person("Pungyeon", "Kim Pung-yeon"), [entity("p1", "Pungyeon", "Pungyeon")]);
    expect(result).toMatchObject({ status: "matched", confidence: "ign-only" });
  });

  it("matches a renamed player on the real name alone when nationality agrees", () => {
    const result = match(person("NewTag", "Kim Min-seok"), [entity("p1", "OldTag", "Kim Min-seok")]);
    expect(result).toMatchObject({ status: "matched", confidence: "name-only" });
  });

  it("reports two equally good candidates as ambiguous", () => {
    const result = match(person("Sharvel", "Kim Dan-woo"), [entity("a", "Sharvel", "Kim Dan-woo"), entity("b", "Sharvel", "Kim Dan-woo")]);
    expect(result.status).toBe("ambiguous");
    expect(result.candidates?.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("prefers the closer name, then the live shard over a stale duplicate", () => {
    const closer = match(person("Jiwoo", "Jung Ji-woo"), [entity("full", "Jiwoo", "Jung Ji-woo"), entity("loose", "Jiwoo", "Ji-woo")]);
    expect(closer.entity?.id).toBe("full");
    const live = match(person("FIESTA", "An Hyeon-seo"), [entity("stale", "FIESTA", "An Hyeon-seo", "KR", true), entity("live", "FIESTA", "An Hyeon-seo")]);
    expect(live.entity?.id).toBe("live");
  });

  it("applies the reviewed override file: explicit pairs win, rejections remove a candidate", () => {
    const entities = [entity("a", "Oner", "Lee Sang-hyeok")];
    expect(match(person("Oner", "Mun Hyeon-jun"), entities, { players: [{ page: "Oner", id: "a" }] })).toMatchObject({ status: "matched", confidence: "override" });

    const twins = [entity("a", "Daglas", "Kacper Dagiel"), entity("b", "Daglas", "Kacper Dagiel")];
    const rejected = match(person("Daglas", "Kacper Dagiel", "Poland"), twins, { rejections: [{ page: "Daglas", id: "b", kind: "player" }] });
    expect(rejected.entity?.id).toBe("a");
  });

  it("returns none for somebody the game has never heard of", () => {
    expect(match(person("Soboro", "Lim Seong-min"), [entity("p1", "Other", "Another Person")]).status).toBe("none");
  });
});
