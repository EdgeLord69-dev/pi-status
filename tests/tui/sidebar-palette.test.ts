import { describe, expect, it } from "vitest";
import { createPalette, type PaletteRole } from "../../src/tui/sidebar-palette.ts";

const ROLES: readonly PaletteRole[] = [
  "accent",
  "primary",
  "muted",
  "dim",
  "ready",
  "working",
  "input",
  "output",
  "cache",
  "cost",
  "context",
  "menu",
  "warning",
  "error",
];

function makeTheme(overrides: { name?: string; fg: (color: string, text: string) => string }) {
  return overrides;
}

describe("createPalette", () => {
  it("emits fixed Midnight RGB for named themes on every role", () => {
    const theme = makeTheme({ name: "dark", fg: (color, text) => `[${color}:${text}]` });
    const palette = createPalette(theme, true);
    for (const role of ROLES) {
      const painted = palette.paint(role, "x");
      expect(painted.startsWith("\x1b[38;2;")).toBe(true);
      expect(painted.endsWith("\x1b[39m")).toBe(true);
    }
  });

  it("falls through to semantic tokens for unnamed themes", () => {
    const seen: string[] = [];
    const theme = makeTheme({
      fg: (color, text) => {
        seen.push(color);
        return text;
      },
    });
    const palette = createPalette(theme, true);
    palette.paint("cache", "x");
    palette.paint("cost", "x");
    expect(seen).toEqual(expect.arrayContaining(["syntaxType", "mdHeading"]));
    expect(seen).not.toContain("\x1b[38;2;");
  });

  it("drops to text for non-warning, non-error roles when color is disabled", () => {
    const seen: string[] = [];
    const theme = makeTheme({
      name: "dark",
      fg: (color, text) => {
        seen.push(color);
        return text;
      },
    });
    const palette = createPalette(theme, false);
    palette.paint("ready", "x");
    palette.paint("working", "x");
    palette.paint("warning", "x");
    palette.paint("error", "x");
    expect(seen).toEqual(expect.arrayContaining(["text", "warning", "error"]));
  });
});
