import { getFixedColorPalette } from "../core/colors.ts";
import {
  PALETTE_ROLES,
  type ColorSettings,
  type HexColor,
  type PaletteRole,
} from "../shared/types.ts";
import type { FooterRenderColor } from "./render.ts";

export type StatusLineMenuColor =
  | FooterRenderColor
  | "borderAccent"
  | "borderMuted"
  | "selectedBg"
  | "text"
  | "muted"
  | "mdHeading"
  | "syntaxType"
  | PaletteRole;

export type StatusLineTheme = {
  name?: string;
  fg: (color: StatusLineMenuColor, text: string) => string;
  bg: (color: StatusLineMenuColor, text: string) => string;
  bold: (text: string) => string;
  dim: (text: string) => string;
  inverse: (text: string) => string;
  rainbow: (text: string) => string;
};

type PiThemeLike = {
  name?: string;
  fg: (color: string, text: string) => string;
  bg?: (color: string, text: string) => string;
  bold: (text: string) => string;
  inverse?: (text: string) => string;
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

function safeThemeCall(call: () => unknown, fallback: string): string {
  try {
    const result = call();
    return typeof result === "string" ? result : fallback;
  } catch {
    return fallback;
  }
}

export const noTheme: StatusLineTheme = {
  name: undefined,
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
  dim: (text) => text,
  inverse: (text) => text,
  rainbow: (text) => text,
};

export function noColorRequested(env: object = process.env): boolean {
  return Object.hasOwn(env, "NO_COLOR");
}

export function fromPiTheme(theme: unknown): StatusLineTheme {
  if (!isPiThemeLike(theme)) return noTheme;
  return {
    name: theme.name,
    fg: (color, text) => safeFg(theme, color, text),
    bg: (color, text) => {
      try {
        return typeof theme.bg === "function" ? theme.bg(color, text) : text;
      } catch {
        return text;
      }
    },
    bold: (text) => theme.bold(text),
    dim: (text) => theme.fg("dim", text),
    inverse: (text) => {
      try {
        return typeof theme.inverse === "function" ? theme.inverse(text) : text;
      } catch {
        return text;
      }
    },
    rainbow: (text) => rainbow(text),
  };
}

const TOKEN_ROLES = {
  accent: "accent",
  dim: "dim",
  success: "ready",
  warning: "warning",
  error: "error",
  thinkingOff: "dim",
  thinkingMinimal: "muted",
  thinkingLow: "ready",
  thinkingMedium: "cache",
  thinkingHigh: "working",
  borderAccent: "accent",
  borderMuted: "dim",
  selectedBg: "dim",
  text: "primary",
  muted: "muted",
  mdHeading: "working",
  syntaxType: "cache",
} as const satisfies Partial<Record<StatusLineMenuColor, PaletteRole>>;

const PI_ROLES: Record<PaletteRole, string> = {
  accent: "accent",
  primary: "text",
  muted: "muted",
  dim: "dim",
  ready: "thinkingLow",
  working: "mdHeading",
  input: "thinkingLow",
  output: "thinkingHigh",
  cache: "syntaxType",
  cost: "mdHeading",
  context: "thinkingLow",
  menu: "thinkingHigh",
  warning: "warning",
  error: "error",
};

const RAINBOW_ROLES: readonly PaletteRole[] = [
  "accent",
  "error",
  "working",
  "warning",
  "ready",
  "context",
  "cache",
  "output",
];

function tokenRole(token: StatusLineMenuColor): PaletteRole {
  if (PALETTE_ROLES.includes(token as PaletteRole)) return token as PaletteRole;
  return TOKEN_ROLES[token as keyof typeof TOKEN_ROLES];
}

function channels(hex: HexColor): string {
  return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    .map((channel) => Number.parseInt(channel, 16))
    .join(";");
}

const foreground = (hex: HexColor, text: string) => `\x1b[38;2;${channels(hex)}m${text}\x1b[39m`;
const background = (hex: HexColor, text: string) => `\x1b[48;2;${channels(hex)}m${text}\x1b[49m`;

export function createStatusLineTheme(
  theme: unknown,
  colors: ColorSettings,
  env: object = process.env,
): StatusLineTheme {
  if (noColorRequested(env)) return noTheme;

  const piTheme = theme && typeof theme === "object" ? (theme as Partial<PiThemeLike>) : undefined;
  const palette = colors.preset === "custom" ? colors.custom : getFixedColorPalette(colors.preset);
  const usePi = colors.preset === "pi";

  const paintRole = (role: PaletteRole, text: string): string => {
    if (usePi) return safeThemeCall(() => piTheme?.fg?.(PI_ROLES[role], text), text);
    if (palette) return foreground(palette[role], text);
    return text;
  };

  const fg = (token: StatusLineMenuColor, text: string): string =>
    paintRole(tokenRole(token), text);

  const bg = (token: StatusLineMenuColor, text: string): string => {
    if (usePi) return safeThemeCall(() => piTheme?.bg?.(token, text), text);
    if (palette) return background(palette[tokenRole(token)], text);
    return text;
  };

  const bold = (text: string): string => safeThemeCall(() => piTheme?.bold?.(text), text);

  const inverse = (text: string): string => {
    if (usePi) return safeThemeCall(() => piTheme?.inverse?.(text), text);
    if (palette) return background(palette.accent, foreground(palette.primary, text));
    return text;
  };

  const rainbowRender = (text: string): string => {
    let result = "";
    let roleIndex = 0;
    for (const char of text) {
      if (char === " " || char === ":") {
        result += char;
        continue;
      }
      const role = RAINBOW_ROLES[roleIndex % RAINBOW_ROLES.length];
      roleIndex += 1;
      result += paintRole(role, char);
    }
    return result;
  };

  return {
    fg,
    bg,
    bold,
    dim: (text) => paintRole("dim", text),
    inverse,
    rainbow: rainbowRender,
  };
}
