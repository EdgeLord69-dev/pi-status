# Phase 4: Pi-Synchronized Colours, Documentation, and Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the Pi preset follows Pi's active theme across Dashboard, Statusbar, and Sidebar, prove transactional Custom-colour saves, document every preset and override, and complete release-level verification.

**Architecture:** Keep the completed production colour path unchanged. Extend the existing integration-test hosts so the same fake live Pi theme reaches Dashboard, Statusbar, and Sidebar, then test that render-time theme changes reach all three without controller reconstruction. Update only README and changelog after the integration contract is green.

**Tech Stack:** Markdown, pnpm, Biome, TypeScript 6, Vitest 4, Pi's live `Theme` proxy, and the package dry-run script.

**Spec:** `docs/superpowers/specs/2026-08-24-custom-colours-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-24-custom-colours.md` (read-only; do not modify).

**Prerequisite:** Phases 1-3 are complete. At review commit `df445d314`, `pnpm check` passes 960 tests across 35 files and `pnpm run pack:dry-run` exits zero.

## Reference contract

- Pi reference: `/Users/lanh/Developer/pi-packages/pi` at `dcd461925`.
- Atelier reference: `/Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier` at `fafa90d28`.
- Pi exports `theme` as a global proxy in `packages/coding-agent/src/modes/interactive/theme/theme.ts`; replacing the active theme changes what existing proxy references resolve.
- Pi passes that proxy to footer and custom-component factories in `packages/coding-agent/src/modes/interactive/interactive-mode.ts`.
- Pi's `onThemeChange` callback invalidates the TUI and requests a render. pi-status must consume the proxy at render time; it must not add its own watcher or reconstruct controllers.
- Atelier's `src/palette.ts` `UNNAMED_THEME` mapping is the source for pi-status's Pi semantic-role mapping.

## Global Constraints

- Modify only `/Users/lanh/Developer/pi-vault/pi-status`; Pi and Atelier repositories are read-only references.
- Add no dependency, runtime palette fetch, graphical picker, CSS parser, import/export, Pi theme watcher, or Pi global-theme mutation.
- Use `Pi` (`pi`) as the default preset. `NO_COLOR` is an environment override, never a preset.
- Accept case-insensitive hex input, persist only lowercase `#rrggbb` values, and retain exactly 14 editable semantic roles.
- Fixed and Custom presets emit truecolour; do not add a 256-colour conversion path.
- Dashboard uses draft colours; installed surfaces change only after persistence succeeds.
- Preserve malformed-file overwrite refusal and renderer plain-text fallbacks.
- Follow RED/GREEN/REFACTOR with focused tests before documentation changes.
- Run release checks with Node.js `>=24.15.0`; an engine warning on an older Node version is not release-level proof.
- Do not create commits unless the user authorizes them; when authorized, use the commit checkpoints in this plan.

---

## Phase boundary and usable result

This phase is complete when wiring-level tests prove successful and failed Custom-colour Save boundaries plus live Pi synchronization across all three surfaces; README and changelog match the shipped behavior; focused tests, `pnpm check`, and package dry-run pass; and the ten-item interactive acceptance matrix passes. The result is a documented, release-ready feature.

## File map

- Modify: `tests/helpers.ts` - allow the existing footer renderer helper to receive a fake live Pi theme.
- Modify: `tests/index-save.test.ts` - exercise Dashboard, Statusbar, and Sidebar through the existing extension wiring.
- Modify: `README.md` - document the persisted colour contract and runtime behavior.
- Modify: `CHANGELOG.md` - add the unreleased feature entry.

---

### Task 1: Prove Save boundaries and live Pi synchronization

**Files:**

- Modify: `tests/helpers.ts`
- Modify: `tests/index-save.test.ts`

**Interfaces:**

- Consumes `renderWithFactory(factory, options)`, `deferredCustomHost()`, `StatusLineDashboardComponent.render()`, the existing `saveConfig` module seam, and the real extension wiring in `src/index.ts`.
- Produces `renderWithFactory(factory, { theme })` and wiring-level proof that the three surfaces use draft, committed, or live Pi colours at the correct boundary.

