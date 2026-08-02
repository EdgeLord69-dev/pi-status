# Statusline Inline Dialog Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Rename, dirty-close discard, and session-compaction confirmation into the existing centered `/statusline` overlay so `ui.custom` is the only interactive UI entry point.

**Architecture:** Keep persistent draft/config behavior in the existing pure dashboard reducer. Add one shared transient-dialog view type owned by `StatusLineDashboardComponent`; render it through the existing framed renderer, and use Pi TUI’s installed `Input` component for native text editing and IME support. The component implements `Focusable`, synchronizes focus into an Input created after overlay focus is established, and keeps dialog viewport state separate from the underlying tab. Remove host-dialog focus plumbing because the dashboard never yields focus to a second UI surface.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui` 0.83 (`Input`, `Focusable`, key matching), Vitest, Biome, pnpm.

---

## Current Findings and Boundaries

- `/statusline` is the only registered product command.
- The old editor, command router, and standalone preset/session/tools screens are already deleted.
- `src/tui/dashboard.ts` still calls `ctx.ui.input()` once and `ctx.ui.confirm()` twice; those are the only remaining product-owned menus/dialogs outside the overlay.
- Pi TUI 0.83 focuses a capturing overlay’s returned component in `showOverlay()`. A container created before Rename opens must therefore implement `Focusable` and explicitly copy its current focus into each newly created `Input`; waiting for another focus transition is incorrect.
- Pi TUI 0.83 `Input.handleInput()` owns Unicode, Kitty printable keys, bracketed paste, editing, submit, and Escape. The parent must forward raw input and request a render after edits.
- `biome.json` includes only `src/**/*.ts` and `tests/**/*.ts`; Biome is not the formatter for `README.md` or `CHANGELOG.md` in this repository.
- Do not change persisted config, command syntax, footer rendering, session helper APIs, or tool behavior.
- Do not rewrite historical plans/specs; update current README and Unreleased changelog wording.

## File Map

- Modify `src/tui/dashboard-render.ts`: accept an optional transient dialog view and render it inside the existing frame/body viewport while preserving shared geometry.
- Modify `src/tui/dashboard.ts`: own dialog lifecycle, embed native `Input`, route dialog keys, implement `Focusable`, and remove host-dialog/overlay-handle machinery.
- Modify `tests/tui/dashboard-render.test.ts`: cover dialog frame/height/fallback rendering.
- Modify `tests/tui/dashboard.test.ts`: cover native rename, confirmation navigation, action ordering, and lifecycle behavior.
- Modify `tests/index.test.ts`: assert command wiring never invokes `ui.select`, `ui.input`, `ui.confirm`, or `ui.editor`.
- Modify `README.md` and `CHANGELOG.md`: document that all transient actions remain inside the dashboard overlay.

### Task 1: Specify transient dialog rendering with failing tests

**Files:**

- Modify: `tests/tui/dashboard-render.test.ts`
- Modify: `src/tui/dashboard-render.ts`

- [ ] **Step 1: Add renderer tests for confirmation and rename views**

Import `Input` in `tests/tui/dashboard-render.test.ts`. Add tests that call `renderDashboard(state, preview, noTheme, width, rows, dialog)` and assert:

```ts
const discard = renderDashboard(state, preview, noTheme, 100, 40, {
  type: "confirm",
  kind: "discard",
  selectedIndex: 0,
});
const text = discard.lines.join("\n");
expect(text).toContain("Discard unsaved changes?");
expect(text).toContain("Cancel");
expect(text).toContain("Discard changes");
expect(discard.lines.find((line) => line.includes("Cancel"))).toContain("▸");
expect(discard.lines.every((line) => visibleWidth(line) === 100)).toBe(true);

const rename = renderDashboard(state, preview, noTheme, 80, 24, {
  type: "rename",
  input: new Input(),
});
expect(rename.lines.join("\n")).toContain("Rename session");
expect(rename.lines.join("\n")).toContain("Enter Submit");
expect(rename.lines).toHaveLength(
  renderDashboard(state, preview, noTheme, 80, 24).lines.length,
);
```

Also add a compact-confirmation assertion, verify selecting index `1` marks only the destructive `Discard changes` or `Compact session` row, and render each dialog with `terminalRows = 11`, which leaves one normal body row. The one-row Rename viewport must show the Input line; confirmations must show the selected option; every case must retain the footer and bottom border. Assert a dialog render returns offset `0`; preservation of the underlying tab offset is covered at the component layer.

- [ ] **Step 2: Run the new renderer tests and verify the red state**

Run:

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: FAIL because the extra runtime argument is ignored and no transient dialog content is rendered. Vitest transpiles without typechecking, so the content assertions—not the TypeScript arity mismatch—prove the red state.

- [ ] **Step 3: Define the renderer contract and implement the smallest dialog view**

In `src/tui/dashboard-render.ts`, import `Input` and add the one shared contract that `dashboard.ts` will import:

```ts
export type DashboardDialog =
  | { type: "rename"; input: Input }
  | { type: "confirm"; kind: "discard" | "compact"; selectedIndex: 0 | 1 };
