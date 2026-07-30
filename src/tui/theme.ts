import type { FooterRenderColor } from "./render.ts";

export type StatusLineMenuColor = FooterRenderColor | "borderMuted";

export type StatusLineTheme = {
  fg: (color: StatusLineMenuColor, text: string) => string;
  bold: (text: string) => string;
  dim: (text: string) => string;
  rainbow: (text: string) => string;
};

type PiThemeLike = {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
};

function isPiThemeLike(value: unknown): value is PiThemeLike {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { fg?: unknown; bold?: unknown };
  return typeof candidate.fg === "function" && typeof candidate.bold === "function";
}

const RAINBOW_COLORS = [
  "#b281d6",
  "#d787af",
  "#febc38",
  "#e4c00f",
  "#89d281",
  "#00afaf",
  "#178fb9",
  "#b281d6",
];

function hexToAnsi(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function rainbow(text: string): string {
  let result = "";
  let colorIndex = 0;
  for (const char of text) {
    if (char === " " || char === ":") {
      result += char;
    } else {
      result += hexToAnsi(RAINBOW_COLORS[colorIndex % RAINBOW_COLORS.length]) + char;
      colorIndex++;
    }
  }
  return `${result}\x1b[0m`;
}

function safeFg(theme: PiThemeLike, color: string, text: string): string {
  try {
    return theme.fg(color, text);
  } catch {
    try {
      return theme.fg("accent", text);
    } catch {
      return text;
    }
  }
}

export const noTheme: StatusLineTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
  dim: (text) => text,
  rainbow: (text) => text,
};

export function fromPiTheme(theme: unknown): StatusLineTheme {
  if (!isPiThemeLike(theme)) return noTheme;
  return {
    fg: (color, text) => safeFg(theme, color, text),
    bold: (text) => theme.bold(text),
    dim: (text) => theme.fg("dim", text),
    rainbow: (text) => rainbow(text),
  };
}
