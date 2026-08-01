# Statusline Dashboard Phase 1: Pi 0.83 Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Pi agent/TUI 0.83 development baseline from the current branch without changing footer, editor, dashboard, or subcommand behavior.

**Architecture:** Treat dependency commit `30f924b` as completed work, verify its committed lockfile without re-resolution, then update compatibility documentation. Keep runtime peers wildcarded and use the existing complete quality and package gates as the compatibility proof.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, `@earendil-works/pi-coding-agent@0.83.0`, `@earendil-works/pi-tui@0.83.0`, `@pi-vault/pi-usage@0.7.0`, Vitest 4, Biome 2, pnpm 11.

---

## Outcome and boundaries

**Usable result:** The shipped footer, inline `/statusline` editor, and `/statusline session|tools|notifications|preset` routes behave exactly as before while compiling, testing, and packaging against Pi 0.83.

**Immutable references:**

- Phase base: `2ff9482`
- Completed dependency commit: `30f924b`

**Product files changed from the phase base:**

- `package.json` — already changed by `30f924b`
- `pnpm-lock.yaml` — already changed by `30f924b`
- `README.md` — remaining work
- `CHANGELOG.md` — remaining work

`docs/superpowers/**` contains planning metadata and is excluded from the product-file scope assertion. Do not modify `src/**`, `tests/**`, scripts, command behavior, config schema, or screenshots.

## Task 1: Validate the completed dependency step

**Files:**

- Verify: `package.json:38,52-60`
- Verify: `pnpm-lock.yaml`
- No file changes

- [ ] **Step 1: Confirm the immutable commits and clean starting state**

Run:

```bash
set -e
PHASE_BASE=2ff9482
DEPENDENCY_COMMIT=30f924b
git cat-file -e "$PHASE_BASE^{commit}"
git cat-file -e "$DEPENDENCY_COMMIT^{commit}"
git merge-base --is-ancestor "$PHASE_BASE" "$DEPENDENCY_COMMIT"
git merge-base --is-ancestor "$DEPENDENCY_COMMIT" HEAD
test -z "$(git status --short)"
printf 'PHASE_BASE=%s\nDEPENDENCY_COMMIT=%s\n' \
  "$(git rev-parse "$PHASE_BASE")" \
  "$(git rev-parse "$DEPENDENCY_COMMIT")"
```

Expected: every command exits 0, both full SHAs print, and the worktree is clean.

- [ ] **Step 2: Confirm the dependency commit changed only manifests**

Run:

```bash
set -e
actual=$(git diff-tree --no-commit-id --name-only -r 30f924b | sort)
expected=$(printf '%s\n' package.json pnpm-lock.yaml | sort)
test "$actual" = "$expected"
printf '%s\n' "$actual"
```

Expected:

```text
package.json
pnpm-lock.yaml
```

- [ ] **Step 3: Confirm the accepted manifest policy**

Run:

```bash
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(pkg.engines.node, ">=24.15.0");
assert.equal(pkg.dependencies["@pi-vault/pi-usage"], "^0.7.0");
assert.equal(pkg.devDependencies["@earendil-works/pi-coding-agent"], "^0.83.0");
assert.equal(pkg.devDependencies["@earendil-works/pi-tui"], "^0.83.0");
assert.equal(pkg.devDependencies["@types/node"], "^26.1.1");
assert.equal(pkg.peerDependencies["@earendil-works/pi-coding-agent"], "*");
assert.equal(pkg.peerDependencies["@earendil-works/pi-tui"], "*");
console.log("Manifest policy verified");
NODE
```

Expected: `Manifest policy verified`.

- [ ] **Step 4: Install only from the committed lockfile**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0 with no `package.json` or `pnpm-lock.yaml` changes.

- [ ] **Step 5: Confirm exact installed compatibility versions**

Run:

```bash
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const version = async (name) =>
  JSON.parse(await readFile(`node_modules/${name}/package.json`, "utf8")).version;
assert.equal(await version("@earendil-works/pi-coding-agent"), "0.83.0");
assert.equal(await version("@earendil-works/pi-tui"), "0.83.0");
assert.equal(await version("@pi-vault/pi-usage"), "0.7.0");
console.log("Pi 0.83 compatibility versions verified");
NODE
```

Expected: `Pi 0.83 compatibility versions verified`.

## Task 2: Record the tested compatibility baseline

**Files:**

- Modify: `README.md:309`
- Modify: `CHANGELOG.md:38`
- No source or test changes

- [ ] **Step 1: Update README's tested-host sentence**

