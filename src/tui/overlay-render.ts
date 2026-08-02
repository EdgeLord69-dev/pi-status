import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { StatusLineTheme } from "./theme.ts";

const PADDING_X = 2;
const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;

export const MIN_FRAME_WIDTH = 7;

export interface DashboardTab {
  id: string;
  label: string;
}

export function pad(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(text, width, "");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

export function frameContentWidth(width: number): number {
  return Math.max(1, Math.floor(width) - 2 - PADDING_X * 2);
}

export function frame(lines: string[], width: number, theme: StatusLineTheme): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const inner = Math.max(1, safeWidth - 2);
  const contentWidth = frameContentWidth(safeWidth);
  const border = (text: string) => theme.fg("borderAccent", text);
  const blank = `${border(FRAME.v)}${" ".repeat(inner)}${border(FRAME.v)}`;
  const out = [`${border(FRAME.tl)}${border(FRAME.h.repeat(inner))}${border(FRAME.tr)}`, blank];

  for (const line of lines) {
    out.push(
      `${border(FRAME.v)}${" ".repeat(PADDING_X)}${pad(line, contentWidth)}${" ".repeat(PADDING_X)}${border(FRAME.v)}`,
    );
  }

  out.push(blank, `${border(FRAME.bl)}${border(FRAME.h.repeat(inner))}${border(FRAME.br)}`);
  return out.map((line) => truncateToWidth(line, safeWidth, ""));
}

function activePill(theme: StatusLineTheme, label: string): string {
  return theme.fg("accent", theme.inverse(theme.bold(label)));
}

function inactivePill(theme: StatusLineTheme, label: string): string {
  return theme.bg("selectedBg", theme.fg("accent", label));
}

export function renderTabBar(
  tabs: DashboardTab[],
  activeId: string,
  width: number,
  theme: StatusLineTheme,
): string {
  const safeWidth = Math.max(1, Math.floor(width));
  if (tabs.length === 0) return " ".repeat(safeWidth);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const widths = tabs.map((tab) => visibleWidth(tab.label) + 2);
  const sliceWidth = (start: number, end: number): number => {
    let total = widths.slice(start, end).reduce((sum, cell) => sum + cell, 0);
    total += Math.max(0, end - start - 1);
    total += start > 0 ? 2 : 0;
    total += end < tabs.length ? 2 : 0;
    return total;
  };

  let start = activeIndex;
  let end = activeIndex + 1;
  let preferRight = true;
  while (start > 0 || end < tabs.length) {
    let progressed = false;
    const tryRight = (): boolean => {
      if (end < tabs.length && sliceWidth(start, end + 1) <= safeWidth) {
        end += 1;
        return true;
      }
      return false;
    };
    const tryLeft = (): boolean => {
      if (start > 0 && sliceWidth(start - 1, end) <= safeWidth) {
        start -= 1;
        return true;
      }
      return false;
    };

    if (preferRight) {
      if (tryRight()) progressed = true;
      if (tryLeft()) progressed = true;
    } else {
      if (tryLeft()) progressed = true;
      if (tryRight()) progressed = true;
    }
    if (!progressed) break;
    preferRight = !preferRight;
  }

  const cells = tabs.slice(start, end).map((tab) => {
    const label = ` ${tab.label} `;
    return tab.id === activeId ? activePill(theme, label) : inactivePill(theme, label);
  });
  if (start > 0) cells.unshift(theme.fg("dim", "‹"));
  if (end < tabs.length) cells.push(theme.fg("dim", "›"));
  return pad(cells.join(" "), safeWidth);
}

export function renderTooSmall(width: number, height: number, theme: StatusLineTheme): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const message = pad(theme.fg("accent", "Terminal too small · Esc"), safeWidth);
  const blank = " ".repeat(safeWidth);
  return Array.from({ length: safeHeight }, (_, index) =>
    index === Math.floor(safeHeight / 2) ? message : blank,
  );
}
