# Pi Status Phase 4 Session Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/statusline session`, showing current-session details and offering session rename and explicitly confirmed compaction through Pi's public APIs.

**Architecture:** Introduce one small `src/tui/command-router.ts` that preserves the empty command as the existing editor and adds a `session` route. Keep session behavior in focused `src/tui/session-actions.ts`; use Pi's native `select`, `input`, and `confirm` methods, rename through `pi.setSessionName()`, and trigger fire-and-forget `ctx.compact()` callbacks without adding configuration or persistence. Catch synchronous host/UI failures at the action boundary and report callback failures through native notifications.

**Tech Stack:** TypeScript 6, Pi extension API `@earendil-works/pi-coding-agent@0.82.0`, Vitest 4, Biome, pnpm.

---

## Usable Result

In interactive Pi, `/statusline session` opens a compact action menu whose title shows the current session name, ID, file, working directory, and model. The user can rename that Pi session or request compaction; compaction runs only after an affirmative confirmation. Plain `/statusline` still opens the existing footer editor exactly as before.

## Dependencies and Assumptions

- Phases 1–3 are complete and green. Phase 1 established `ctx.mode === "tui"` as the custom-TUI guard.
- Pi already owns model selection and thinking-level controls, so this phase does not duplicate them. The new router recognizes only the empty editor command, `session`, and unknown input; later phases extend the same union and parser.
- The command handler receives `ExtensionCommandContext`. `ctx.compact()` is fire-and-forget and must not be awaited.
- Pi's public action methods can throw when the extension runtime is inactive; metadata lookup, prompts, rename, and compaction initiation must become warning notifications rather than uncaught command failures.
- Pi owns session-name persistence via session entries. “Session-scoped” means this phase must not add a pi-status setting, file, cache, or cross-session default.
- `pi.getSessionName()` may return `undefined`, `ctx.sessionManager.getSessionFile()` may be `undefined`, and `ctx.model` may be absent. Render explicit fallback text rather than throwing. When a model exists, display `${provider}/${id}` so model IDs are unambiguous.
- Pi invalidates its footer after `compaction_end`; do not add a `session_compact` listener or a second push-based runtime for this pull-based footer.

## Explicit Non-Goals

- No sidebar, split pane, private renderer, or Priority 2 work.
- No session creation, switching, forking, tree navigation, reload, export, or deletion.
- No custom compaction instructions, automatic compaction, progress overlay, or cancellation mechanism.
- No session-name or compaction preference in `PiStatusConfig` or either `settings.json`.
- No generic command framework and no redesign of the no-argument editor.

## Official Pi API References

Use the supplied Pi 0.82.0 repository as implementation authority:

- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/src/core/extensions/types.ts` — `ExtensionContext`, `ExtensionCommandContext`, `mode`, `compact`, and session-name APIs.
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/src/core/session-manager.ts` — public read-only session getters.
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/docs/extensions.md` — command context, compaction callbacks, session naming, and mode behavior.
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/examples/extensions/session-name.ts` — official rename flow.
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/examples/extensions/trigger-compact.ts` — official fire-and-forget compaction flow.
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/examples/extensions/confirm-destructive.ts` — official destructive-action confirmation flow.

Reference symbols and paths, not generated declaration line numbers.

## File Map

**Create:**

- `src/tui/session-actions.ts` — session detail formatting and native rename/compact action flow.
- `tests/tui/session-actions.test.ts` — focused behavior tests for details, rename, confirmation, callbacks, and non-TUI rejection.
- `src/tui/command-router.ts` — parse the existing empty editor command, `session`, and unknown input.
- `tests/tui/command-router.test.ts` — prove exact and whitespace-normalized session routing while preserving the empty route.

**Modify:**