In `README.md`, replace the current 0.82 sentence with exactly:

```markdown
- The tested Pi host baseline is now `@earendil-works/pi-coding-agent@0.83.0` and `@earendil-works/pi-tui@0.83.0`.
```

- [ ] **Step 2: Update the Unreleased compatibility entry**

In `CHANGELOG.md`, replace the current development-baseline bullet with exactly:

```markdown
- Set the development baseline to Pi agent 0.83.0 and TUI 0.83.0, refreshed `@types/node` to `^26.1.1`, and retained caret Pi development ranges and wildcard runtime peer ranges.
```

Historical release entries may retain older Pi versions.

- [ ] **Step 3: Verify the documentation diff**

Run:

```bash
set -e
rg -n "tested Pi host baseline|Set the development baseline" README.md CHANGELOG.md
git diff --check -- README.md CHANGELOG.md
test "$(git diff --name-only | sort)" = "$(printf '%s\n' CHANGELOG.md README.md | sort)"
```

Expected: the current README and Unreleased changelog statements report Pi 0.83.0; diff checking passes; only `README.md` and `CHANGELOG.md` are uncommitted.

- [ ] **Step 4: Commit the compatibility documentation**

Run:

```bash
git add README.md CHANGELOG.md
git commit -m "docs: record Pi 0.83 compatibility"
```

Expected: one commit containing only `README.md` and `CHANGELOG.md`.

## Task 3: Run the phase completion gate

**Files:**

- Verify: `package.json`
- Verify: `pnpm-lock.yaml`
- Verify: `README.md`
- Verify: `CHANGELOG.md`
- No file changes

- [ ] **Step 1: Verify Node and the frozen dependency graph**

Run:

```bash
set -e
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm install --frozen-lockfile
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const version = async (name) =>
  JSON.parse(await readFile(`node_modules/${name}/package.json`, "utf8")).version;
assert.equal(await version("@earendil-works/pi-coding-agent"), "0.83.0");
assert.equal(await version("@earendil-works/pi-tui"), "0.83.0");
assert.equal(await version("@pi-vault/pi-usage"), "0.7.0");
console.log("Frozen dependency graph verified");
NODE
```

Expected: Node 24.15.0 or newer and `Frozen dependency graph verified`.

- [ ] **Step 2: Run the complete shared quality and package gate**

Run:

```bash
pnpm check
pnpm run pack:dry-run
```

Expected: formatting, lint, typecheck, all 535 tests, package-content verification, and package dry-run pass.

- [ ] **Step 3: Verify current compatibility documentation**

Run:

```bash
set -e
rg -n 'tested Pi host baseline.*pi-coding-agent@0\.83\.0.*pi-tui@0\.83\.0' README.md
rg -n 'Set the development baseline to Pi agent 0\.83\.0 and TUI 0\.83\.0.*@types/node.*\^26\.1\.1.*wildcard runtime peer ranges' CHANGELOG.md
```

Expected: each command prints exactly one current compatibility statement. Historical changelog entries are not part of this check.

- [ ] **Step 4: Verify the final phase scope**

Run:

```bash
set -e
PHASE_BASE=2ff9482
git diff --check "$PHASE_BASE"..HEAD
actual=$(git diff --name-only "$PHASE_BASE"..HEAD | awk '!/^docs\/superpowers\//' | sort)
expected=$(printf '%s\n' CHANGELOG.md README.md package.json pnpm-lock.yaml | sort)
test "$actual" = "$expected"
test -z "$(git diff --name-only "$PHASE_BASE"..HEAD -- src tests scripts docs/assets)"
printf '%s\n' "$actual"
```

Expected:

```text
CHANGELOG.md
README.md
package.json
pnpm-lock.yaml
```

No source, test, script, screenshot, command, or config-schema files changed.

- [ ] **Step 5: Confirm cleanliness and review the phase commits**

Run:

```bash
set -e
test -z "$(git status --short)"
git log --oneline 2ff9482..HEAD
git status --short --branch
```

Expected: the dependency commit, planning commits, and compatibility-documentation commit are present; the worktree is clean.

## Completion gate

Phase 1 is complete only when the frozen lockfile installs Pi agent 0.83.0, Pi TUI 0.83.0, and pi-usage 0.7.0; the accepted Node-types range and wildcard runtime peers remain documented in the manifest; all existing behavior and package gates pass; current compatibility docs report 0.83.0; and no source behavior changed. Phase 2 may then port the responsive overlay shell primitives.
