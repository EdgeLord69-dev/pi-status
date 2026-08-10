export type PaletteRole =
  | "accent"
  | "primary"
  | "muted"
  | "dim"
  | "ready"
  | "working"
  | "input"
  | "output"
  | "cache"
  | "cost"
  | "context"
  | "menu"
  | "warning"
  | "error";

export interface PaletteTheme {
  readonly name?: string;
  fg(color: string, text: string): string;
}

const SEMANTIC: Readonly<Record<PaletteRole, string>> = {
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

const NO_COLOR: Readonly<Record<PaletteRole, string>> = {
  accent: "accent",
  primary: "text",
  muted: "muted",
  dim: "dim",
  ready: "text",
  working: "text",
  input: "text",
  output: "text",
  cache: "text",
  cost: "text",
  context: "text",
  menu: "text",
  warning: "warning",
  error: "error",
};

export interface AtelierPalette {
  paint(role: PaletteRole, text: string): string;
}

export type Palette = AtelierPalette;

export function createPalette(theme: PaletteTheme, colorEnabled: boolean): AtelierPalette {
  const tokens = colorEnabled ? SEMANTIC : NO_COLOR;
  return {
    paint: (role, text) => theme.fg(tokens[role], text),
  };
}
