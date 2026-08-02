import { describe, expect, it } from "vitest";
import {
  bodyRowBudget,
  DASHBOARD_CHROME_ROWS,
  fitViewport,
  MAX_HEIGHT_RATIO,
  maxOverlayRows,
  MIN_NORMAL_OVERLAY_ROWS,
  targetOverlayRows,
} from "../../src/tui/dashboard-layout.ts";

describe("dashboard responsive layout", () => {
  it("matches Pi's 85 percent floor and minimum clamp", () => {
    expect(MAX_HEIGHT_RATIO).toBe(0.85);
    expect(maxOverlayRows(40)).toBe(34);
    expect(maxOverlayRows(1)).toBe(1);
    expect(maxOverlayRows(0)).toBe(1);
  });

  it("separates the eight-row fallback from the nine-row normal shell", () => {
    expect(DASHBOARD_CHROME_ROWS).toBe(8);
    expect(MIN_NORMAL_OVERLAY_ROWS).toBe(9);
    expect(maxOverlayRows(10)).toBe(8);
    expect(maxOverlayRows(11)).toBe(9);
    expect(targetOverlayRows([1], 10)).toBe(8);
    expect(targetOverlayRows([1], 11)).toBe(9);
  });

  it("uses the longest natural body, handles empty input, and caps the result", () => {
    expect(targetOverlayRows([4, 12, 2], 40)).toBe(DASHBOARD_CHROME_ROWS + 12);
    expect(targetOverlayRows([], 40)).toBe(MIN_NORMAL_OVERLAY_ROWS);
    expect(targetOverlayRows([4, 40, 2], 20)).toBe(17);
  });

  it("derives the same body budget for every tab", () => {
    const target = targetOverlayRows([4, 12, 2], 40);

    expect(bodyRowBudget(target)).toBe(12);
    expect(bodyRowBudget(8)).toBe(0);
  });

  it("scrolls to selection and pads short content", () => {
    const lines = ["0", "1", "2", "3", "4", "5"];

    expect(fitViewport(lines, 4, 3, 0)).toEqual({
      lines: ["2", "3", "4"],
      offset: 2,
    });
    expect(fitViewport(["only"], 0, 3, 0)).toEqual({
      lines: ["only", "", ""],
      offset: 0,
    });
  });

  it("clamps stale offsets after filtering or resize", () => {
    expect(fitViewport(["0", "1"], 1, 3, 99)).toEqual({
      lines: ["0", "1", ""],
      offset: 0,
    });
    expect(fitViewport(["0", "1", "2"], undefined, 2, 99)).toEqual({
      lines: ["1", "2"],
      offset: 1,
    });
    expect(fitViewport(["0", "1"], 99, 1, 0)).toEqual({
      lines: ["1"],
      offset: 1,
    });
  });
});