```

Extend `renderDashboard` with `dialog?: DashboardDialog`. Keep natural-height calculation unchanged by rendering normal tabs for the natural pass, which preserves the overlay height when a dialog opens. For the active pass, replace only the logical body with:

- Rename title and the first line from `input.render(contentWidth)`.
- Discard title/message plus `Cancel` and `Discard changes` rows.
- Compact title/message plus `Cancel` and `Compact session` rows.

Use the existing `selectableLine`, line normalization, `truncateToWidth`, `bodyRowBudget`, `fitViewport`, `frame`, and too-small fallback helpers. Mark the Rename Input line as `selectedLine` so it remains visible when only one body row fits. Give confirmation rows `selectedLine` based on `selectedIndex`. Use `Enter Submit • Esc Cancel` for the Rename footer and `↑/↓ Select • Space/Enter Choose • q/Esc Cancel` for confirmations.

Dialog viewports always start at offset `0` and return that computed dialog offset. They must not consume the active tab’s stored offset; `StatusLineDashboardComponent.render()` will skip reducer offset updates while a dialog is active. Keep every returned line at the existing safe width.

- [ ] **Step 4: Run renderer tests and commit the renderer slice**

Run:

```bash
pnpm exec biome format --write src/tui/dashboard-render.ts tests/tui/dashboard-render.test.ts
pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: PASS for existing dashboard rendering plus all new dialog cases.

Commit:

```bash
git add src/tui/dashboard-render.ts tests/tui/dashboard-render.test.ts
git commit -m "feat: render dashboard dialogs inside overlay"
```

### Task 2: Replace host dialogs with in-overlay component state

**Files:**

- Modify: `tests/tui/dashboard.test.ts`
- Modify: `src/tui/dashboard.ts`

- [ ] **Step 1: Replace deferred host-dialog tests with failing in-overlay behavior tests**

Update the dashboard test harness to provide only `notify`, `custom`, and compaction APIs for dashboard interaction; remove deferred host input/confirmation and overlay-handle fixtures. Import `CURSOR_MARKER` for the focus assertion. Add tests with these exact behaviors:

```ts
it("renames through the focused embedded input and restores the Session tab", () => {
  const { component, pi, ctx } = makeDashboard();
  component.focused = true;
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\r");
  expect(component.render(100).join("\n")).toContain(CURSOR_MARKER);
  component.handleInput("\x1b[200~Release 🚀\x1b[201~");
  component.handleInput("\r");
  expect(pi.setSessionName).toHaveBeenCalledWith("Release 🚀");
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    "Session renamed to Release 🚀",
    "info",
  );
  const output = component.render(100).join("\n");
  expect(output).toContain("Name: Release 🚀");
  expect(output).not.toContain("Enter Submit");
});

it("uses Cancel as the safe default for dirty close", () => {
  const { component, done } = makeDashboard();
  component.handleInput("\x1b[Z");
  component.handleInput("\r");
  component.handleInput("q");
  expect(component.render(100).join("\n")).toContain(
    "Discard unsaved changes?",
  );
  component.handleInput("\r");
  expect(done).not.toHaveBeenCalled();
});

it("confirms compaction only after moving to the second row", () => {
  const { component, ctx, order } = makeDashboard();
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\x1b[B");
  component.handleInput("\r");
  component.handleInput("\x1b[B");
  component.handleInput("\r");
  expect(order).toEqual(["done", "dispose", "compact"]);
  expect(ctx.compact).toHaveBeenCalledOnce();
});
```

Add coverage for blank rename Enter, Escape cancellation, `q` being inserted as rename text, raw and Kitty `q` cancelling confirmations, rename failure warning with unchanged session state, confirmation cancellation, synchronous compaction failure after close, and ignored tab switching while a dialog is visible. Add a scroll-preservation test that opens and cancels dirty-close from a tab with a nonzero offset and proves selection/query/offset are unchanged. Add a post-close lifecycle test that opens either dialog, calls `close()`, then sends the would-be submit/confirm keys and proves no rename or compaction runs.

- [ ] **Step 2: Run dashboard tests and verify the red state**

Run:

```bash
pnpm vitest run tests/tui/dashboard.test.ts
```

Expected: FAIL because the component still invokes `ui.input()`/`ui.confirm()` and has no transient view routing.

- [ ] **Step 3: Add native Input and transient dialog lifecycle**

