import type { FooterLayoutItem, FooterLayoutKey } from "./render.ts";

const DROP_TIER = {
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
  "extension-status": 3,
} as const satisfies Readonly<Record<FooterLayoutKey, 0 | 1 | 2 | 3>>;

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

  while (rowWidth() > width && fittedLeft.length + fittedRight.length > 1) {
    let dropSide: "left" | "right" = "left";
    let dropIndex = -1;
    let dropTier = -1;
    for (const [side, items] of [
      ["left", fittedLeft],
      ["right", fittedRight],
    ] as const) {
      for (const [index, item] of items.entries()) {
        if (DROP_TIER[item.key] < dropTier) continue;
        dropSide = side;
        dropIndex = index;
        dropTier = DROP_TIER[item.key];
      }
    }
    (dropSide === "left" ? fittedLeft : fittedRight).splice(dropIndex, 1);
  }

  return { left: fittedLeft, right: fittedRight };
}
