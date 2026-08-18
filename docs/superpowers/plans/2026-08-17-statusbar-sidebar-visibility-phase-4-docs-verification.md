# Phase 4: Documentation and Final Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the independent surface settings and verify the complete implementation, package contents, and repository scope.

**Architecture:** Update only the existing README after the config, dashboard, and runtime phases are green. Run focused tests first, then the repository quality/package checks, and finally inspect the diff against the approved spec.

**Tech Stack:** Markdown, pnpm, Biome, TypeScript, Vitest, and the existing package dry-run script.

**Spec:** `docs/superpowers/specs/2026-08-17-statusbar-sidebar-visibility-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility.md` (read-only; do not modify).

**Prerequisites:** Phases 1–3 have passed their acceptance checks and all requested production/test behavior is implemented.

## Global Constraints

- Document exact field names `statusbarEnabled` and `sidebarEnabled`.
- State that both fields default to `true` and only literal JSON `false` disables a surface.
- State that disabling Statusbar restores Pi's built-in footer via `ctx.ui.setFooter(undefined)`.
- State that disabling Sidebar hides the live Sidebar but keeps `/statusline` and its controller lifecycle available.
- Do not change existing Sidebar panel, segment, notification, or installation documentation beyond the requested settings clarification.
- Do not modify `/Users/lanh/Developer/pi-packages/pi`.
- Do not commit changes unless the user separately requests a commit.

---

## Phase boundary and usable result

This phase is complete when README instructions match the persisted schema and runtime matrix, the full quality suite passes, the package dry-run succeeds, and the final diff contains only the approved pi-status files.

## File map

- Modify: `README.md` — Settings behavior, canonical JSON, compatibility, and four outcomes.
- Read-only: `docs/superpowers/specs/2026-08-17-statusbar-sidebar-visibility-design.md`.
- Read-only: `docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility.md`.
- Read-only: phase 1–3 implementation changes and tests.

---

### Task 1: Update user-facing settings documentation

**Interfaces:**

- Consumes: `PiStatusConfig` schema, Settings row copy, runtime matrix, and README's existing Configuration Behavior, Quick Start, Sidebar, and Completion Notifications sections.
- Produces: Documentation that tells users how to disable either surface and what remains available.

- [ ] **Step 1: Update the Quick Start Settings description**

Change the Settings tab bullet from completion notifications only to independent Statusbar and Sidebar visibility plus completion notifications. State that `/statusline` remains available even if both surfaces are disabled.

- [ ] **Step 2: Add both fields to the canonical JSON example**

The documented `statusline.json` example must contain:

```json
{
  "statusbarEnabled": true,
  "sidebarEnabled": true,
  "zones": {
    "topLeft": ["model-with-reasoning"],
    "topRight": [],
    "bottomLeft": ["current-dir"],
    "bottomRight": []
  },
  "extensionSegments": { "hidden": [] },
  "completionNotifications": false
}
```

Keep the example's existing layout values and add the two fields at the top level.

- [ ] **Step 3: Document backward compatibility**

In the Configuration Behavior section, add explicit statements:

- Both fields default to `true`.
- Only literal JSON `false` disables a surface.
- Missing and invalid values remain enabled for older or hand-edited files.
- The next successful `/statusline` save writes canonical booleans.

- [ ] **Step 4: Document the runtime outcomes**

Add concise user-facing behavior:

- Statusbar enabled installs the pi-status custom footer.
- Statusbar disabled restores Pi's built-in footer rather than leaving a blank footer.
- Sidebar enabled shows the existing right-edge Sidebar.
- Sidebar disabled hides only that Sidebar; `/statusline`, panel discovery, and re-enabling remain available.
- The two choices are independent and apply after Save and on the next session start.

Do not rewrite the existing detailed Sidebar or Completion Notifications sections.

### Task 2: Run focused verification

**Interfaces:**

- Consumes: All implementation and test files from phases 1–3.
- Produces: Fresh evidence that focused behavior and integration tests pass.

- [ ] **Step 1: Run the focused suite**

Run:

```bash
pnpm exec vitest run \
  tests/core/config.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/index.test.ts \
  tests/index-save.test.ts \
  tests/index-surfaces.test.ts
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 2: Run repository quality checks**

Run:

```bash
pnpm check
```

Expected: Biome format check, lint, TypeScript typecheck, and the complete Vitest suite all exit successfully.

- [ ] **Step 3: Run package verification**

Run:

```bash
pnpm run pack:dry-run
```

Expected: package preparation succeeds and includes the intended source, README, license, changelog, and asset paths without adding unrelated files.

### Task 3: Review repository scope and final diff

- [ ] **Step 1: Verify the working tree and host repo**

Run in `pi-status`:

```bash
git status --short --branch
```

Run in the host repo:

```bash
git -C /Users/lanh/Developer/pi-packages/pi status --short --branch
```

Expected: the host repo remains clean; only requested pi-status changes are present.

- [ ] **Step 2: Inspect the final change list**

Run:

```bash
git diff --stat
git diff -- README.md src/shared/types.ts src/core/config.ts \
  src/tui/dashboard-state.ts src/tui/dashboard-render.ts src/index.ts
```

Also inspect untracked phase/document files with:

```bash
find docs/superpowers/plans -maxdepth 1 -type f -name \
  '2026-08-17-statusbar-sidebar-visibility*' -print | sort
```

Expected: the existing parent plan remains unchanged; four phase plans exist; implementation changes are limited to the config, dashboard, runtime, test, and README scope approved in the spec.

- [ ] **Step 3: Confirm no host-repo or dependency changes**

Check that no package manifest, lockfile, or host-repo file changed. Do not commit until the user requests integration.

## Phase acceptance checklist

- [ ] README contains both canonical fields and exact defaults.
- [ ] README explains literal-false compatibility behavior.
- [ ] README explains built-in-footer restoration and Sidebar hiding.
- [ ] Focused tests pass.
- [ ] `pnpm check` passes.
- [ ] `pnpm run pack:dry-run` passes.
- [ ] Host repo is unchanged.
- [ ] Existing parent plan remains unchanged.
- [ ] Four phase-plan files exist beside the parent.
