import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Custom font sizes from the --text-* tokens in src/themes/default.css. Without
// registering them, tailwind-merge reads e.g. `text-caption` as a text colour and
// drops it when a colour class such as `text-muted-foreground` is also present.
// Keep in sync with the --text-<name> tokens (a test enforces it).
export const CUSTOM_FONT_SIZES = ["2xs", "caption", "map", "section", "title", "ovr", "scoreboard"] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...CUSTOM_FONT_SIZES] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
