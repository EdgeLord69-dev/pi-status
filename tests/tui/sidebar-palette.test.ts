import { describe, expect, it, vi } from "vitest";
import { createPalette } from "../../src/tui/sidebar-palette.ts";
import { PALETTE_ROLES, type PaletteRole } from "../../src/shared/types.ts";

describe("createPalette", () => {
  it("forwards every PALETTE_ROLES value to theme.fg unchanged", () => {
    const fg = vi.fn((color: string, text: string) => `[${color}:${text}]`);
    const palette = createPalette({ fg });

    for (const role of PALETTE_ROLES) {
      expect(palette.paint(role, role)).toBe(`[${role}:${role}]`);
    }
    expect(fg).toHaveBeenCalledTimes(PALETTE_ROLES.length);
    const calledRoles = fg.mock.calls.map(([role]) => role as PaletteRole);
    expect(calledRoles).toEqual([...PALETTE_ROLES]);
  });

  it("returns plain text when colorEnabled is false without calling theme.fg", () => {
    const fg = vi.fn((color: string, text: string) => `[${color}:${text}]`);
    const palette = createPalette({ fg }, false);

    for (const role of PALETTE_ROLES) {
      expect(palette.paint(role, role)).toBe(role);
    }
    expect(fg).not.toHaveBeenCalled();
  });

  it("captures the theme reference so live updates are observed", () => {
    let revision = 1;
    const painters = {
      get fg() {
        return (color: string, text: string) => `[${revision}:${color}:${text}]`;
      },
    };
    const palette = createPalette(painters);

    expect(palette.paint("accent", "x")).toBe("[1:accent:x]");
    revision = 2;
    expect(palette.paint("accent", "x")).toBe("[2:accent:x]");
  });
});
