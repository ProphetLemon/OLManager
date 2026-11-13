import type { TagFormSizes } from "@/lib/match/live/tagPlacement";

/** Rendered size of the tag of each champion, by id. */
export type TagSizesById = Readonly<Record<string, TagFormSizes>>;

export const NO_TAG_SIZES: TagSizesById = {};

/**
 * Reads the size of every probe under `root` (`[data-probe]` with a `data-form`). An element with
 * no box (not laid out yet) says nothing, so the solver falls back to estimating that form.
 * It reads layout, so it runs once per commit and never per frame.
 */
export function readTagSizes(root: HTMLElement): TagSizesById {
  const sizes: Record<string, TagFormSizes> = {};
  for (const probe of root.querySelectorAll<HTMLElement>("[data-probe]")) {
    const id = probe.dataset.probe;
    const form = probe.dataset.form;
    if (!id || (form !== "full" && form !== "compact")) continue;
    const { offsetWidth: w, offsetHeight: h } = probe;
    if (!(w > 0) || !(h > 0)) continue;
    sizes[id] = { ...sizes[id], [form]: { w, h } };
  }
  return sizes;
}

/** Whether two readings are the same, so that a commit that changed no tag does not render twice. */
export function sameTagSizes(a: TagSizesById, b: TagSizesById): boolean {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) =>
    (["full", "compact"] as const).every((form) => {
      const left = a[id]?.[form];
      const right = b[id]?.[form];
      return left?.w === right?.w && left?.h === right?.h;
    }),
  );
}
