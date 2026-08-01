# Statusline Dashboard Phase 1 Current-Head Replan

## Purpose

Revise the Pi 0.83 baseline plan so it can be executed from the current branch without rewriting history. Phase 1 remains compatibility and documentation work only; it does not introduce dashboard behavior.

## Readiness findings

The existing plan is not executable as written:

1. It assumes the branch starts with Pi 0.82 development packages, but commit `30f924b` already updates the agent and TUI packages to 0.83.0.
2. That commit also updates the `@types/node` development range from `^26.1.0` to `^26.1.1`. This replan accepts that change as part of the phase.
3. README and the Unreleased changelog still identify Pi 0.82 as the tested baseline.
4. The original `pnpm install` step can re-resolve caret ranges. Verification from the committed lockfile must use `pnpm install --frozen-lockfile`.

The compatibility evidence is otherwise green. A clean worktree at phase base `2ff9482` passes `pnpm check` with 24 test files and 535 tests against agent 0.82.0 and TUI 0.82.1. Current commit `30f924b` passes the same gate, package verification, and package dry-run against agent 0.83.0 and TUI 0.83.0.

## Reference decisions

- `pi-usage` 0.7.0 uses caret development ranges and wildcard runtime peers for the Pi agent and TUI packages. Phase 1 retains that convention.
- Pi tag `v0.83.0` declares both `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` at 0.83.0. The current Pi `main` branch is newer than the tag, so the release tag is the compatibility reference for this phase.
- Pi 0.83 requires Node 22.19.0 or newer. pi-status keeps its stricter existing Node 24.15.0 requirement.
- The pi-status lockfile resolves `@pi-vault/pi-usage@0.7.0` against the installed Pi 0.83 packages, and the complete suite passes with that resolution.

## Revised scope

Use these immutable references:

- Phase base: `2ff9482`
- Completed dependency commit: `30f924b`

Accept the three development-range changes already present in `30f924b`:

- `@earendil-works/pi-coding-agent`: `^0.83.0`
- `@earendil-works/pi-tui`: `^0.83.0`
- `@types/node`: `^26.1.1`

Keep the Pi runtime peer ranges as `"*"`. Do not change the Node engine, production dependencies, source, tests, commands, configuration schema, screenshots, or dashboard behavior.

The only remaining product edits are the tested-baseline sentence in `README.md` and the Unreleased compatibility entry in `CHANGELOG.md`. Planning documents created by this replan are metadata and are reviewed separately from the product-file scope.

## Execution and commits

Treat `30f924b` as the completed dependency task rather than attempting to replay it. From the current clean worktree:

1. Verify the immutable references and current manifest values.
2. Run a frozen install and verify exact installed versions for the Pi agent, Pi TUI, and pi-usage.
3. Update README's tested-host sentence to agent and TUI 0.83.0. Update the Unreleased compatibility entry to record the Pi 0.83 caret ranges, wildcard runtime peers, and the accepted `@types/node ^26.1.1` development-range refresh.
4. Commit those two product documentation changes once.
5. Run the complete phase gate and review the final diff from `2ff9482`.

Do not rewrite existing history or add a host-load smoke test. The dependency-only change is already exercised by the full typecheck, behavior suite, and package gate.

## Failure handling

Every verification command must stop on failure. If type checking, tests, or packaging fail against the frozen 0.83 lockfile, Phase 1 stops and must be re-scoped before any `src/**` or `tests/**` changes are made. An implementation worker must not hide a compatibility failure inside this baseline phase.

## Verification

The revised plan must require:

1. Node 24.15.0 or newer.
2. `pnpm install --frozen-lockfile`.
3. Exact installed versions: agent 0.83.0, TUI 0.83.0, and pi-usage 0.7.0.
4. Manifest checks for caret Pi development ranges, wildcard Pi peers, `@types/node ^26.1.1`, and the unchanged Node engine.
5. `pnpm check` and `pnpm run pack:dry-run`.
6. Documentation checks proving current compatibility statements use 0.83.0 while historical changelog entries may retain older versions.
7. `git diff --check` from `2ff9482`.
8. A scope check proving that, apart from `docs/superpowers/**` planning metadata, only `package.json`, `pnpm-lock.yaml`, `README.md`, and `CHANGELOG.md` changed.
9. A clean worktree after the documentation commit.

## Non-goals

- No dashboard, overlay, sidebar, footer, editor, or command behavior changes.
- No source or test changes.
- No dependency pinning beyond the committed lockfile.
- No peer-range narrowing.
- No commit-history rewrite.
- No new compatibility abstraction or smoke-test harness.
