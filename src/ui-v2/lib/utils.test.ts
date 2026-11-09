import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { CUSTOM_FONT_SIZES, cn } from "@/ui-v2/lib/utils"

describe("cn", () => {
  it("keeps a custom font size next to a text colour", () => {
    expect(cn("text-caption text-muted-foreground")).toBe("text-caption text-muted-foreground")
    for (const size of CUSTOM_FONT_SIZES) {
      expect(cn(`text-${size}`, "text-foreground")).toBe(`text-${size} text-foreground`)
    }
  })

  it("still lets a later font size replace an earlier one", () => {
    expect(cn("text-sm", "text-caption")).toBe("text-caption")
    expect(cn("text-caption", "text-title")).toBe("text-title")
  })

  it("still lets a later colour replace an earlier one", () => {
    expect(cn("text-foreground", "text-muted-foreground")).toBe("text-muted-foreground")
  })

  it("registers every --text-* size token from the default theme", () => {
    const css = readFileSync(resolve(__dirname, "../../themes/default.css"), "utf8")
    const tokens = [...css.matchAll(/^\s*--text-([a-z0-9]+):/gm)].map((m) => m[1])
    expect(tokens.length).toBeGreaterThan(0)
    expect([...CUSTOM_FONT_SIZES].sort()).toEqual([...new Set(tokens)].sort())
  })
})
