export const MAX_HEIGHT_RATIO = 0.85;
export const DASHBOARD_CHROME_ROWS = 8;
export const MIN_NORMAL_OVERLAY_ROWS = DASHBOARD_CHROME_ROWS + 1;

export function maxOverlayRows(terminalRows: number): number {
  return Math.max(1, Math.floor(Math.max(0, terminalRows) * MAX_HEIGHT_RATIO));
}

export function targetOverlayRows(
  naturalBodyRows: readonly number[],
  terminalRows: number,
): number {
  const cap = maxOverlayRows(terminalRows);
  if (cap < MIN_NORMAL_OVERLAY_ROWS) return cap;
  const longestBody = Math.max(1, ...naturalBodyRows.map((rows) => Math.max(0, rows)));
  return Math.min(cap, DASHBOARD_CHROME_ROWS + longestBody);
}

export function bodyRowBudget(targetRows: number): number {
  return Math.max(0, targetRows - DASHBOARD_CHROME_ROWS);
}

export function fitViewport(
  lines: readonly string[],
  selectedLine: number | undefined,
  height: number,
  offset: number,
): { lines: string[]; offset: number } {
  const safeHeight = Math.max(0, height);
  if (safeHeight === 0) return { lines: [], offset: 0 };

  const maxOffset = Math.max(0, lines.length - safeHeight);
  let nextOffset = Math.max(0, Math.min(offset, maxOffset));
  if (selectedLine !== undefined && lines.length > 0) {
    const selected = Math.max(0, Math.min(selectedLine, lines.length - 1));
    if (selected < nextOffset) nextOffset = selected;
    else if (selected >= nextOffset + safeHeight) {
      nextOffset = selected - safeHeight + 1;
    }
    nextOffset = Math.max(0, Math.min(nextOffset, maxOffset));
  }

  const visible = lines.slice(nextOffset, nextOffset + safeHeight);
  while (visible.length < safeHeight) visible.push("");
  return { lines: visible, offset: nextOffset };
}