- [ ] **Step 1: Write the failing wiring tests**

In `tests/index-save.test.ts`, extend `moveToSettingsRow`'s `rowType` union with `"color_preset"`, then add this local helper:

```ts
function editAtelierAccentDraft(
  component: StatusLineDashboardComponent,
  value = "#010203",
): void {
  for (let index = 0; index < 5; index += 1) component.handleInput("\t");
  moveToSettingsRow(component, "color_preset");
  component.handleInput("\x1b[D"); // Atelier -> Pi
  component.handleInput("\x1b[D"); // Pi -> Custom, seeded from Atelier
  component.handleInput("\x1b[B"); // Accent
  component.handleInput("\r");
  for (let index = 0; index < 7; index += 1) component.handleInput("\x7f");
  component.handleInput(value);
  component.handleInput("\r");
}
```

Add a successful Save-boundary test:

```ts
it("keeps Custom draft colours local until Save succeeds", async () => {
  const initial = config();
  initial.colors.preset = "atelier";
  const loadConfig = vi.fn(() => initial);
  const saveConfig = vi.fn();
  vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }));

  const { default: createExtension } = await import("../src/index.ts");
  const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
  const footerSpy = buildSetFooterSpy();
  createExtension(pi);

  const host = deferredCustomHost();
  const ctx = createContext({
    ui: {
      ...createContext().ui,
      setFooter: footerSpy.setFooter,
      custom: host.custom as unknown as ExtensionCommandContext["ui"]["custom"],
    },
  });
  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
  const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
    "",
    ctx,
  );
  await new Promise((resolve) => setImmediate(resolve));

  const component = host.component();
  if (!component) throw new Error("expected dashboard component");
  editAtelierAccentDraft(component);

  expect(component.render(120).join("\n")).toContain("38;2;1;2;3m");
  expect(renderWithFactory(footerSpy.calls.at(-1))).not.toContain("38;2;1;2;3m");
  expect(host.renderHostText()).not.toContain("38;2;1;2;3m");

  saveSettings(component);

  expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("38;2;1;2;3m");
  expect(host.renderHostText()).toContain("38;2;1;2;3m");
  expect(isDashboardDirty(component.getState())).toBe(false);

  host.resolveCustom(undefined);
  await commandPromise;
});
```

Add a failed Save-boundary test:

```ts
it("keeps installed colours unchanged when a Custom colour Save fails", async () => {
  const initial = config();
  initial.colors.preset = "atelier";
  const loadConfig = vi.fn(() => initial);
  const saveConfig = vi.fn(() => {
    throw new Error("disk full");
  });
  vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }));

  const { default: createExtension } = await import("../src/index.ts");
  const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
  const footerSpy = buildSetFooterSpy();
  createExtension(pi);

  const host = deferredCustomHost();
  const ctx = createContext({
    ui: {
      ...createContext().ui,
      setFooter: footerSpy.setFooter,
      custom: host.custom as unknown as ExtensionCommandContext["ui"]["custom"],
    },
  });
  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
  const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
    "",
    ctx,
  );
  await new Promise((resolve) => setImmediate(resolve));

  const component = host.component();
  if (!component) throw new Error("expected dashboard component");
  editAtelierAccentDraft(component);
  saveSettings(component);

  expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
  expect(isDashboardDirty(component.getState())).toBe(true);
  expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("38;2;177;140;255m");
  expect(renderWithFactory(footerSpy.calls.at(-1))).not.toContain("38;2;1;2;3m");
  expect(host.renderHostText()).toContain("38;2;177;140;255m");
  expect(host.renderHostText()).not.toContain("38;2;1;2;3m");

  host.resolveCustom(undefined);
  await commandPromise;
});
```

Add a live Pi synchronization test:

