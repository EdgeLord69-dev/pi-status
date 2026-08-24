# Custom Colours

**Status:** Approved design, written for implementation review

**Date:** 2026-08-24

**Repository:** `@pi-vault/pi-status`

## Goal

Add persisted semantic colour presets configured from the `/statusline` Dashboard and applied consistently to Dashboard, Statusbar, and Sidebar. The default `Pi` preset follows Pi's active theme instead of overriding it.

## Scope

- Nine presets: `pi`, `atelier`, `catppuccin-mocha`, `catppuccin-latte`, `dracula`, `dracula-alucard`, `tokyonight-moon`, `tokyonight-day`, and `custom`.
- `Pi` as the default for new, legacy, missing, and malformed colour configuration.
- Six sourced third-party palettes arranged as explicit dark/light pairs, plus Atelier's existing fixed palette.
- A Dashboard Settings editor for all 14 Custom semantic roles.
- Draft preview inside Dashboard and transactional application to installed surfaces after Save.
- `NO_COLOR` as a hard runtime override that is separate from persisted presets.
- Focused config, theme, Dashboard, Sidebar, integration, and documentation coverage.

The Pi repository at `/Users/lanh/Developer/pi-packages/pi` and Atelier repository at `/Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier` are read-only references.

## Non-goals

- No dependency on Atelier or third-party theme packages.
- No runtime palette downloads.
- No Pi theme creation or global Pi theme mutation.
- No automatic dark/light switching for fixed presets; users select each variant explicitly.
- No project- or session-specific colour overrides.
- No graphical colour picker, CSS parser, import/export, or explicit reset action.
- No extra editable background role; the existing 14 semantic roles remain the complete Custom contract.
- No 256-colour downgrade for fixed/Custom presets; they emit truecolour sequences.
- No changes to layout, visibility, Sidebar contribution, or notification behavior.

## Configuration contract

Add these shared types:

```ts
export const PALETTE_ROLES = [
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
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];
export type ColorPreset =
  | "pi"
  | "atelier"
  | "catppuccin-mocha"
  | "catppuccin-latte"
  | "dracula"
  | "dracula-alucard"
  | "tokyonight-moon"
  | "tokyonight-day"
  | "custom";
export type FixedColorPreset = Exclude<ColorPreset, "pi" | "custom">;
export type HexColor = `#${string}`;
export type ColorPalette = Record<PaletteRole, HexColor>;
export type ColorSettings = {
  preset: ColorPreset;
  custom: ColorPalette;
  customInitialized: boolean;
};
```

Extend `PiStatusConfig` with required `colors: ColorSettings`.

The default persisted shape is:

```json
{
  "colors": {
    "preset": "pi",
    "custom": {
      "accent": "#b18cff",
      "primary": "#d4d4d4",
      "muted": "#808080",
      "dim": "#666666",
      "ready": "#6ea8fe",
      "working": "#ff9f43",
      "input": "#6ea8fe",
      "output": "#b18cff",
      "cache": "#7dd3fc",
      "cost": "#ff9f43",
      "context": "#6ea8fe",
      "menu": "#b18cff",
      "warning": "#ff9f43",
      "error": "#ff5d73"
    },
    "customInitialized": false
  }
}
```

### Normalization

- Missing or non-object `colors` becomes `{ preset: "pi", custom: ATELIER_COLORS, customInitialized: false }`.
- Only the nine declared IDs are valid. Unknown values, including the obsolete design-only value `none`, normalize to `pi`.
- A Custom colour is valid only when it matches `/^#[0-9a-f]{6}$/i`.
- Valid values are accepted case-insensitively and save in lowercase `#rrggbb` form.
- A missing or invalid role falls back independently to the corresponding Atelier value.
- Unknown Custom keys are ignored.
- `customInitialized` is true only for persisted `true`, or when a manually supplied valid preset is `custom`; other values normalize to false.
- Clones and returned configs contain independent Custom palette objects.
- Every successful `saveConfig` writes the complete canonical `colors` object.

### Custom initialization

- The first Dashboard transition into Custom while `customInitialized` is false copies the currently selected fixed palette.
- Entering Custom from Pi copies Atelier because Pi exposes live styling operations, not a stable `#rrggbb` palette.
- The transition sets `customInitialized` to true in the draft. It is therefore a persisted draft change even if the user cycles back to another preset before Save.
- Once initialized, Custom values survive preset changes, Save, and restart.

