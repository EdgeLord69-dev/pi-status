import { describe, expect, it, vi } from "vitest";
import { createPalette, type PaletteRole } from "../../src/tui/sidebar-palette.ts";

const SEMANTIC_TOKENS = {
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
} as const satisfies Readonly<Record<PaletteRole, string>>;

const NO_COLOR_TOKENS = {
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
} as const satisfies Readonly<Record<PaletteRole, string>>;

function assertRoleMap(name: string | undefined, expected: Readonly<Record<PaletteRole, string>>) {
  const fg = vi.fn((color: string, text: string) => `[${color}:${text}]`);
  const palette = createPalette({ ...(name === undefined ? {} : { name }), fg }, true);

  for (const role of Object.keys(expected) as PaletteRole[]) {
    expect(palette.paint(role, role)).toBe(`[${expected[role]}:${role}]`);
  }
  expect(fg).toHaveBeenCalledTimes(Object.keys(expected).length);
}

describe("createPalette", () => {
  it("routes every named-theme role through Pi semantic tokens", () => {
    assertRoleMap("dark", SEMANTIC_TOKENS);
  });

  it("routes every unnamed-theme role through the same Pi semantic tokens", () => {
    assertRoleMap(undefined, SEMANTIC_TOKENS);
  });

  it("keeps the established no-color role mapping for named themes", () => {
    const fg = vi.fn((color: string, text: string) => `[${color}:${text}]`);
    const palette = createPalette({ name: "dark", fg }, false);

    for (const role of Object.keys(NO_COLOR_TOKENS) as PaletteRole[]) {
      expect(palette.paint(role, role)).toBe(`[${NO_COLOR_TOKENS[role]}:${role}]`);
    }
  });

  it("resolves the live theme method on every paint", () => {
    let revision = 1;
    const theme = {
      get fg() {
        const current = revision;
        return (color: string, text: string) => `[${current}:${color}:${text}]`;
      },
    };
    const palette = createPalette(theme, true);

    expect(palette.paint("accent", "x")).toBe("[1:accent:x]");
    revision = 2;
    expect(palette.paint("accent", "x")).toBe("[2:accent:x]");
  });
});
