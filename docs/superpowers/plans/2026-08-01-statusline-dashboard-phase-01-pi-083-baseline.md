# Statusline Dashboard Phase 1: Pi 0.83 Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move pi-status to the Pi agent/TUI 0.83 development baseline without changing current footer, editor, or subcommand behavior.

**Architecture:** This phase is dependency and compatibility work only. Keep runtime peers wildcarded, let the lockfile resolve the 0.83 packages, and prove the existing extension passes its complete behavior and package gates before dashboard code is introduced.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, `@earendil-works/pi-coding-agent@0.83.0`, `@earendil-works/pi-tui@0.83.0`, Vitest 4, Biome 2, pnpm 11.

---

## Outcome and boundaries

**Usable result:** The currently shipped footer, inline `/statusline` editor, and `/statusline session|tools|notifications|preset` routes behave exactly as before while compiling and testing against Pi 0.83.

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Do not modify: `src/**`, `tests/**`, command behavior, config schema, or screenshots

## Task 1: Record the baseline

- [ ] **Step 1: Record the phase base and current versions**

```bash
PHASE_BASE=$(git rev-parse HEAD)
test -z "$(git status --short)"
node --version
node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"
node -p "require('./node_modules/@earendil-works/pi-tui/package.json').version"
printf 'PHASE_BASE=%s\n' "$PHASE_BASE"
```

Expected: clean worktree, Node 24.15.0 or newer, coding-agent 0.82.0, TUI 0.82.1, and one full base SHA.

- [ ] **Step 2: Prove the pre-upgrade suite is green**

```bash
pnpm check
```

Expected: formatting, lint, typecheck, all tests, and package verification pass before dependency changes.

## Task 2: Upgrade only the Pi development baseline

- [ ] **Step 1: Change the two development ranges**

In `package.json`, replace only these entries:

```json
{
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "^0.83.0",
    "@earendil-works/pi-tui": "^0.83.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  }
}
```

Do not change `@pi-vault/pi-usage`, Node, TypeScript, Vitest, Biome, or peer ranges.

- [ ] **Step 2: Refresh and inspect the lockfile**

```bash
pnpm install
pnpm list @earendil-works/pi-coding-agent @earendil-works/pi-tui --depth 0
node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"
node -p "require('./node_modules/@earendil-works/pi-tui/package.json').version"
```

Expected: both direct development packages report 0.83.0; `package.json` peer ranges remain `"*"`; the lockfile re-resolves `@pi-vault/pi-usage@0.7.0` against the 0.83 host packages.

- [ ] **Step 3: Run compatibility checks before committing**

```bash
pnpm typecheck
pnpm test
pnpm pack:verify
git diff --check -- package.json pnpm-lock.yaml
```

Expected: every command exits 0 with no production or test source edits.

- [ ] **Step 4: Commit the dependency baseline**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: update Pi development baseline to 0.83"
```

## Task 3: Update compatibility documentation

- [ ] **Step 1: Update README's tested baseline**

In `README.md`, replace the existing baseline sentence with:

```markdown
- The tested Pi host baseline is now `@earendil-works/pi-coding-agent@0.83.0` and `@earendil-works/pi-tui@0.83.0`.
```

Do not describe the dashboard yet; current commands remain shipped in this phase.

- [ ] **Step 2: Update the Unreleased compatibility entry**

In `CHANGELOG.md`, replace the current Pi compatibility bullet with:

```markdown
- Set the development baseline to Pi agent 0.83.0 and TUI 0.83.0 while retaining caret development ranges and wildcard runtime peer ranges.
```

- [ ] **Step 3: Verify and commit documentation**

```bash
rg -n "0\.83\.0|0\.82\.0|0\.82\.1" README.md CHANGELOG.md package.json
git diff --check -- README.md CHANGELOG.md
git add README.md CHANGELOG.md
git commit -m "docs: record Pi 0.83 compatibility"
```

Expected: current baseline claims use 0.83.0; historical changelog entries may retain old versions.

## Task 4: Phase completion gate

- [ ] **Step 1: Run the full shared gate**

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
git diff --check "$PHASE_BASE"..HEAD
```

Expected: all commands pass; the existing UI and command tests remain green on Pi 0.83.

- [ ] **Step 2: Review scope and cleanliness**

```bash
git diff --name-only "$PHASE_BASE"..HEAD
git status --short
git log --oneline -2
```

Expected: only `package.json`, `pnpm-lock.yaml`, `README.md`, and `CHANGELOG.md` changed; the worktree is clean; no dashboard or sidebar source exists yet.

## Completion gate

Phase 1 is complete only when both installed development packages are 0.83.0, wildcard peers and Node requirements are unchanged, every pre-existing behavior test and package gate passes, and no source behavior changed. Phase 2 may then port the overlay shell primitives.
