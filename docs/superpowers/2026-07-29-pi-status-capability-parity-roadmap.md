# pi-status Capability Parity Roadmap

## Summary

Evolve `pi-status` toward Atelier’s useful capabilities while retaining its configurable, footer-first identity.

Current assessment:

| Area                                              | pi-status                                 |
| ------------------------------------------------- | ----------------------------------------- |
| Configurable footer segments and editor           | **Strong advantage**                      |
| Usage-window reporting and Pi theme integration   | **Advantage**                             |
| Responsive layout and runtime telemetry           | **Partial**                               |
| Workspace state, notifications, controls, presets | **Missing**                               |
| Docked sidebar                                    | **Missing, required**                     |
| CI and linting                                    | **Advantage**, with Node-version mismatch |
| Runtime/config compatibility                      | **Needs correction**                      |
| Complexity                                        | **Leaner than Atelier**                   |

The sidebar will be opt-in, docked through an isolated private-API adapter, and disabled safely if Pi internals are incompatible.

## Key Changes

### 1. Record the approved audit and design

Create:

- `docs/superpowers/specs/<date>-atelier-capability-parity-design.md`
- `docs/atelier-capability-audit.md`

Document each capability as Have, Partial, or Missing, with evidence paths and a pi-status advantage, Atelier advantage, or tradeoff verdict. Include the approved architecture and explicit sidebar compatibility risk.

Self-review both documents for placeholders, contradictions, ambiguous requirements, and unsupported marketing claims before committing them.

### 2. Priority 0 — Correctness and compatibility

Update:

- `src/index.ts`
- `src/core/config.ts`
- `src/core/runtime-state.ts`
- Relevant lifecycle and configuration tests
- `.github/workflows/quality.yml`
- `.github/workflows/release.yml`
- `package.json`

Changes:

- Use `ctx.mode === "tui"` for custom TUI behavior.
- Initialize reasoning level from Pi state.
- Resolve configuration through `getAgentDir` and `CONFIG_DIR_NAME`.
- Ignore untrusted project configuration.
- Align CI with the declared Node `>=24.15.0` baseline.
- Add formatting checks and explicit tarball-content verification.
- Remove duplicated formatter compatibility code and redundant tests only after confirming no runtime callers.

Complete this priority before adding features.

### 3. Priority 1 — Responsive footer and richer telemetry

Update the shared runtime snapshot in:

- `src/shared/types.ts`
- `src/core/runtime-state.ts`
- `src/core/resolve-footer.ts`
- `src/tui/formatters.ts`
- `src/tui/render-utils.ts`
- `src/tui/render.ts`

Add:

- Segment drop priorities with final truncation as a fallback.
- Live run/activity state.
- Cache read/write/hit, cost, subscription, and richer context metrics.
- Explicit no-color rendering.
- Preservation of user ordering and extension-status filtering.

Do not copy Atelier’s unused responsive-mode abstraction.

### 4. Priority 2 — Opt-in docked sidebar

Create focused modules:

- `src/tui/split-pane.ts` — private renderer integration only.
- `src/tui/sidebar.ts` — pure sidebar layout and rendering.
- `src/core/sidebar-runtime.ts` — sidebar configuration and interaction state.

Integrate through `src/index.ts`.

Requirements:

- Default disabled.
- Toggle and adjustable width.
- Display model/session, activity and timing, context/usage, token/cost, and recent-tool details.
- Feature-detect required Pi internals before patching.
- Preserve and restore the original renderer exactly once.
- On installation or rendering failure, restore Pi, disable the sidebar for that session, issue one warning, and keep the footer running.
- Keep host adaptation, interaction, and rendering separate rather than creating an Atelier-sized sidebar module.

### 5. Priority 3 — Workspace and notifications

Create:

- `src/core/workspace-pulse.ts`
- `src/core/completion-notifier.ts`

Workspace Pulse:

- Run bounded, read-only Git commands.
- Represent clean, dirty, conflicted, not-repository, unavailable, and stale states.
- Discard stale asynchronous results with generation tokens.
- Supply both footer segments and sidebar details.

Notifications:

- Handle settled and explicitly blocked states.
- Support macOS and Windows through native commands.
- Remain independently configurable and nonfatal.

### 6. Priority 4 — Controls and presets

Create only the minimum modules needed for:

- Model and thinking controls.
- Tool controls.
- Session rename and compact actions.
- Complete, named presets.

Reuse Pi’s public APIs and existing TUI components. Do not introduce a parallel command framework or speculative preset system.

### 7. Plan and deliver each priority independently

After the design documents are approved, create a separate detailed implementation plan for each priority. Each priority must leave the extension usable and independently releasable.

Implementation order is fixed: Priority 0 → 1 → 2 → 3 → 4.

## Test Plan

For each priority:

1. Add focused failing tests before implementation.
2. Run the narrow affected test file during development.
3. Run the complete verification suite:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm check`
   - Package-content verification
4. Test footer rendering across narrow, medium, and wide terminal widths.
5. Test TUI, RPC, untrusted-project, session-switch, and shutdown behavior.
6. Test sidebar installation, resizing, restoration, incompatible-host fallback, and repeated cleanup.
7. Test stale Workspace Pulse results and nonfatal notification failures.
8. Verify package contents and workflows under Node `24.15.0` or newer.

## Assumptions

- Capability parity means equivalent useful outcomes, not copying Atelier’s visual design or internal structure.
- The docked sidebar is required despite relying on undocumented Pi internals.
- The sidebar remains opt-in and fails closed without affecting the footer.
- Existing segment configuration and usage-window reporting remain stable.
- Atelier’s renderer monkeypatch, disabled lint rules, missing CI, and unused responsive API will not be copied.
- Plan Mode currently prevents writing or committing the approved design documents; those are the first artifacts created after implementation mode begins.