```ts
it("keeps all three Pi-preset surfaces synchronized with the live Pi theme", async () => {
  const initial = config();
  const loadConfig = vi.fn(() => initial);
  const saveConfig = vi.fn();
  vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }));

  let prefix = "pi:first";
  const liveTheme = {
    fg: (color: string, text: string) => `${prefix}:fg:${color}:${text}`,
    bg: (color: string, text: string) => `${prefix}:bg:${color}:${text}`,
    bold: (text: string) => `${prefix}:bold:${text}`,
    inverse: (text: string) => `${prefix}:inverse:${text}`,
  };
  const { default: createExtension } = await import("../src/index.ts");
  const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
  const footerSpy = buildSetFooterSpy();
  createExtension(pi);

  const host = deferredCustomHost(liveTheme);
  const ctx = createContext({
    ui: {
      ...createContext().ui,
      setFooter: footerSpy.setFooter,
      custom: host.custom as unknown as ExtensionCommandContext["ui"]["custom"],
    },
  });
  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
  const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
    "",
    ctx,
  );
  await new Promise((resolve) => setImmediate(resolve));

  const component = host.component();
  if (!component) throw new Error("expected dashboard component");
  const renderDashboard = () => component.render(120).join("\n");
  const renderFooter = () =>
    renderWithFactory(footerSpy.calls.at(-1), { theme: liveTheme });
  const renderSidebar = () => host.renderHostText();

  expect(renderDashboard()).toContain("pi:first");
  expect(renderFooter()).toContain("pi:first");
  expect(renderSidebar()).toContain("pi:first");
  const footerInstalls = footerSpy.calls.length;
  const customMounts = host.custom.mock.calls.length;

  prefix = "pi:second";

  expect(renderDashboard()).toContain("pi:second");
  expect(renderFooter()).toContain("pi:second");
  expect(renderSidebar()).toContain("pi:second");
  expect(footerSpy.calls).toHaveLength(footerInstalls);
  expect(host.custom).toHaveBeenCalledTimes(customMounts);

  host.resolveCustom(undefined);
  await commandPromise;
});
```

- [ ] **Step 2: Run the integration test and verify RED**

```bash
pnpm exec vitest run tests/index-save.test.ts
```

Expected: FAIL because `deferredCustomHost` does not accept a theme and `renderWithFactory` cannot pass one to the footer factory.

- [ ] **Step 3: Add the minimum fake-live-theme seams**

In `tests/helpers.ts`, extend the existing helper without adding a second renderer:

```ts
export function renderWithFactory(
  factory: unknown,
  options: { gitBranch?: string | null; width?: number; theme?: unknown } = {},
): string {
  if (typeof factory !== "function") return "";
  const component = (
    factory as (
      tui: unknown,
      theme: unknown,
      footerData: unknown,
    ) => { render: (width: number) => string[] }
  )(
    { requestRender: () => {} },
    options.theme ?? { fg: (_c: string, t: string) => t, rainbow: (t: string) => t },
    {
      getGitBranch: () => options.gitBranch ?? null,
      getExtensionStatuses: () => new Map(),
    },
  );
  return component.render(options.width ?? 200).join("\n");
}
```

In `tests/index-save.test.ts`, change the host signature from:

```ts
function deferredCustomHost() {
```

to:

```ts
function deferredCustomHost(theme: unknown = noTheme) {
```

Then change its existing factory call from:

```ts
const component = factory(tui, options?.onHandle ? noTheme : null, {}, done) as Component;
```

to:

```ts
const component = factory(tui, theme, {}, done) as Component;
```

Do not add a theme event bus or reinstallation callback. Pi owns invalidation; this test only proves that the existing render-time proxy reference stays live.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
pnpm exec vitest run tests/index-save.test.ts tests/index-surfaces.test.ts tests/tui/theme.test.ts tests/tui/dashboard.test.ts
```

Expected: PASS with no new skips. `tests/index-surfaces.test.ts` retains its narrower installed-surface and `NO_COLOR` coverage; do not duplicate those cases.

- [ ] **Step 5: Commit the integration proof when authorized**

```bash
git add tests/helpers.ts tests/index-save.test.ts
git commit -m "test: verify synchronized colour surfaces"
```

Skip this step when commits have not been authorized.

---

### Task 2: Document presets and complete release verification

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes the normalized `colors` configuration, the nine-entry Dashboard order, Pi render-time synchronization, Custom initialization, and `NO_COLOR` precedence proved by Task 1 and Phases 1-3.
- Produces the published configuration and behavior contract.

- [ ] **Step 1: Update the README**

Replace the Quick Start Settings-tab bullet with:

```markdown
- **Settings** — independently toggle Statusbar and Sidebar visibility, select their shared colour preset, and opt in to completion notifications.
```

In the configuration JSON example, add a comma after `"completionNotifications": false`, then add this canonical `colors` member:

```json
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
```

Add this `### Colours` subsection under Configuration Behavior:

