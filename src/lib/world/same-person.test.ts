// @vitest-environment node
// The world build's identity rules, ported to the pool: what the game folds away (K2) or hides from the AI.
import { describe, expect, it } from "vitest";
import {
  contractedPlayers,
  couldBeSamePerson,
  foldName,
  foldedByWorldBuild,
  foldedNames,
  nameWords,
  nationalityKey,
  realBirthDate,
} from "../../../scripts/world/lib/same-person.mjs";

const rec = (match_name: string, full_name: string, date_of_birth: string | null, nationality: string, id = "x", team_id: string | null = null) => ({
  id, match_name, full_name, date_of_birth, nationality, team_id,
});

describe("names, as person_identity.rs folds them", () => {
  it("decodes entities, drops parentheses and accents, keeps letters and digits", () => {
    expect(foldName("Víctor (Real Name)")).toBe("victor");
    expect(foldName("V-ictor")).toBe("victor");
    expect(foldName("Miguel&nbsp;Angel Cucho Rivera")).toBe("miguelangelcuchorivera");
    expect(foldName("Yasin Dinçer")).toBe("yasindincer");
    expect(foldName("(Only Parenthesis)")).toBe("onlyparenthesis");
  });

  it("counts a real name as two or more words once parentheses go", () => {
    expect(nameWords("Ace (Ignacio David Piaggio)")).toBe(1);
    expect(nameWords("Pau Vintró Nogué")).toBe(3);
    expect(foldedNames(rec("Ace (Ignacio David Piaggio)", "Ignacio David Piaggio", null, ""))).toEqual(["ace", "ignaciodavidpiaggio"]);
  });

  it("reads nationalities as ISO-2 keys and a placeholder date as no date", () => {
    expect(nationalityKey("South Korea")).toBe("KR");
    expect(nationalityKey("kr")).toBe("KR");
    expect(nationalityKey("Generated")).toBe("");
    expect(realBirthDate("2002-01-01")).toBeNull();
    expect(realBirthDate("not a date")).toBeNull();
    expect(realBirthDate("May 4, 2009")?.iso).toBe("2009-05-04");
  });
});

describe("could be the same person (PersonKey::could_be)", () => {
  it("accepts dates within 62 days, refuses a conflicting nationality or a farther date", () => {
    // Howl and Eclipse (cache: Howl page "Kim Min-jun", born 2009-05-04; the T1 academy record is dated 2009-04-28).
    expect(couldBeSamePerson(rec("Howl", "Kim Min-jun", "2009-05-04", "KR"), rec("Eclipse", "Kim Min-jun", "2009-04-28", "KR"), "loose")).toBe(true);
    expect(couldBeSamePerson(rec("Howl", "Kim Min-jun", "2009-05-04", "KR"), rec("Eclipse", "Kim Min-jun", "2009-04-28", "JP"), "loose")).toBe(false);
    expect(couldBeSamePerson(rec("Howl", "Kim Min-jun", "2009-05-04", "KR"), rec("Eclipse", "Kim Min-jun", "2008-01-28", "KR"), "loose")).toBe(false);
  });

  it("asks a shared real name for strict, and only a non-conflicting one for loose, when a date is missing", () => {
    const nickOnly = rec("Duro", "Duro", null, "KR");
    const dated = rec("Duro", "Joo Min-kyu", "2002-02-04", "KR");
    expect(couldBeSamePerson(nickOnly, dated, "strict")).toBe(false);
    expect(couldBeSamePerson(nickOnly, dated, "loose")).toBe(true);
    expect(couldBeSamePerson(rec("Duro", "Kim Min-jun", null, "KR"), dated, "loose")).toBe(false);
  });
});