- `src/index.ts` — wire the parsed `session` route to `handleSessionActions(pi, ctx)`.
- `tests/helpers.ts` — add controllable session-name getters/setters and session-file support to the existing Pi/context mocks.
- `tests/index.test.ts` — prove `/statusline session` is wired and plain `/statusline` still opens the editor.
- `README.md` — document the command, displayed details, rename, confirmation, and session-only ownership.
- `CHANGELOG.md` — add Phase 4 user-facing and internal entries under the current unreleased section; create `## Unreleased` if it is not present when implementation starts.

**Do not modify:** `src/shared/types.ts`, `src/core/config.ts`, `src/tui/editor.ts`, sidebar files, package dependencies, or settings schemas.

## Execution setup

- [ ] **Record the phase base before the first implementation commit:**

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 4 base: %s\n' "$PHASE_BASE"
```

Expected: one full commit SHA from the completed Phase 3 branch. Keep this shell variable for the final phase review.

### Task 1: Add the Session Action Module Test-First

**Files:**

- Create: `tests/tui/session-actions.test.ts`
- Create: `src/tui/session-actions.ts`

- [ ] **Step 1: Write focused failing tests for details and rename**

Create `tests/tui/session-actions.test.ts` with typed local mocks. The core assertions must be:

```ts
import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { handleSessionActions } from "../../src/tui/session-actions.ts";

function commandContext(overrides: Record<string, unknown> = {}) {
  return {
    mode: "tui",
    cwd: "/work/pi-status",
    model: { provider: "anthropic", id: "claude-sonnet-4" },
    sessionManager: {
      getSessionId: () => "session-123",
      getSessionFile: () => "/tmp/session-123.jsonl",
    },
    ui: {
      select: vi.fn(),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    },
    compact: vi.fn(),
    ...overrides,
  } as unknown as ExtensionCommandContext;
}

function extensionApi(overrides: Record<string, unknown> = {}) {
  return {
    getSessionName: vi.fn(() => "Original name"),
    setSessionName: vi.fn(),
    ...overrides,
  } as unknown as ExtensionAPI;
}

