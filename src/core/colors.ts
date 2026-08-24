import {
  PALETTE_ROLES,
  type ColorPalette,
  type ColorPreset,
  type ColorSettings,
  type FixedColorPreset,
  type HexColor,
} from "../shared/types.ts";

export const COLOR_PRESET_IDS = [
  "pi",
  "atelier",
  "catppuccin-mocha",
  "catppuccin-latte",
  "dracula",
  "dracula-alucard",
  "tokyonight-moon",
  "tokyonight-day",
  "custom",
] as const satisfies readonly ColorPreset[];

export const ATELIER_COLORS: Readonly<ColorPalette> = Object.freeze({
  accent: "#b18cff",
  primary: "#d4d4d4",
  muted: "#808080",
  dim: "#666666",
  ready: "#6ea8fe",
  working: "#ff9f43",
  input: "#6ea8fe",
  output: "#b18cff",
  cache: "#7dd3fc",
  cost: "#ff9f43",
  context: "#6ea8fe",
  menu: "#b18cff",
  warning: "#ff9f43",
  error: "#ff5d73",
});

export const FIXED_COLOR_PALETTES: Readonly<Record<FixedColorPreset, Readonly<ColorPalette>>> =
  Object.freeze({
    atelier: ATELIER_COLORS,
    // Catppuccin palette 1.8.0: https://github.com/catppuccin/palette/blob/main/palette.json
    "catppuccin-mocha": Object.freeze({
      accent: "#cba6f7",
      primary: "#cdd6f4",
      muted: "#a6adc8",
      dim: "#6c7086",
      ready: "#a6e3a1",
      working: "#fab387",
      input: "#89b4fa",
      output: "#cba6f7",
      cache: "#89dceb",
      cost: "#fab387",
      context: "#89b4fa",
      menu: "#f5c2e7",
      warning: "#f9e2af",
      error: "#f38ba8",
    }),
    "catppuccin-latte": Object.freeze({
      accent: "#8839ef",
      primary: "#4c4f69",
      muted: "#6c6f85",
      dim: "#9ca0b0",
      ready: "#40a02b",
      working: "#fe640b",
      input: "#1e66f5",
      output: "#8839ef",
      cache: "#04a5e5",
      cost: "#fe640b",
      context: "#1e66f5",
      menu: "#ea76cb",
      warning: "#df8e1d",
      error: "#d20f39",
    }),
    // Dracula Classic/Alucard: https://github.com/dracula/dracula-theme#color-palette
    dracula: Object.freeze({
      accent: "#bd93f9",
      primary: "#f8f8f2",
      muted: "#6272a4",
      dim: "#44475a",
      ready: "#50fa7b",
      working: "#ffb86c",
      input: "#8be9fd",
      output: "#bd93f9",
      cache: "#8be9fd",
      cost: "#ffb86c",
      context: "#8be9fd",
      menu: "#ff79c6",
      warning: "#f1fa8c",
      error: "#ff5555",
    }),
    "dracula-alucard": Object.freeze({
      accent: "#644ac9",
      primary: "#1f1f1f",
      muted: "#6c664b",
      dim: "#6c664b",
      ready: "#14710a",
      working: "#a34d14",
      input: "#036a96",
      output: "#644ac9",
      cache: "#036a96",
      cost: "#a34d14",
      context: "#036a96",
      menu: "#a3144d",
      warning: "#846e15",
      error: "#cb3a2a",
    }),
    // TokyoNight: https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors
    "tokyonight-moon": Object.freeze({
      accent: "#c099ff",
      primary: "#c8d3f5",
      muted: "#636da6",
      dim: "#545c7e",
      ready: "#c3e88d",
      working: "#ff966c",
      input: "#82aaff",
      output: "#c099ff",
      cache: "#86e1fc",
      cost: "#ff966c",
      context: "#82aaff",
      menu: "#fca7ea",
      warning: "#ffc777",
      error: "#ff757f",
    }),
    "tokyonight-day": Object.freeze({
      accent: "#9854f1",
      primary: "#3760bf",
      muted: "#848cb5",
      dim: "#8990b3",
      ready: "#587539",
      working: "#b15c00",
      input: "#2e7de9",
      output: "#9854f1",
      cache: "#007197",
      cost: "#b15c00",
      context: "#2e7de9",
      menu: "#7847bd",
      warning: "#8c6c3e",
      error: "#f52a65",
    }),
  });

export const DEFAULT_COLOR_SETTINGS: Readonly<ColorSettings> = Object.freeze({
  preset: "pi",
  custom: ATELIER_COLORS,
  customInitialized: false,
});

const PRESETS = new Set<ColorPreset>(COLOR_PRESET_IDS);

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeHexColor(value: unknown, fallback: HexColor): HexColor {
  return isHexColor(value) ? (value.toLowerCase() as HexColor) : fallback;
}

export function getFixedColorPalette(preset: ColorPreset): Readonly<ColorPalette> | undefined {
  return Object.hasOwn(FIXED_COLOR_PALETTES, preset)
    ? FIXED_COLOR_PALETTES[preset as FixedColorPreset]
    : undefined;
}

export function normalizeColorSettings(input: unknown): ColorSettings {
  const value =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as {
          preset?: unknown;
          custom?: unknown;
          customInitialized?: unknown;
        })
      : {};
  const preset =
    typeof value.preset === "string" && PRESETS.has(value.preset as ColorPreset)
      ? (value.preset as ColorPreset)
      : "pi";
  const custom =
    value.custom && typeof value.custom === "object" && !Array.isArray(value.custom)
      ? (value.custom as Record<string, unknown>)
      : {};
  return {
    preset,
    custom: Object.fromEntries(
      PALETTE_ROLES.map((role) => [role, normalizeHexColor(custom[role], ATELIER_COLORS[role])]),
    ) as ColorPalette,
    customInitialized: value.customInitialized === true || preset === "custom",
  };
}
