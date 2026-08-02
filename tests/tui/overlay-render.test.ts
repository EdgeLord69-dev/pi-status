import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  frame,
  frameContentWidth,
  MIN_FRAME_WIDTH,
  pad,
  renderTabBar,
  renderTooSmall,
} from "../../src/tui/overlay-render.ts";
import { noTheme, type StatusLineTheme } from "../../src/tui/theme.ts";

const ESC = String.fromCharCode(27);
const ansiTheme: StatusLineTheme = {
  fg: (_color, text) => `${ESC}[31m${text}${ESC}[39m`,
  bg: (_color, text) => `${ESC}[44m${text}${ESC}[49m`,
  bold: (text) => `${ESC}[1m${text}${ESC}[22m`,
  dim: (text) => `${ESC}[2m${text}${ESC}[22m`,
  inverse: (text) => `${ESC}[7m${text}${ESC}[27m`,
  rainbow: (text) => text,
};

const tabs = [
  { id: "layout", label: "Layout" },
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
];

describe("dashboard overlay shell", () => {
  it("uses the pi-usage frame geometry", () => {
    const lines = frame(["hello"], 20, noTheme);

    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("┏━━━━━━━━━━━━━━━━━━┓");
    expect(lines.at(-1)).toBe("┗━━━━━━━━━━━━━━━━━━┛");
    expect(lines.every((line) => visibleWidth(line) === 20)).toBe(true);
    expect(frameContentWidth(20)).toBe(14);
  });

  it("preserves a complete frame at the seven-column minimum", () => {
    expect(MIN_FRAME_WIDTH).toBe(7);
    expect(frame(["x"], MIN_FRAME_WIDTH, noTheme)).toEqual([
      "┏━━━━━┓",
      "┃     ┃",
      "┃  x  ┃",
      "┃     ┃",
      "┗━━━━━┛",
    ]);
    expect(frame(["x"], 6, noTheme).every((line) => visibleWidth(line) <= 6)).toBe(true);
  });

  it("keeps exact visible widths with ANSI styling", () => {
    const lines = frame(["hello"], 20, ansiTheme);

    expect(lines.join("\n")).toContain(ESC);
    expect(lines.every((line) => visibleWidth(line) === 20)).toBe(true);
  });

  it("pads and truncates by visible width", () => {
    expect(pad("hi", 5)).toBe("hi   ");
    expect(visibleWidth(pad("long value", 5))).toBe(5);
    expect(pad("x", 0)).toBe("");
  });

  it("keeps the active tab styled and shows both overflow directions", () => {
    const bar = renderTabBar(tabs, "session", 20, ansiTheme);
    const wideBar = renderTabBar(tabs, "session", 80, ansiTheme);

    expect(bar).toContain("Session");
    expect(bar).toContain("‹");
    expect(bar).toContain("›");
    expect(bar).toContain(`${ESC}[7m`);
    expect(visibleWidth(bar)).toBe(20);
    expect(wideBar).toContain(`${ESC}[44m`);
    expect(visibleWidth(wideBar)).toBe(80);
  });

  it("returns exact blank padding when no tabs exist", () => {
    const bar = renderTabBar([], "missing", 13, noTheme);

    expect(bar).toBe(" ".repeat(13));
    expect(visibleWidth(bar)).toBe(13);
  });

  it("bounds the small-terminal fallback exactly", () => {
    const lines = renderTooSmall(18, 4, noTheme);
    const narrow = renderTooSmall(6, 3, noTheme);

    expect(lines).toHaveLength(4);
    expect(lines.every((line) => visibleWidth(line) === 18)).toBe(true);
    expect(lines.join("\n")).toContain("Terminal too small");
    expect(narrow).toHaveLength(3);
    expect(narrow.every((line) => visibleWidth(line) === 6)).toBe(true);
  });

  it("normalizes zero fallback dimensions to one", () => {
    const lines = renderTooSmall(0, 0, noTheme);

    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0])).toBe(1);
  });
});