describe("handleSessionActions", () => {
  it("trims and applies a renamed session through Pi", async () => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockResolvedValue("Rename session");
    vi.mocked(ctx.ui.input).mockResolvedValue("  Release work  ");
    const pi = extensionApi();

    await handleSessionActions(pi, ctx);

    expect(pi.setSessionName).toHaveBeenCalledWith("Release work");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Session renamed to Release work",
      "info",
    );
  });

  it("does not rename on cancel or whitespace-only input", async () => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockResolvedValue("Rename session");
    vi.mocked(ctx.ui.input).mockResolvedValue("   ");
    const pi = extensionApi();

    await handleSessionActions(pi, ctx);

    expect(pi.setSessionName).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `pnpm vitest run tests/tui/session-actions.test.ts`

Expected: FAIL because `../../src/tui/session-actions.ts` does not exist.

- [ ] **Step 3: Add failing compact, callback, close, and non-TUI tests**

Append tests that select `"Compact session"` and assert:

```ts
it("compacts only after explicit confirmation", async () => {
  const compact = vi.fn();
  const ctx = commandContext({ compact });
  vi.mocked(ctx.ui.select).mockResolvedValue("Compact session");
  vi.mocked(ctx.ui.confirm).mockResolvedValue(true);

  await handleSessionActions(extensionApi(), ctx);

  expect(ctx.ui.confirm).toHaveBeenCalledWith(
    "Compact session?",
    "Pi will summarize older context for session session-123. Continue?",
  );
  expect(compact).toHaveBeenCalledOnce();
  const options = compact.mock.calls[0]?.[0] as {
    onComplete: () => void;
  };
  options.onComplete();
  expect(ctx.ui.notify).toHaveBeenCalledWith("Session compacted", "info");
});

it("reports a compaction callback failure without throwing", async () => {
  const compact = vi.fn();
  const ctx = commandContext({ compact });
  vi.mocked(ctx.ui.select).mockResolvedValue("Compact session");
  vi.mocked(ctx.ui.confirm).mockResolvedValue(true);

  await handleSessionActions(extensionApi(), ctx);

  const options = compact.mock.calls[0]?.[0] as {
    onError: (error: Error) => void;
  };
  options.onError(new Error("compact failed"));
  expect(ctx.ui.notify).toHaveBeenCalledWith("compact failed", "warning");
});

it("reports a synchronous compaction-start failure", async () => {
  const ctx = commandContext({
    compact: vi.fn(() => {
      throw new Error("compact unavailable");
    }),
  });
  vi.mocked(ctx.ui.select).mockResolvedValue("Compact session");
  vi.mocked(ctx.ui.confirm).mockResolvedValue(true);

  await handleSessionActions(extensionApi(), ctx);

  expect(ctx.ui.notify).toHaveBeenCalledWith(
    "Session action failed: compact unavailable",
    "warning",
  );
});

it("does not compact when confirmation is declined", async () => {
  const ctx = commandContext();
  vi.mocked(ctx.ui.select).mockResolvedValue("Compact session");
  vi.mocked(ctx.ui.confirm).mockResolvedValue(false);

  await handleSessionActions(extensionApi(), ctx);

  expect(ctx.compact).not.toHaveBeenCalled();
});

it("does nothing when the menu is closed", async () => {
  const ctx = commandContext();
  vi.mocked(ctx.ui.select).mockResolvedValue(undefined);
  const pi = extensionApi();

  await handleSessionActions(pi, ctx);

  expect(pi.setSessionName).not.toHaveBeenCalled();
  expect(ctx.compact).not.toHaveBeenCalled();
});

it("rejects RPC mode without opening native prompts", async () => {
  const ctx = commandContext({ mode: "rpc" });

  await handleSessionActions(extensionApi(), ctx);

  expect(ctx.ui.select).not.toHaveBeenCalled();
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    "/statusline session requires interactive TUI",
    "warning",
  );
});
```

- [ ] **Step 4: Implement the minimum public-API flow**

Create `src/tui/session-actions.ts` with this public surface and behavior:

```ts
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

function notifyIfActive(
  ctx: ExtensionCommandContext,
  message: string,
  type: "info" | "warning",
): void {
  try {
    ctx.ui.notify(message, type);
  } catch {
    // Deferred callbacks may outlive the command context after session replacement.
  }
}

export async function handleSessionActions(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/statusline session requires interactive TUI", "warning");
    return;
  }

  try {
    const id = ctx.sessionManager.getSessionId();
    const action = await ctx.ui.select(
      [
        "Session details",
        `Name: ${pi.getSessionName() ?? "Untitled"}`,
        `ID: ${id}`,
        `File: ${ctx.sessionManager.getSessionFile() ?? "In memory"}`,
        `Directory: ${ctx.cwd}`,
        `Model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "None"}`,
      ].join("\n"),
      ["Rename session", "Compact session", "Close"],
    );

    if (action === "Rename session") {
      const name = (
        await ctx.ui.input("Rename session", "Session name")
      )?.trim();
      if (!name) return;
      pi.setSessionName(name);
      ctx.ui.notify(`Session renamed to ${name}`, "info");
      return;
    }

    if (action !== "Compact session") return;
    const confirmed = await ctx.ui.confirm(
      "Compact session?",
      `Pi will summarize older context for session ${id}. Continue?`,
    );
    if (!confirmed) return;

    ctx.compact({
      onComplete: () => notifyIfActive(ctx, "Session compacted", "info"),
      onError: (error) => notifyIfActive(ctx, error.message, "warning"),
    });
  } catch (error) {
    ctx.ui.notify(
      `Session action failed: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
}
```

Do not add a loop, custom component, persistence callback, or `await` before `ctx.compact()`.

- [ ] **Step 5: Add the rename failure assertion**

Append this test where `setSessionName` throws `new Error("rename failed")`; expect the warning and no uncaught rejection:

```ts
it("reports a rename failure without throwing", async () => {
  const ctx = commandContext();
  vi.mocked(ctx.ui.select).mockResolvedValue("Rename session");
  vi.mocked(ctx.ui.input).mockResolvedValue("Release work");
  const pi = extensionApi({
    setSessionName: vi.fn(() => {
      throw new Error("rename failed");
    }),
  });

  await handleSessionActions(pi, ctx);

  expect(ctx.ui.notify).toHaveBeenCalledWith(
    "Session action failed: rename failed",
    "warning",
  );
});
```

- [ ] **Step 6: Run the narrow module test and verify green**

Run: `pnpm vitest run tests/tui/session-actions.test.ts`

Expected: PASS with all session-action tests green.

- [ ] **Step 7: Commit the focused module**

```bash
git add src/tui/session-actions.ts tests/tui/session-actions.test.ts
git commit -m "feat: add statusline session actions"
```

### Task 2: Route `/statusline session` Without Changing Plain `/statusline`

**Files:**

- Modify: `src/tui/command-router.ts`
- Modify: `tests/tui/command-router.test.ts`
- Modify: `src/index.ts:1-12,137-200`
- Modify: `tests/helpers.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add failing parser tests**