In `src/tui/dashboard.ts`:

1. Import `Input` and `type Focusable` from `@earendil-works/pi-tui`, and import `type DashboardDialog` from `./dashboard-render.ts`; do not duplicate the union.
2. Store `private dialog: DashboardDialog | undefined` and make `StatusLineDashboardComponent` implement `Focusable`:

```ts
private _focused = false;

get focused(): boolean {
  return this._focused;
}

set focused(value: boolean) {
  this._focused = value;
  if (this.dialog?.type === "rename") this.dialog.input.focused = value;
}
```

3. On Session Rename activation, create `new Input()`, leave it empty, assign `input.focused = this.focused` immediately, then install callbacks. `onSubmit` trims the value; blank input closes the dialog without calling Pi. Nonblank input calls `renameCurrentSession`, replaces the session snapshot, and notifies. Catch failures inside the callback, warn, leave session state unchanged, and close the dialog. `onEscape` closes the dialog.
4. On dirty close, create `{ type: "confirm", kind: "discard", selectedIndex: 0 }`; on Compact activation, create the equivalent `compact` dialog. Cancel is always the initial selection.
5. At the start of `handleInput`, route to the active dialog. Rename forwards the raw data unchanged to `Input.handleInput()` and requests a render afterward when still open. In Rename, `q` is ordinary text. Confirmations clamp Up to index `0` and Down to index `1`; raw or Kitty `q` and Escape cancel; Space/Enter choose the selected row; all other keys, including Tab, are ignored. No dialog path may switch tabs, change search, or mutate draft state. Every selection/edit/cancel transition requests a render when the component remains open.
6. Confirm discard by calling `close()`. Confirm compact by calling `close()` before `startSessionCompaction(ctx)`; catch a synchronous compaction throw and warn without trying to reopen or refocus the disposed overlay. On Cancel, clear only transient dialog state.
7. Pass the dialog to `renderDashboard`. While a dialog is active, do not dispatch the renderer’s dialog offset into `state.navigation`; after cancellation, the underlying selection, query, and offset remain intact. Normal tab renders keep the existing offset synchronization.
8. Forward `invalidate()` to an active Rename Input. Before clearing a Rename dialog in `close()` or `dispose()`, set its `focused` property to `false`. Preserve idempotent close/dispose and session lifecycle cleanup.
9. Delete `busy`, `overlayHandle`, `setOverlayHandle`, `withDialog`, `requestClose`’s host-confirm call, `renameSession`, and `compactSession`’s host-confirm call.

- [ ] **Step 4: Remove `onHandle` from overlay construction**

Keep the custom call’s options exactly:

```ts
{
  overlay: true,
  overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
}
```

Remove the `OverlayHandle` import, local handle variables, `onHandle`, and handle-order tests. Do not create a second `ui.custom` call. Pi 0.83 `showOverlay()` focuses the returned capturing component, so the dashboard remains the sole focus target and its `Focusable` setter propagates that state to Rename.

- [ ] **Step 5: Run dashboard tests and commit the component slice**

Run:

```bash
pnpm exec biome format --write src/tui/dashboard.ts tests/tui/dashboard.test.ts
pnpm vitest run tests/tui/dashboard.test.ts tests/tui/dashboard-render.test.ts
```

Expected: PASS with no calls to `ctx.ui.input`, `ctx.ui.confirm`, or overlay-handle methods.

Commit:

```bash
git add src/tui/dashboard.ts tests/tui/dashboard.test.ts
git commit -m "feat: keep dashboard dialogs inside overlay"
```

### Task 3: Prove the command boundary has one interactive UI path

**Files:**

- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add a command wiring assertion**

Extend the existing `/statusline dashboard wiring` open test with spies for every host blocking UI method:

```ts
const select = vi.fn();
const input = vi.fn();
const confirm = vi.fn();
const editor = vi.fn();
const host = deferredCustomHost();
const ctx = createContext({
  ui: {
    ...createContext().ui,
    select: select as never,
    input: input as never,
    confirm: confirm as never,
    editor: editor as never,
    custom: host.custom as never,
  },
});
const command = getRegisteredCommand(
  registerCommandCalls,
  "statusline",
).handler("", ctx);
await new Promise((resolve) => setImmediate(resolve));
host.resolveCustom(undefined);
await command;
expect(host.custom).toHaveBeenCalledOnce();
expect(select).not.toHaveBeenCalled();
expect(input).not.toHaveBeenCalled();
expect(confirm).not.toHaveBeenCalled();
expect(editor).not.toHaveBeenCalled();
```

Retain argument rejection, RPC warning, duplicate-open, and footer-continuity tests. Update the deferred custom host to stop invoking `options.onHandle` and update its exact options assertion.