describe("what the world build does with a pool add", () => {
  const club = [
    rec("Nisqy", "Yasin Dinçe", "1998-07-28", "BE", "player-c3e1", "lfl-team"),
    rec("Eclipse", "Kim Min-jun", "2009-04-28", "KR", "player-ecl", "lckcl-team"),
    rec("Kellie", "Joel Rodríguez Pérez", "2002-01-01", "ES", "player-kel", "les-team"),
  ];

  it("folds a pool add that shares two names with a record on a club (K2)", () => {
    expect(foldedByWorldBuild(rec("Kellie", "Joel Rodríguez Pérez", "2003-05-14", "ES", "player-pool"), club)).toEqual({ rule: "K2-two-names", with: "player-kel" });
  });

  it("folds a free agent that shares a name and a real birth date with one record on a club (K2)", () => {
    expect(foldedByWorldBuild(rec("Nisqy", "Yasin Dinçer", "1998-07-28", "BE", "player-pool"), club)).toEqual({ rule: "K2-name-and-birth-date", with: "player-c3e1" });
  });

  it("leaves a free agent alone for K2 when two records on clubs fit, though the AI guard still hides him", () => {
    const twoClubs = [...club, rec("Nisqy", "Y. Dincer", "1998-07-28", "BE", "player-other", "lec-team")];
    expect(foldedByWorldBuild(rec("Nisqy", "Yasin Dinçer", "1998-07-28", "BE", "player-pool"), twoClubs)?.rule).toBe("AI-loose");
  });

  it("counts the records already merged on one club once, as the world build counts roots (K2)", () => {
    // Two records of Nisqy on one club that share a name collapse into one person first, so a free agent with the same
    // name and birth date fits one person, not two.
    const sameClub = [
      rec("Nisqy", "Yasin Dinçe", "1998-07-28", "BE", "player-a", "lfl-team"),
      rec("Nisqy", "Y Dincer Alt", "1998-07-28", "BE", "player-b", "lfl-team"),
    ];
    expect(foldedByWorldBuild(rec("Nisqy", "Yasin Dinçer", "1998-07-28", "BE", "player-pool"), sameClub)?.rule).toBe("K2-name-and-birth-date");
    // On two clubs they stay two persons: K2 leaves the free agent alone.
    const twoClubs = [sameClub[0], { ...sameClub[1], team_id: "lec-team" }];
    expect(foldedByWorldBuild(rec("Nisqy", "Yasin Dinçer", "1998-07-28", "BE", "player-pool"), twoClubs)?.rule).toBe("AI-loose");
  });

  it("merges two records on different clubs when another pool add shares two names with both (K2)", () => {
    const twoClubs = [
      rec("Nisqy", "Yasin Dinçe", "1998-07-28", "BE", "player-a", "lfl-team"),
      rec("Nisqy", "Yasin Dinçe", "1998-07-28", "BE", "player-b", "lec-team"),
    ];
    const candidate = rec("Nisqy", "Other Name", "1998-07-28", "BE", "player-pool");
    // Alone, the two records are two persons: K2 leaves the free agent alone and only the AI guard hides him.
    expect(foldedByWorldBuild(candidate, twoClubs)?.rule).toBe("AI-loose");
    // A pool add that shares two names with both is folded into both, so they are one person and the candidate fits one root.
    const bridge = rec("Nisqy", "Yasin Dinçe", null, "BE", "player-bridge");
    expect(foldedByWorldBuild(candidate, twoClubs, [candidate, bridge])?.rule).toBe("K2-name-and-birth-date");
  });

  it("hides from the AI a pool add that could be a contracted record under the loose rule", () => {
    expect(foldedByWorldBuild(rec("Howl", "Kim Min-jun", "2009-05-04", "KR", "player-pool"), club)).toEqual({ rule: "AI-loose", with: "player-ecl" });
  });

  it("finds nothing for a person the world does not hold", () => {
    expect(foldedByWorldBuild(rec("Brand New", "Someone Else", "2001-02-03", "FR", "player-pool"), club)).toBeNull();
  });
});

describe("who is on a club once the roster overlay is applied", () => {
  const world = [
    { id: "a", team_id: "t1", match_name: "A" },
    { id: "b", team_id: "t1", match_name: "B" },
    { id: "c", team_id: "t2", match_name: "C" },
    { id: "d", team_id: null, match_name: "D" },
  ];

  it("drops retired and released people and adds the roster's own adds", () => {
    const ops = [
      { op: "retire", id: "a" },
      { op: "move", id: "b", team_id: null },
      { op: "move", id: "d", team_id: "t3" },
      { op: "add", player: { id: "e", team_id: "t4", match_name: "E" } },
      { op: "add", player: { id: "f", team_id: null, match_name: "F" } },
    ];
    expect(contractedPlayers(world as never, ops).map((p) => p.id).sort()).toEqual(["c", "d", "e"]);
  });
});