Create `tests/tui/command-router.test.ts` with the initial router contract:

```ts
it.each(["session", "  session  ", "SESSION"])(
  "routes %j to session actions",
  (args) => {
    expect(parseStatusLineCommand(args)).toEqual({ kind: "session" });
  },
);

it("keeps empty arguments routed to the existing editor", () => {
  expect(parseStatusLineCommand("   ")).toEqual({ kind: "editor" });
});

it("preserves an unsupported command for one warning boundary", () => {
  expect(parseStatusLineCommand("  Unknown  ")).toEqual({
    kind: "unknown",
    command: "Unknown",
  });
});
```

- [ ] **Step 2: Run the router test and verify red**

Run: `pnpm vitest run tests/tui/command-router.test.ts`

Expected: FAIL because `session` is not yet a recognized route.

- [ ] **Step 3: Implement the initial union and parser**

Create the complete initial contract:

```ts
export type StatusLineCommand =
  | { kind: "editor" }
  | { kind: "session" }
  | { kind: "unknown"; command: string };

export function parseStatusLineCommand(args: string): StatusLineCommand {
  const command = args.trim();
  if (!command) return { kind: "editor" };
  if (command.toLowerCase() === "session") return { kind: "session" };
  return { kind: "unknown", command };
}
```

Do not accept `sessions`, aliases, nested actions, or command-line rename text.

- [ ] **Step 4: Run the router test and verify green**

Run: `pnpm vitest run tests/tui/command-router.test.ts`

Expected: PASS for editor, session, whitespace normalization, and unknown input.

- [ ] **Step 5: Extend shared test helpers with public session methods**

In `tests/helpers.ts`, import `vi` from `vitest` and add defaults without replacing existing overrides:

```ts
getSessionName: vi.fn(() => undefined),
setSessionName: vi.fn(),
```

on the `ExtensionAPI` mock, and:

```ts
getSessionFile: vi.fn(() => undefined),
```

on the existing `sessionManager` mock. Keep the current `ui.select`, `ui.input`, `ui.confirm`, and `compact` seams.

- [ ] **Step 6: Add a failing registration/wiring test**

In `tests/index.test.ts`, obtain the registered `statusline` handler with the file's existing helper pattern, invoke `handler("session", ctx)`, and assert that a mocked `ctx.ui.select` receives a title containing both `Session details` and the helper's session ID. Also prove unknown routing and retain or add this regression assertion:

```ts
await handler("", ctx);
expect(ctx.ui.custom).toHaveBeenCalled();
```

