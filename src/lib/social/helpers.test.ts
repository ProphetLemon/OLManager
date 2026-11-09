import { describe, expect, it } from "vitest";

import type { SocialPostData } from "@/store/gameStore";
import { authorRing, formatCount, sentimentClasses, verifiedMeta, visibleSocialPosts } from "./helpers";

const post = (id: string, date: string) => ({ id, date }) as SocialPostData;

describe("social helpers", () => {
  it("formats counts compactly", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1500)).toBe("1.5K");
    expect(formatCount(2_000_000)).toBe("2.0M");
  });

  it("sorts newest first, ties by id, and hides the Spanish-only post elsewhere", () => {
    const posts = [post("a", "2026-01-01"), post("b", "2026-01-01"), post("x_fan_bouzys_fnatic", "2026-02-01")];
    expect(visibleSocialPosts(posts, "en").map((p) => p.id)).toEqual(["b", "a"]);
    expect(visibleSocialPosts(posts, "es-ES").map((p) => p.id)).toEqual(["x_fan_bouzys_fnatic", "b", "a"]);
  });

  it("maps author and sentiment styles with fallbacks", () => {
    expect(verifiedMeta("Team")?.title).toBe("Golden verified team");
    expect(verifiedMeta("Fan")).toBeNull();
    expect(authorRing("Player")).toContain("emerald");
    expect(sentimentClasses("Unknown")).toBe(sentimentClasses("Calm"));
  });
});