Rewrite the existing `session_start`/`session_tree`/`session_shutdown` × Rename/Compact lifecycle matrix without deferred host dialogs: open the inline dialog, emit the lifecycle event so the dashboard closes, then send the would-be rename text plus Enter or Down plus Enter to the closed component. Assert one `done`/`dispose` sequence, no rename, no compaction, and successful later reopen.

- [ ] **Step 2: Run wiring tests and static search**

Run:

```bash
pnpm exec biome format --write tests/index.test.ts
pnpm vitest run tests/index.test.ts
rg -n "ctx\.ui\.(select|input|confirm|editor)|ui\.(select|input|confirm|editor)" src
```

Expected: index tests PASS and the `rg` command returns no production matches.

- [ ] **Step 3: Commit the command-boundary verification**

```bash
git add tests/index.test.ts
git commit -m "test: enforce overlay-only statusline UI"
```

### Task 4: Update current user documentation

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README interaction wording**

Change the Quick Start Session bullet from Pi dialogs to wording equivalent to:

```md
- **Session** shows current details; Rename and Compact open transient views inside the same dashboard overlay.
- `Esc` clears search before closing; dirty close opens an in-overlay Cancel/Discard confirmation.
```

Keep the existing five-tab, keybinding, saved-footer, and overlay geometry descriptions.

- [ ] **Step 2: Update the Unreleased changelog**

Replace the current “Session rename and compaction use Pi dialogs” statement with:

```md
- Session rename, compaction confirmation, and dirty-close discard now stay inside the centered dashboard overlay.
```

- [ ] **Step 3: Check the documentation diff and commit**

Biome is configured only for TypeScript in this repository, so do not run it against Markdown. Run:

```bash
git diff --check -- README.md CHANGELOG.md
```

Expected: no whitespace errors.

Commit:

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe inline dashboard dialogs"
```

### Task 5: Full verification and self-review

**Files:**

- Read: all changed files and this plan

- [ ] **Step 1: Run focused behavior checks**

```bash
pnpm vitest run tests/tui/dashboard.test.ts tests/tui/dashboard-render.test.ts tests/index.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the repository quality gate under Node 24.15+**

```bash
pnpm check
```

Expected: format check, lint, typecheck, all tests, and package verification PASS. If the user npm cache is root-owned, rerun only package verification with an isolated task cache:

```bash
npm_config_cache=/private/tmp/pi-status-npm-cache pnpm pack:verify
```

- [ ] **Step 3: Verify no dialog calls or whitespace errors remain**

```bash
rg -n "ctx\.ui\.(select|input|confirm|editor)|ui\.(select|input|confirm|editor)" src
git diff --check
git status --short
```

Expected: the source search has no matches, `git diff --check` is clean, and status contains only intentional implementation changes before commit/merge handling.

- [ ] **Step 4: Perform the manual TUI acceptance check**

Inside an interactive Pi TUI session:

1. Open `/statusline`; verify the saved footer remains visible behind the centered overlay.
2. Edit Layout or Settings, press `q`/Esc, choose Cancel, and verify the draft remains open and dirty.
3. Reopen dirty close, move to Discard, confirm, and verify the overlay closes without changing the saved footer.
4. Open Session → Rename, type Unicode through an IME and bracketed paste, and verify the IME candidate window tracks the inline cursor. Submit and verify the Session row updates without a second modal.
5. In Rename, type `q` and verify it is inserted rather than cancelling. Cancel with Escape.
6. Open Session → Compact, cancel once with `q`, then reopen and confirm once; verify the overlay disposes before compaction starts.
7. Resize the terminal while Rename and each confirmation view is visible, including a height that leaves one body row; verify the Input or selected confirmation row, footer, and borders remain visible and bounded.

## Self-Review Checklist

- [x] Scope is one subsystem: transient dashboard dialogs and their docs/tests.
- [x] All three remaining host-dialog call sites are covered.
- [x] No new dependency or persistence surface is introduced; native `Input` is reused.
- [x] Safe defaults and lifecycle ordering are explicit.
- [x] Test commands and expected outcomes are explicit.
- [x] No placeholder or unspecified implementation branch remains.
- [x] Renderer and component import one shared `rename`/`confirm` type with a `selectedIndex: 0 | 1` contract.
- [x] Focus propagation covers both later focus changes and an Input created while the overlay is already focused.
- [x] Dialog rendering cannot overwrite the underlying tab’s selection, query, or viewport offset.
- [x] Raw Unicode/Kitty/paste input and parent rerender responsibility are explicit.
- [x] The production boundary excludes `select`, `input`, `confirm`, and `editor`; `custom` is the sole blocking UI entry point.
- [x] Verification commands match the repository’s TypeScript-only Biome configuration.