The tests must separately prove that `handler("session", ctx)` does **not** call the footer configuration `ctx.ui.custom` editor, that `handler("unknown", ctx)` warns without opening either UI, and that an RPC session invocation reports `/statusline session requires interactive TUI`.

- [ ] **Step 7: Run the wiring test and verify red**

Run: `pnpm vitest run tests/index.test.ts -t "statusline session"`

Expected: FAIL because `src/index.ts` does not dispatch the session route yet.

- [ ] **Step 8: Wire the route in the existing command handler**

Import the parser and focused handler:

```ts
import { parseStatusLineCommand } from "./tui/command-router.ts";
import { handleSessionActions } from "./tui/session-actions.ts";
```

Parse once at the top of the registered handler. Route `editor` into the existing no-argument body unchanged, route `session` to the focused handler, and warn once for unknown input:

```ts
const command = parseStatusLineCommand(args);
if (command.kind === "session") {
  await handleSessionActions(pi, ctx);
  return;
}
if (command.kind === "unknown") {
  ctx.ui.notify(`Unknown /statusline command: ${command.command}`, "warning");
  return;
}
// Existing editor body follows unchanged.
```

Leave the editor branch's current empty-footer installation, `ctx.ui.custom`, `finally` restoration, save, and runtime update unchanged. The top-level handler must continue to use `ctx.mode === "tui"` for TUI-only routes, not `ctx.hasUI`.

- [ ] **Step 9: Run focused routing and wiring tests**

Run: `pnpm vitest run tests/tui/command-router.test.ts tests/tui/session-actions.test.ts tests/index.test.ts`

Expected: PASS; existing no-argument save/cancel/footer-restoration tests remain green.

- [ ] **Step 10: Commit routing and wiring**

```bash
git add src/tui/command-router.ts tests/tui/command-router.test.ts src/index.ts tests/helpers.ts tests/index.test.ts
git commit -m "feat: route statusline session command"
```

### Task 3: Document Session Actions

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add user-facing README copy**

Under **Quick Start**, add:

```markdown
- Run `/statusline session` to view the current session name, ID, file, directory, and model.
- From the session menu, rename the current session or compact it after an explicit confirmation.
```

Add a concise **Session Actions** section:

```markdown
## Session Actions

`/statusline session` uses Pi's current-session APIs. Renaming updates the current Pi session name, and compaction starts only after you confirm the prompt. These actions do not add pi-status settings or change the behavior of plain `/statusline`.
```

- [ ] **Step 2: Add changelog entries**

Under `## Unreleased` (create it immediately above `0.3.0` if absent), add:

```markdown
### Added

- Added `/statusline session` with current-session details, rename, and confirmed compaction actions.

### Internal

- Routed session actions through Pi's public command-context APIs without adding pi-status persistence.
```

If `Unreleased` already has either heading, append the bullet under that heading rather than duplicating it.

- [ ] **Step 3: Run documentation-sensitive checks**

Run: `pnpm lint`

Expected: PASS with no Biome diagnostics.

Run: `mise exec node@24.15.0 -- env npm_config_cache=/tmp/pi-status-phase-04-npm-cache pnpm run pack:dry-run && mise exec node@24.15.0 -- env npm_config_cache=/tmp/pi-status-phase-04-npm-cache pnpm pack:verify`

