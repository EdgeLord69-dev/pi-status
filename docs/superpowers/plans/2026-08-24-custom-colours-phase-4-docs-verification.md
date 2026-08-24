# Phase 4: End-to-End Verification and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove save/runtime boundaries, document every colour preset and override, and complete release-level verification.

**Architecture:** Add end-to-end coverage on top of the completed config, renderer, and Dashboard phases. Update only the existing README and changelog, then run focused, full, package, and interactive acceptance checks.

**Tech Stack:** Markdown, pnpm, Biome, TypeScript 6, Vitest 4, and the package dry-run script.

**Spec:** `docs/superpowers/specs/2026-08-24-custom-colours-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-24-custom-colours.md` (read-only; do not modify).

**Prerequisite:** Phases 1–3 are complete and their focused gates pass.

## Global Constraints

- Modify only `/Users/lanh/Developer/pi-vault/pi-status`; Pi and Atelier repositories are read-only references.
- Add no dependency, runtime palette fetch, graphical picker, CSS parser, import/export, or Pi global-theme mutation.
- Use `Pi` (`pi`) as the default preset. `NO_COLOR` is an environment override, never a preset.
- Persist only uppercase `#RRGGBB` Custom values and retain exactly 14 editable semantic roles.
- Fixed and Custom presets emit truecolour; do not add a 256-colour conversion path.
- Dashboard uses draft colours; installed surfaces change only after persistence succeeds.
- Preserve malformed-file overwrite refusal and renderer plain-text fallbacks.
- Follow RED/GREEN/REFACTOR with focused tests before each production change.
- Do not create commits unless the user authorizes them; when authorized, use the commit checkpoints in this plan.

---

## Phase boundary and usable result

This phase is complete when successful and failed Save behavior, live Pi synchronization, documentation, focused tests, `pnpm check`, package dry-run, and the ten-item interactive acceptance matrix all pass. The result is a documented, release-ready feature.

## File map

- Modify: `tests/index-save.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

---

### Task 1: Verify save boundaries and document the feature

**Files:**

- Modify: `tests/index-save.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes the normalized config, theme resolver, and Dashboard behavior from Phases 1–3.
- Produces end-to-end proof that drafts remain isolated until Save and user-facing documentation for every preset and override.

- [ ] **Step 1: Add the end-to-end save-boundary tests**

In `tests/index-save.test.ts`, open Dashboard with Atelier committed, change draft Accent to `#010203`, and render Dashboard plus separately installed Footer and Sidebar before Save:

```ts
expect(renderDashboard()).toContain("38;2;1;2;3m");
expect(renderFooter()).not.toContain("38;2;1;2;3m");
expect(renderSidebar()).not.toContain("38;2;1;2;3m");
```

Confirm Save and assert:

```ts
expect(renderFooter()).toContain("38;2;1;2;3m");
expect(renderSidebar()).toContain("38;2;1;2;3m");
expect(isDashboardDirty(component.getState())).toBe(false);
```

Add a failed-save case using the existing throwing `saveConfig` seam:

```ts
saveConfig.mockImplementation(() => {
  throw new Error("disk full");
});
saveSettings(component);
expect(isDashboardDirty(component.getState())).toBe(true);
expect(renderFooter()).toContain("38;2;177;140;255m");
expect(renderSidebar()).toContain("38;2;177;140;255m");
expect(renderFooter()).not.toContain("38;2;1;2;3m");
```

Add a Pi case that mutates the fake live theme without changing config:

```ts
expect(renderDashboard()).toContain("pi:first");
expect(renderFooter()).toContain("pi:first");
expect(renderSidebar()).toContain("pi:first");
piThemePrefix = "pi:second";
expect(renderDashboard()).toContain("pi:second");
expect(renderFooter()).toContain("pi:second");
expect(renderSidebar()).toContain("pi:second");
```

- [ ] **Step 2: Run the integration test**

```bash
pnpm exec vitest run tests/index-save.test.ts
```

Expected: PASS. Any draft RGB sequence in an installed pre-save surface is a render-boundary defect and must be fixed before continuing.

- [ ] **Step 3: Update README and changelog**

In `README.md`:

- Add Colours to the Settings-tab description.
- Add the canonical default `colors` object to the configuration example.
- State that Pi is the default and follows Pi theme changes.
- List all nine labels in Dashboard order.
- Group Catppuccin Mocha/Latte, Dracula/Alucard, and Tokyo Night Moon/Day as explicit dark/light choices.
- Link the three official palette sources used by the local constants.
- Document first-use Custom seeding, 14 `#RRGGBB` roles, uppercase persistence, and truecolour requirements.
- State that `NO_COLOR` disables styling across Dashboard, Statusbar, and Sidebar without changing the saved selection.

In `CHANGELOG.md`, add above released entries:

```markdown
## Unreleased

### Added

- Added Pi-synchronized, Atelier, Catppuccin, Dracula, Tokyo Night, and editable Custom colour presets to `/statusline`, shared by Dashboard, Statusbar, and Sidebar.
```

- [ ] **Step 4: Run focused suites**

```bash
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

- [ ] **Step 5: Run full automated verification**

```bash
pnpm check
pnpm run pack:dry-run
```

Expected: formatting, lint, typecheck, full Vitest suite, and package dry run all exit zero.

- [ ] **Step 6: Perform interactive acceptance**

Launch the local extension in Pi and open `/statusline` at approximately `120x30` and `80x24`:

1. A legacy config opens with Pi selected and all three surfaces match the active Pi theme.
2. Changing Pi's theme updates all three surfaces without reopening Dashboard.
3. All nine labels cycle in the documented order with wraparound.
4. Each fixed dark/light preset previews and saves consistently across all surfaces.
5. First Custom entry clones the selected fixed palette, or Atelier from Pi; later switches preserve it.
6. Custom exposes 14 scrollable roles; lowercase input saves uppercase, invalid input remains open with one warning per submit, and Escape cancels.
7. Draft changes recolour Dashboard immediately while installed surfaces wait for confirmed Save.
8. Failed Save leaves installed colours unchanged and Dashboard dirty.
9. `NO_COLOR` removes ANSI styling without changing the saved preset.
10. Restarting Pi preserves the selected preset, initialization flag, and Custom values.

- [ ] **Step 7: Commit the completed feature when authorized**

```bash
git add README.md CHANGELOG.md tests/index-save.test.ts
git commit -m "docs: document custom colour presets"
```

Skip this step when commits have not been authorized.