```markdown
### Colours

Pi is the default colour preset. It resolves Pi's active theme on every Dashboard, Statusbar, and Sidebar render, so changing Pi's theme updates all three surfaces without changing pi-status configuration.

The Dashboard order is Pi, Atelier, Catppuccin Mocha, Catppuccin Latte, Dracula, Dracula Alucard, Tokyo Night Moon, Tokyo Night Day, and Custom. Catppuccin Mocha/Latte, Dracula/Alucard, and Tokyo Night Moon/Day are explicit dark/light choices; fixed presets do not switch automatically. Their local constants are attributed to the official [Catppuccin palette](https://github.com/catppuccin/palette/blob/main/palette.json), [Dracula palettes](https://github.com/dracula/dracula-theme#color-palette), and [TokyoNight sources](https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors).

The first switch to Custom copies the selected fixed palette; switching from Pi copies Atelier because Pi exposes live theme operations rather than stable hex values. Later preset switches preserve all 14 Custom roles. Custom accepts case-insensitive `#rrggbb`, persists lowercase values, and requires truecolour terminal support.

`NO_COLOR` disables styling across Dashboard, Statusbar, and Sidebar without changing the saved preset.
```

Replace the existing sentence that says `NO_COLOR` affects only the footer and `/statusline` with the three-surface wording above.

- [ ] **Step 2: Update the changelog**

Add above the released entries:

```markdown
## Unreleased

### Added

- Added Pi-synchronized, Atelier, Catppuccin, Dracula, Tokyo Night, and editable Custom colour presets to `/statusline`, shared by Dashboard, Statusbar, and Sidebar.
```

- [ ] **Step 3: Run documentation and focused verification**

```bash
pnpm format:check
pnpm exec vitest run \
  tests/core/config.test.ts \
  tests/tui/theme.test.ts \
  tests/tui/sidebar-palette.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/index-surfaces.test.ts \
  tests/index-save.test.ts
```

Expected: PASS with no new skips.

- [ ] **Step 4: Run full automated verification on Node.js `>=24.15.0`**

```bash
node --version
pnpm check
pnpm run pack:dry-run
```

Expected: Node meets the declared floor; formatting, lint, typecheck, all Vitest files, and package dry-run exit zero without an engine warning.

- [ ] **Step 5: Perform interactive acceptance**

Launch the local extension in Pi and open `/statusline` at approximately `120x30` and `80x24`:

1. A legacy config opens with Pi selected and Dashboard, Statusbar, and Sidebar match the active Pi theme.
2. Changing Pi's theme updates all three surfaces without reopening Dashboard or reinstalling either installed surface.
3. All nine labels cycle in the documented order with wraparound.
4. Each fixed dark/light preset previews and saves consistently across all surfaces.
5. First Custom entry clones the selected fixed palette, or Atelier from Pi; later switches preserve it.
6. Custom exposes 14 scrollable roles; uppercase, lowercase, and mixed-case input saves lowercase, invalid input remains open with one warning per submit, and Escape cancels.
7. Draft changes recolour Dashboard immediately while installed surfaces wait for confirmed Save.
8. Failed Save leaves installed colours unchanged and Dashboard dirty.
9. `NO_COLOR` removes ANSI styling without changing the saved preset.
10. Restarting Pi preserves the selected preset, initialization flag, and Custom values.

- [ ] **Step 6: Commit the completed feature when authorized**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document synchronized colour presets"
```

Skip this step when commits have not been authorized.
