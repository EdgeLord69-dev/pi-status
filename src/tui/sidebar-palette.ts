import type { PaletteRole } from "../shared/types.ts";

export interface PaletteTheme {
  fg(color: PaletteRole, text: string): string;
}

export interface AtelierPalette {
  paint(role: PaletteRole, text: string): string;
}

export type Palette = AtelierPalette;

export function createPalette(theme: PaletteTheme, colorEnabled = true): AtelierPalette {
  return {
    paint: (role, text) => (colorEnabled ? theme.fg(role, text) : text),
  };
}