Expected: exit 0; the package listing contains `README.md`, `CHANGELOG.md`, `src/index.ts`, and `src/tui/session-actions.ts`, and contains no `tests/` or `docs/superpowers/` files.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe statusline session actions"
```

### Task 4: Phase 4 Verification and Completion Gate

**Files:** No new files.

- [ ] **Step 1: Verify the supported Node baseline**

Run: `mise exec node@24.15.0 -- node --version`

Expected: `v24.15.0` or newer. Stop and switch Node versions if lower; do not weaken `package.json` engines.

- [ ] **Step 2: Run the narrow verification suite**

Run:

```bash
PHASE_NPM_CACHE=$(mktemp -d /tmp/pi-status-phase-04-npm-cache.XXXXXX)
mise exec node@24.15.0 -- env npm_config_cache="$PHASE_NPM_CACHE" pnpm vitest run tests/tui/command-router.test.ts tests/tui/session-actions.test.ts tests/index.test.ts
```

Expected: exit 0; session details, rename success/failure, compact confirm/decline/callbacks, RPC rejection, routing, and unchanged empty-command editor coverage pass.

- [ ] **Step 3: Run all required full checks independently**

```bash
PHASE_NPM_CACHE=$(mktemp -d /tmp/pi-status-phase-04-npm-cache.XXXXXX)
mise exec node@24.15.0 -- env npm_config_cache="$PHASE_NPM_CACHE" pnpm lint
mise exec node@24.15.0 -- env npm_config_cache="$PHASE_NPM_CACHE" pnpm typecheck
mise exec node@24.15.0 -- env npm_config_cache="$PHASE_NPM_CACHE" pnpm test
mise exec node@24.15.0 -- env npm_config_cache="$PHASE_NPM_CACHE" pnpm check
```

Expected for each command: exit 0. `pnpm test` and `pnpm check` report every Vitest file green with no unhandled compaction-callback rejection.

- [ ] **Step 4: Verify package contents explicitly**

Run:

```bash
PHASE_NPM_CACHE=$(mktemp -d /tmp/pi-status-phase-04-npm-cache.XXXXXX)
mise exec node@24.15.0 -- env npm_config_cache="$PHASE_NPM_CACHE" pnpm run pack:dry-run 2>&1 | tee /tmp/pi-status-phase-04-pack.txt
mise exec node@24.15.0 -- env npm_config_cache="$PHASE_NPM_CACHE" pnpm pack:verify
grep -E 'README.md|CHANGELOG.md|src/index.ts|src/tui/session-actions.ts' /tmp/pi-status-phase-04-pack.txt
grep -E 'tests/|docs/superpowers/' /tmp/pi-status-phase-04-pack.txt && exit 1 || true
```

Expected: all four required paths are printed; the excluded-path grep prints nothing; final exit status is 0.

- [ ] **Step 5: Perform a manual TUI smoke check**

Run Pi with this checkout loaded, then verify:

1. `/statusline` opens and saves/cancels the existing editor unchanged.
2. `/statusline session` shows accurate details for the active session.
3. Canceling rename makes no change; entering a nonblank name updates only the current Pi session.
4. Declining compaction does nothing; confirming calls Pi compaction and completion/failure is nonfatal.
5. Running the command in RPC/non-TUI mode does not open custom UI or mutate the session.

Expected: all five behaviors match, with no sidebar or renderer changes.

- [ ] **Step 6: Review the final diff and commit boundaries**

Run:

```bash
git diff --check
git diff --stat "$PHASE_BASE"..HEAD
git status --short
git log --oneline -3
```

Expected: no whitespace errors; only the listed Phase 4 source, tests, README, and changelog changed since the recorded phase base; commits are the three small boundaries above.

## Phase Completion Gate

Phase 4 is complete only when all of the following are true:

- `/statusline session` displays current session details and offers exactly rename, compact, and close actions.
- Rename rejects canceled/blank input, trims valid input, uses `pi.setSessionName()`, and adds no pi-status persistence.
- Compact always requires an affirmative `ctx.ui.confirm()` and reports callback failure without crashing.
- Synchronous metadata, prompt, rename, and compaction-start failures become warnings without escaping the command handler.
- Non-TUI invocation performs no session mutation.
- Plain `/statusline`, unknown-command handling, footer restoration, and all prior tests remain green.
- README and `CHANGELOG.md` describe shipped behavior.
- Node baseline, narrow tests, full checks, and package-content checks all pass.
- No sidebar, private renderer, config schema, dependency, or unrelated refactor is present.