### Environment precedence

The presence of `NO_COLOR`, including an empty value, resolves every styling operation to identity. It does not alter loaded config, Dashboard draft, or the persisted preset. `NO_COLOR` is not a Dashboard preset.

## Preset catalogue

The UI order and labels are:

| ID                 | Label            | Source                                |
| ------------------ | ---------------- | ------------------------------------- |
| `pi`               | Pi               | Live Pi theme                         |
| `atelier`          | Atelier          | Atelier `FIXED_DARK`                  |
| `catppuccin-mocha` | Catppuccin Mocha | Catppuccin palette 1.8.0              |
| `catppuccin-latte` | Catppuccin Latte | Catppuccin palette 1.8.0              |
| `dracula`          | Dracula          | Dracula Classic                       |
| `dracula-alucard`  | Dracula Alucard  | Dracula Alucard                       |
| `tokyonight-moon`  | Tokyo Night Moon | TokyoNight `moon.lua`                 |
| `tokyonight-day`   | Tokyo Night Day  | TokyoNight `day.lua` generated values |
| `custom`           | Custom           | Persisted user palette                |

Third-party constants are copied locally and attributed to their official sources:

- [Catppuccin palette](https://github.com/catppuccin/palette/blob/main/palette.json)
- [Dracula Classic and Alucard palettes](https://github.com/dracula/dracula-theme#color-palette)
- [TokyoNight palette sources](https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors)

No upstream data is loaded at runtime. Tokyo Night Day stores the official generated result as static hex values; pi-status does not reproduce TokyoNight's Lua/HSLuv transformation.

### Source-token mapping

Both variants in a family use the same semantic source-token mapping:

| Role      | Catppuccin | Dracula        | Tokyo Night |
| --------- | ---------- | -------------- | ----------- |
| `accent`  | `mauve`    | `purple`       | `magenta`   |
| `primary` | `text`     | `foreground`   | `fg`        |
| `muted`   | `subtext0` | `comment`      | `comment`   |
| `dim`     | `overlay0` | `current line` | `dark3`     |
| `ready`   | `green`    | `green`        | `green`     |
| `working` | `peach`    | `orange`       | `orange`    |
| `input`   | `blue`     | `cyan`         | `blue`      |
| `output`  | `mauve`    | `purple`       | `magenta`   |
| `cache`   | `sky`      | `cyan`         | `cyan`      |
| `cost`    | `peach`    | `orange`       | `orange`    |
| `context` | `blue`     | `cyan`         | `blue`      |
| `menu`    | `pink`     | `pink`         | `purple`    |
| `warning` | `yellow`   | `yellow`       | `yellow`    |
| `error`   | `red`      | `red`          | `red`       |

Atelier retains its existing 14 exact values. Tests pin every fixed role to its copied hex value so source-token translation cannot drift unnoticed.

## Theme resolution

Existing renderer tokens map once into the 14 semantic roles:

| Existing token    | Palette role |
| ----------------- | ------------ |
| `accent`          | `accent`     |
| `dim`             | `dim`        |
| `success`         | `ready`      |
| `warning`         | `warning`    |
| `error`           | `error`      |
| `thinkingOff`     | `dim`        |
| `thinkingMinimal` | `muted`      |
| `thinkingLow`     | `ready`      |
| `thinkingMedium`  | `cache`      |
| `thinkingHigh`    | `working`    |
| `borderAccent`    | `accent`     |
| `borderMuted`     | `dim`        |
| `text`            | `primary`    |
| `muted`           | `muted`      |
| `mdHeading`       | `working`    |
| `syntaxType`      | `cache`      |

### Pi preset

Pi maps roles to the same live semantic tokens used by Atelier's unnamed-theme behavior:

| Palette role                | Pi token       |
| --------------------------- | -------------- |
| `accent`                    | `accent`       |
| `primary`                   | `text`         |
| `muted`                     | `muted`        |
| `dim`                       | `dim`          |
| `ready`, `input`, `context` | `thinkingLow`  |
| `working`, `cost`           | `mdHeading`    |
| `output`, `menu`            | `thinkingHigh` |
| `cache`                     | `syntaxType`   |
| `warning`                   | `warning`      |
| `error`                     | `error`        |

Pi `selectedBg`, bold, dim, and inverse delegate directly to the live Pi theme. Pi rainbow paints the standard role sequence through those live mappings. Because Pi supplies a proxy around its current theme and requests rendering on theme changes, existing controllers observe changes without reconstruction.

### Fixed and Custom presets

Fixed and Custom presets emit 24-bit ANSI foreground/background codes with scoped `39`/`49` resets. `selectedBg` uses the palette's `dim` value as a background. `inverse` renders `primary` foreground on `accent` background. Bold delegates safely to Pi; if unavailable or broken it returns unstyled text.

The xhigh rainbow sequence is `accent`, `error`, `working`, `warning`, `ready`, `context`, `cache`, and `output`, skipping spaces and colons without advancing the sequence.

`NO_COLOR` resolves foreground, background, bold, dim, inverse, and rainbow to identity.

## Dashboard behavior

The Settings tab rows are:

1. `Statusbar`
2. `Sidebar`
3. `Colours`
4. Fourteen Custom role rows only when Custom is selected
5. `Completion notifications`
6. `Save changes`

The Colours row displays the current label. Left/Right cycles through the catalogue order with wraparound. Entering Custom follows the initialization rules above.

Each Custom row displays the role name, canonical hex value, and a sample painted with that exact role. Enter or Space opens the existing Pi TUI `Input`, seeded with the current value. Escape cancels. Submit validates the complete input:

- Valid input is lowercased, stored in `draft.colors.custom[role]`, and closes the dialog.
- Invalid input keeps the dialog open and reports `Colour must use # followed by 6 hex digits` once per submit attempt.

The Settings viewport scrolls to keep the selected role visible.

Dashboard resolves its theme from `state.draft.colors` on every render, so preset and Custom changes preview immediately in Dashboard chrome and embedded Statusbar preview. Installed Statusbar and Sidebar use committed runtime config until Save succeeds. Failed Save retains installed colours, baseline, and dirty draft.

## Runtime data flow

1. `loadConfig` normalizes complete colour settings.
2. Runtime state stores that normalized config.
3. Footer and Sidebar resolve from the live Pi theme, committed settings, and `NO_COLOR` on every render.
4. Dashboard seeds baseline/draft from runtime config and retains the live Pi theme.
5. Dashboard resolves from draft settings while installed surfaces remain committed.
6. Confirmed Save persists first, updates runtime state, and requests existing surface renders.
7. Subsequent renders observe the committed preset without controller reconstruction.

## Failure behavior

- Persisted malformed values are repaired role-by-role during normalization.
- Dashboard rejects malformed hex before changing draft state.
- Unknown or broken Pi theme methods cannot crash rendering; affected styling falls back to plain text.
- Failed config Save retains committed colours and dirty Dashboard draft.
- Existing malformed-file overwrite refusal remains unchanged.

## Testing requirements

### Configuration and catalogue

- Legacy/missing configs default to Pi and an independent uninitialized Custom palette.
- Every preset round-trips; unknown and `none` normalize to Pi.
- Uppercase, lowercase, and mixed-case hex save lowercase; invalid/missing roles fall back independently.
- Unknown keys are omitted and palette objects are defensively copied.
- All seven fixed palettes match their pinned source-token values.

### Theme

- Pi delegates all roles to the documented tokens and observes live theme changes.
- Fixed/Custom roles emit exact scoped RGB sequences.
- Legacy renderer tokens map to the documented roles.
- Background, inverse, and rainbow follow their documented behavior.
- `NO_COLOR` emits no ANSI styling.
- Broken Pi theme methods fall back to plain text.

### Dashboard and runtime

- Preset row order and labels are stable.
- First Custom entry clones a fixed palette or Atelier from Pi, then remains preserved.
- Custom editor validation, cancellation, scrolling, and dirty state work as specified.
- Dashboard uses draft colours; installed surfaces remain committed before Save.
- Successful Save updates Footer and Sidebar on their next render.
- Failed Save keeps installed surfaces unchanged and Dashboard dirty.
- Pi theme changes reach all three surfaces without controller reconstruction.

## Documentation

Update `README.md` and `CHANGELOG.md` with Pi default/synchronization, all preset labels, Custom's 14 roles and initialization, truecolour requirements, source attribution, and separate `NO_COLOR` precedence.
