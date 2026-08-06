import type { FooterLayoutItem } from "./render.ts";
import type { StatusLineSegmentId } from "../shared/types.ts";

const DROP_TIER: Readonly<Partial<Record<StatusLineSegmentId, 0 | 1 | 2 | 3>>> = {
  "run-state": 0,
  "context-remaining": 0,
  "context-used": 0,
  model: 0,
  "model-with-reasoning": 0,
  "turn-progress": 0,
  "project-name": 1,
  "five-hour-limit": 1,
  "weekly-limit": 1,
  "response-performance": 1,
  "workspace-pulse": 1,
  "current-dir": 2,
  "git-branch": 2,
  "used-tokens": 3,
  "total-input-tokens": 3,
  "total-output-tokens": 3,
  "session-id": 3,
  "cache-read-tokens": 3,
  "cache-write-tokens": 3,
  "cache-hit": 3,
  "session-cost": 3,
  "access-type": 3,
};

// ponytail: unknown keys (e.g. extension statuses) default to tier 3 so they drop first when truncating.
const UNKNOWN_TIER: 0 | 1 | 2 | 3 = 3;

export function fitFooterRow<T extends FooterLayoutItem>(
  left: readonly T[],
  right: readonly T[],
  width: number,
  separator: string,
  visibleWidth: (text: string) => number,
): { left: T[]; right: T[] } {
  const fittedLeft = [...left];
  const fittedRight = [...right];
  if (width <= 0) return { left: [], right: [] };

  const rowWidth = () =>
    visibleWidth(fittedLeft.map((item) => item.text).join(separator)) +
    visibleWidth(fittedRight.map((item) => item.text).join(separator)) +
    (fittedLeft.length && fittedRight.length ? 1 : 0);

  const tierOf = (key: T["key"]) =>
    (DROP_TIER[key as StatusLineSegmentId] ?? UNKNOWN_TIER);

  while (rowWidth() > width && fittedLeft.length + fittedRight.length > 1) {
    let dropSide: "left" | "right" = "left";
    let dropIndex = -1;
    let dropTier = -1;
    for (const [side, items] of [
      ["left", fittedLeft],
      ["right", fittedRight],
    ] as const) {
      for (const [index, item] of items.entries()) {
        const tier = tierOf(item.key);
        if (tier < dropTier) continue;
        dropSide = side;
        dropIndex = index;
        dropTier = tier;
      }
    }
    (dropSide === "left" ? fittedLeft : fittedRight).splice(dropIndex, 1);
  }

  return { left: fittedLeft, right: fittedRight };
}
