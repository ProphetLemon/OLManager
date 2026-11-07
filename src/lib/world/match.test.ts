// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildIndex, matchPerson, type Entity, type IdMap } from "../../../scripts/world/lib/match.mjs";

const entity = (id: string, ign: string, name: string, nat = "KR", stale = false, dob?: string): Entity => ({ id, ign, name, nat, stale, dob, ref: { id } });
const person = (ign: string, realName: string, country: string | null = "South Korea", page: string = ign, birthDate?: string) => ({ ign, page, realName, country, birthDate });
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
    expect(sameCountry.status).toBe("review");
  });

  it("sends an IGN-only hit to review when the record only stores the IGN as its name", () => {
    const result = match(person("Pungyeon", "Kim Pung-yeon"), [entity("p1", "Pungyeon", "Pungyeon")]);
    expect(result).toMatchObject({ status: "review", confidence: "ign-only" });
    expect(result.entity?.id).toBe("p1");
  });

  it("sends a renamed player matched on the real name alone to review", () => {
    const result = match(person("NewTag", "Kim Min-seok"), [entity("p1", "OldTag", "Kim Min-seok")]);
    expect(result).toMatchObject({ status: "review", confidence: "name-only" });
  });

  it("accepts a name-only or ign-only hit when both dates of birth are known and agree", () => {
    const renamed = match(person("NewTag", "Kim Min-seok", "South Korea", "NewTag", "2003-05-04"), [entity("p1", "OldTag", "Kim Min-seok", "KR", false, "2003-05-04")]);
    expect(renamed).toMatchObject({ status: "matched", confidence: "name-only+dob" });
    const ignOnly = match(person("Pungyeon", "Kim Pung-yeon", "South Korea", "Pungyeon", "2001-02-03"), [entity("p1", "Pungyeon", "Pungyeon", "KR", false, "2001-02-03")]);
    expect(ignOnly).toMatchObject({ status: "matched", confidence: "ign-only+dob" });
  });

  it("keeps a weak hit in review when the dates of birth differ or only one side knows it", () => {
    const differ = match(person("NewTag", "Kim Min-seok", "South Korea", "NewTag", "2003-05-04"), [entity("p1", "OldTag", "Kim Min-seok", "KR", false, "1999-01-01")]);
    expect(differ).toMatchObject({ status: "review", reason: expect.stringMatching(/differ/) });
    const oneSided = match(person("NewTag", "Kim Min-seok", "South Korea", "NewTag", "2003-05-04"), [entity("p1", "OldTag", "Kim Min-seok")]);
    expect(oneSided.status).toBe("review");
  });

  it("keeps IGN plus real name as a strong match even without a date of birth", () => {
    expect(match(person("DuDu", "Lee Dong-ju"), [entity("p1", "DuDu", "Dong-ju Lee")]).status).toBe("matched");
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
    const pinnedRename = match(person("NewTag", "Kim Min-seok"), [entity("p1", "OldTag", "Kim Min-seok")], { players: [{ page: "NewTag", id: "p1" }] });
    expect(pinnedRename).toMatchObject({ status: "matched", confidence: "override" });

    const twins = [entity("a", "Daglas", "Kacper Dagiel"), entity("b", "Daglas", "Kacper Dagiel")];
    const rejected = match(person("Daglas", "Kacper Dagiel", "Poland"), twins, { rejections: [{ page: "Daglas", id: "b", kind: "player" }] });
    expect(rejected.entity?.id).toBe("a");
  });

  it("returns none for somebody the game has never heard of", () => {
    expect(match(person("Soboro", "Lim Seong-min"), [entity("p1", "Other", "Another Person")]).status).toBe("none");
  });
});
