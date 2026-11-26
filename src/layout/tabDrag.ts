import type { TabDrop } from "./model";

/** A tab or folder header of the bar, with its span along the bar's axis (x or y, in px). */
export interface TabSlot {
  kind: "tab" | "group";
  id: string;
  start: number;
  end: number;
}

/**
 * Where a tab dragged to `pos` (along the bar's axis) would be dropped. `slots` are the visible
 * tabs and folder headers, in order. Each one is split in two halves; past the last one is the end.
 */
export function tabDropAt(slots: TabSlot[], pos: number): TabDrop | null {
  for (const s of slots) {
    if (pos >= s.end) continue;
    const first = pos < (s.start + s.end) / 2;
    return s.kind === "tab" ? { kind: "tab", id: s.id, side: first ? "before" : "after" } : { kind: "group", id: s.id, side: first ? "before" : "into" };
  }
  return slots.length ? { kind: "end" } : null;
}

/** Edge (px) of the tab list where the drag scrolls it, and the most it scrolls per frame. */
export const AUTOSCROLL_EDGE_PX = 28;
const AUTOSCROLL_MAX_PX = 14;

/** How much to scroll the list (negative: backwards) with the pointer at `pos`, between `start` and `end`. */
export function autoScrollStep(pos: number, start: number, end: number): number {
  if (end - start <= AUTOSCROLL_EDGE_PX * 2) return 0;
  const speed = (d: number) => Math.ceil(((AUTOSCROLL_EDGE_PX - Math.max(0, d)) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_PX);
  if (pos < start + AUTOSCROLL_EDGE_PX) return -speed(pos - start);
  if (pos > end - AUTOSCROLL_EDGE_PX) return speed(end - pos);
  return 0;
}
