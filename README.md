# @pi-vault/pi-status

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-status)](https://www.npmjs.com/package/@pi-vault/pi-status)
[![Quality](https://github.com/pi-vault/pi-status/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-status/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Replace Pi's default footer with a compact, configurable status line that shows the session details you actually care about. `@pi-vault/pi-status` installs a live footer, adds `/statusline` for interactive configuration, and optionally surfaces usage-backed limits through [`@pi-vault/pi-usage`](https://www.npmjs.com/package/@pi-vault/pi-usage).

Default footer:

```text
model-with-reasoning
current-dir
```

## Install, Upgrade, And Reload

Install or upgrade the extension:

```bash
pi install npm:@pi-vault/pi-status
```

Optional: install `pi-usage` if you want the `five-hour-limit` and `weekly-limit` footer segments:

```bash
pi install npm:@pi-vault/pi-usage
```

Reload Pi after installing or upgrading:

```bash
/reload
```

Usage-limit segments depend on `pi-usage`. `/statusline` can show those segment options after `pi-usage` responds, and the live footer renders them when compatible live limit window data is available.

## Quick Start

Once installed, the footer updates automatically. Run `/statusline` inside Pi to open the five-tab dashboard:

- **Layout**, **Statuses**, and **Settings** share one draft and Save action.
- **Tools** applies tool changes immediately and never disables the final active tool.
- **Session** shows current details; Rename and Compact open transient views inside the same dashboard overlay.
- `Esc` clears search before closing; dirty close opens an in-overlay Cancel/Discard confirmation.
- The saved footer remains visible behind the centered dashboard overlay.

Use `Tab` and `Shift+Tab` to move between tabs, arrow keys to navigate, `Space` to toggle, and type to search. Pi 0.83.0 or newer is required.

## Available Segments

You can compose the footer from these segment IDs:

- `model`
- `model-with-reasoning`
- `project-name`
- `current-dir`
- `git-branch`
- `workspace-pulse`
- `run-state`
- `context-remaining`
- `context-used`
- `used-tokens`
- `total-input-tokens`
- `total-output-tokens`
- `session-id`
- `five-hour-limit`
- `weekly-limit`
- `cache-read-tokens`
- `cache-write-tokens`
- `cache-hit`
- `session-cost`
- `access-type`
- `turn-progress`
- `response-performance`

`five-hour-limit` and `weekly-limit` depend on standalone [`@pi-vault/pi-usage`](https://www.npmjs.com/package/@pi-vault/pi-usage). `/statusline` shows those segments after `pi-usage` responds, and the live footer omits them until compatible live limit window data is available.

The five telemetry segments are opt-in; none are enabled by default. Session token totals include assistant, tool-result, branch-summary, and compaction usage from all session entries. `cache-hit` reflects only the latest assistant prompt, `access-type` is `subscription` for OAuth or `kimi-coding` models and `metered` otherwise, and `session-cost` is best-effort telemetry rather than billing-grade data.

The two live activity segments are also opt-in. They observe the current TUI session only and are session-local — nothing is persisted and nothing leaves the runtime. `turn-progress` renders values such as `Run 2s · Turn 3 1s · read×2 +1`; when no tool is active, it shows the most recently completed tool. `response-performance` renders values such as `TTFT 320ms · ~42.5 tok/s` and is omitted until TTFT is known. TTFT runs from provider dispatch to the first positive full assistant-message estimate, so thinking or tool-call content can establish the boundary before visible text. Streaming TPS is an estimate measured from that first token and may lag a throughput spike; when the response completes, Pi's official output usage replaces the estimate.

### Workspace Pulse

`workspace-pulse` is an opt-in, read-only Git workspace summary. Place it in any zone you want; it is disabled by default and never starts in RPC or non-TUI sessions. It runs only two bounded Git porcelain v2 commands — `git rev-parse --show-toplevel` and `git status --porcelain=v2 --branch --untracked-files=all` — each with a 2-second timeout, a 256 KiB output cap, locale-stable C output, and `GIT_OPTIONAL_LOCKS=0` so it never blocks other Git operations. The segment refreshes on session start, immediately on every `turn_start`, and 250 ms after every `tool_execution_end`. It never polls or watches the filesystem; edits made outside Pi are observed at the next turn. Coexist with `git-branch`: both segments can render simultaneously.

Output tokens (always in this order, omitting any that are zero or unknown):

- `Git` anchor, then `◌` when the last successful result is stale
- `✓` for a clean working tree or `!N` for conflicts (conflict always wins over changed)
- branch name (`HEAD` for detached, `—` when no branch is reported, and `?` for an unavailable inspection)
- `+N` staged changes, `~N` unstaged edits, `?N` untracked files
- `↑N` ahead of upstream, `↓N` behind upstream

When the segment cannot refresh after a successful inspection, the prior branch, counts, and ahead/behind remain visible with the `◌` marker until the next successful refresh.

State values:

- `clean` — clean working tree
- `changed` — staged/unstaged/untracked work, no conflicts
- `conflict` — unmerged entries exist (also implies changed)
- `not-repository` — `cwd` was not inside a Git repository at the last inspection; later lifecycle events retry
- `unavailable` — Git is missing, the process failed, the output exceeded the cap, or the inspection timed out
- `stale` — the last known state is shown with a stale marker because a subsequent inspection failed

Changed-file paths are never retained or displayed, the formatter never embeds internal error text or stack frames, and `unavailable` and `stale` never render the clean check.

## Footer Layout And Extension Statuses

The footer has four ordered zones: TL (top-left), TR (top-right), BL
(bottom-left), and BR (bottom-right). Top zones render on the first row and
bottom zones on the second; left zones are left-aligned and right zones are
right-aligned. The two rows fit independently at narrow widths: lower-priority
items drop as needed, then the remaining line is truncated.

Extension statuses are not normal footer segments. Visible statuses are fixed
in the bottom-right zone and drop before configured segments when space is
tight.

- `/statusline` lets you hide individual status keys.
- Hidden keys stay hidden through persisted settings.
- If no visible extension statuses remain, nothing extra is appended to the footer.

## Common Examples

Each example below is a value for the `"zones"` field in `statusline.json`.

Keep the default layout:

```json
{
  "topLeft": ["model-with-reasoning"],
  "topRight": [],
  "bottomLeft": ["current-dir"],
  "bottomRight": []
}
```

Show more session detail on the top row:

```json
{
  "topLeft": ["model", "run-state", "git-branch"],
  "topRight": ["context-used", "context-remaining", "session-id"],
  "bottomLeft": [],
  "bottomRight": []
}
```

Usage-aware footer:

```json
{
  "topLeft": ["model-with-reasoning"],
  "topRight": [],
  "bottomLeft": ["current-dir"],
  "bottomRight": ["five-hour-limit", "weekly-limit"]
}
```

If another extension reports status text, it appears in the bottom-right zone.

## Configuration Behavior

`@pi-vault/pi-status` stores one global configuration file at
`<Pi agent directory>/extensions/statusline.json`. When
`PI_CODING_AGENT_DIR` is set, the path is
`$PI_CODING_AGENT_DIR/extensions/statusline.json`; otherwise Pi supplies its
default agent directory.

The file contains the statusline config directly:

```json
{
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

A legacy direct config with a `"segments"` array still loads by placing those
segments in TL. The first save from `/statusline` rewrites it to the `zones`
shape. Missing, malformed, invalid, or wholly empty layouts fall back to the
default layout; when `zones` is present, it takes precedence over `segments`.

Set `NO_COLOR` (even to an empty string) to disable color in both the footer
and `/statusline`; its presence, not its value, is what matters.

There are no project-specific overrides. pi-status no longer reads or writes
Pi's global or project `settings.json`. Existing `statusLine` values in those
files are ignored and left unchanged. To keep them, manually copy the contents
of the old `statusLine` object into `extensions/statusline.json`.

## Completion Notifications

The Settings tab in `/statusline` controls an opt-in, global preference for
best-effort direct-terminal notifications when a TUI agent run settles or
`@pi-vault/pi-questionnaire` enters its wait state. The preference is off by
default, lives in `extensions/statusline.json`, and has no per-project or
per-session override.

The authoritative settlement signal is Pi's public `agent_settled` event. The
extension does not infer completion from `agent_end`, `turn_end`, assistant
text, or tool completion.

Outside a Herdr pane, the preference controls Ghostty OSC 9 delivery. Direct
notification text is fixed: `Pi finished` / `The current run has settled.` on
settlement, and `Pi needs input` / `A questionnaire is waiting for you.` while
a questionnaire is active. Terminal control characters are removed before OSC
output, and write failures do not interrupt Pi.

Inside a Herdr pane (`HERDR_ENV=1`), pi-status emits no OSC and does not execute
`herdr notification show`. The official Herdr Pi integration owns settlement
state, presentation, toast delivery, delay, and sound according to Herdr's
`[ui.toast]` and `[ui.sound]` configuration.

When `@pi-vault/pi-questionnaire` is installed, pi-status subscribes to its
literal `pi-vault:questionnaire:status` event. An active payload must include a
string `label` to pass runtime validation. Direct OSC notification text never
includes the label. In a Herdr pane, pi-status forwards it as the blocked-state
message and Herdr decides how to present it. Each validated false-to-true wait
interval is forwarded once as `herdr:blocked`, followed by one matching
inactive event. This semantic bridge remains active even when the pi-status
notification preference is disabled.

RPC and print contexts do not receive direct notifications. Failed settings
writes leave both runtime state and notifier behavior unchanged.

## Upgrade Notes For 0.2.x Users

If you are upgrading from `0.2.x`, note these compatibility changes:

- `context-window-size` and `extension-statuses` are no longer supported segment IDs.
- Existing configs that still mention removed IDs are normalized by dropping those unsupported entries.
- Extension status visibility now comes from per-key hidden status settings instead of a dedicated `extension-statuses` segment.
- Configuration now has a hard cutover to the global extension-owned `extensions/statusline.json` file; Pi `settings.json` values are ignored and not migrated automatically.
- The extension requires Node.js `>=24.15.0`.
- The tested Pi host baseline is now `@earendil-works/pi-coding-agent@0.83.0` and `@earendil-works/pi-tui@0.83.0`.

## Sidebar

`@pi-vault/pi-status` installs a right-edge, non-capturing sidebar that surfaces the same live data the footer tracks — session, run, turn, tools, workspace pulse, extension statuses — alongside optional contributions from other extensions. The sidebar is on by default, runs only in TUI sessions, and never leaves the runtime: nothing is persisted from sidebar activity and nothing it observes leaves the host.

### Built-in panels and order

Nine built-in panels ship in this default order:

1. `agent` — current model, provider, thinking level, and access type
2. `activity` — run, turn, tool count, and live TTFT / tokens-per-second
3. `alerts` — extension statuses whose text matches an exception keyword
4. `statuses` — every other discovered extension status
5. `todos` — pending / in-progress / completed task list
6. `context` — used tokens, context window, percentage, and meter
7. `workspace` — project name, branch, workspace pulse summary
8. `usage` — session input/output/cache tokens and cost
9. `tools` — active vs available tool count, optionally expanded to names

`statuses` is a pi-status split of Atelier's combined STATUSES panel: text matching `error`, `failed`, `failure`, `offline`, or `unavailable` routes to `alerts`; text matching `warn`, `warning`, `degraded`, or `blocked` also routes to `alerts` with a `▲` indicator; everything else lands in `statuses` with a `•` indicator. The split lets users hide noisy alerts while keeping normal status text visible.

### Sidebar dashboard tab

`/statusline` exposes a `Sidebar` tab at index 1, immediately after `Statusbar` and before `Statuses`. The tab renders an Active-panel editor: choose a panel with `←` / `→`, toggle visibility, reorder panel position, and search/assign/disable segments.

Editor order is fixed: **Active panel**, **Panel visible**, **Panel position**, searchable segment rows, **Restore default**, **Save changes**. Every action targets a specific segment ID; no row index is preserved across mutations or filter changes. Search matches segment ID, label, or description fuzzily; the search input is shared with Statuses and Tools (`q`, printable ASCII, Backspace, Esc clears).

Segment action rules:

- Activating a hidden segment appends it to the active panel.
- Activating a segment assigned elsewhere moves it to the active panel.
- Activating a segment already in the active panel disables it.
- `←` / `→` reorders only segments assigned to the active panel; wrong-panel and boundary reorders are no-ops.

Layout rules:

- Built-in panel order, visibility, and segment assignment are independent from Statusbar zones.
- Statuses has independent Statusbar and Sidebar surfaces (`Surface - Statusbar` / `Surface - Sidebar`); the picker toggles them in place. Statusbar changes only config; Sidebar changes only the effective layout.
- Stable built-ins, statuses, tools, identified contributions, and unknown stable IDs persist.
- TODO IDs (`session:todo:<id>`) and anonymous contributed IDs are session-only; they never reach disk.
- Unavailable stable IDs remain visible as editable placeholders but their live segment never appears.
- Catalog and panel metadata are frozen when the dashboard opens; re-open to see changes.
- Valid stable row IDs match `^[a-z][a-z0-9_-]{0,63}$`.
- Failed saves leave the live layout, dashboard drafts, query, and selection unchanged and can be retried.

Sample nested layout:

```json
{
  "sidebarPanelLayout": [
    {
      "id": "agent",
      "visible": true,
      "segments": [
        "builtin:model",
        "builtin:thinking",
        "builtin:provider",
        "builtin:access"
      ]
    },
    {
      "id": "activity",
      "visible": true,
      "segments": [
        "builtin:run-state",
        "builtin:run-timing",
        "builtin:turn-progress"
      ]
    }
  ],
  "sidebarHiddenSegments": ["tool:read"]
}
```

Per-tool rows replace the old global tool-name switch and default to disabled. Disk persistence precedes runtime replacement; a failed write leaves the live layout, Workspace Pulse demand, both baselines/drafts, query, selection, dirty state, and retryability intact.

### Migration note

The legacy `showSidebarToolNames`, `sidebarExtensionSegments`, and Settings `Show tool names` rows are no longer current. They are honored during config load only when no `sidebarPanelLayout` is present. New configurations should use the nested format above.

### Contribution channel and protocol

Other extensions can publish structured panels into the sidebar over the public contribution channel `pi-status:sidebar-panels` (protocol version `1`). Limits enforced by the registry:

- 64 panels maximum per host
- 24 rows maximum per panel
- 160 visible characters per row (8× raw code units inspected before sanitization)
- 48 visible characters per panel title (8× raw code units inspected before sanitization)
- 128 characters per panel source name
- 128 characters per panel ID
- 64 distinct event sources tracked

Panel IDs must be namespaced (`vendor:name`, lowercase alphanumerics, hyphens, underscores). Registration emits `register`, `unregister`, and `discover` events over Pi's public `pi.events` bus. Title and row text are sanitized for ANSI / OSC escapes, C0 / C1 controls, Unicode bidi overrides, and surrogate validity before display. Use `sanitizeSidebarPanelText` from the public API to pre-clean text you intend to ship.

### Hidden-by-default contributions

Newly registered contributions are hidden by default. `normalizeSidebarPanelLayout` only seeds built-ins into the default layout; a contribution must be added explicitly via the Sidebar tab to appear. This keeps sidebar behavior deterministic across hosts and prevents surprise panels.

### TODO rendering

The TODOS panel accepts a `NormalizedTodo[]` snapshot with `status: "pending" | "in_progress" | "completed"`. pi-status does not parse TODO formats itself; the producer that populates the sidebar snapshot owns format parsing. Rendering shows a `done/total` summary, then one row per task with a `✓` (completed), `�` (in progress), or `○` (pending) indicator, the `#id`, and the task text.

### Width breakpoints

- **39-column compact breakpoint** (`COMPACT_SIDEBAR_MAX_WIDTH = 39` in `src/tui/sidebar-render.ts`). Sidebar widths ≤ 39 collapse to the compact layout; tool names collapse behind the count.
- **92-column auto-hide threshold** (`MIN_MAIN_WIDTH(64) + MIN_SIDEBAR_WIDTH(28)` in `src/tui/split-pane.ts`). Terminal widths < 92 hide the sidebar to preserve the main viewport.

### Resize shortcut and controls

`Ctrl+Shift+R` enters temporary Resize mode. While in Resize mode:

- `Shift+Left` / `Shift+Right` adjust width by ±4 columns
- `Left` / `Right` adjust width by ±1 column
- `Enter` accepts the new width
- `Escape` restores the pre-resize width
- SGR mouse drag from the divider column or its neighbors adjusts width continuously

Mouse reporting is enabled only while in Resize mode; the rest of the host's `onTerminalInput` listeners are not polluted with mouse sequences outside this window.

### Fullscreen / alt-screen behavior

When Pi runs in alt-screen fullscreen mode (`--ui-mode fullscreen`), the host TUI is a viewport instance flagged via `Symbol.for("@earendil-works/pi-tui/viewport")`. The sidebar detects this and refuses to install; `SidebarController.isSupported()` returns false. No warning is emitted — the absence of the sidebar is the signal. The footer and `/statusline` continue to work.

### Dashboard centering beside the sidebar

When `/statusline` opens its dashboard overlay, it anchors the overlay at `center`, then applies `offsetX: -Math.floor(effectiveSidebarWidth / 2)` whenever the sidebar is effectively visible. This shifts the dashboard left by half the sidebar's width so it lands in the main (left-of-sidebar) column instead of overlapping the sidebar. When the sidebar is hidden, no offset is applied and the dashboard centers in the full terminal.

### `NO_COLOR`

`NO_COLOR` is honored by presence, not by value. Set it (even to an empty string) to disable color in both the footer and `/statusline`; both surfaces strip ANSI codes when the environment contains a `NO_COLOR` key.

### Cleanup guarantees

On `session_shutdown`, the sidebar controller, sidebar panel registry, workspace-pulse runtime, activity runtime, usage runtime, completion-notification wiring, and dashboard overlay are all disposed; the footer is cleared. Every dispose is idempotent — each guards with `if (disposed) return`, so a second shutdown call (session replacement, double event delivery) succeeds silently without throwing or double-freeing.

## Development And Verification

```bash
pnpm install
pnpm check
pnpm run pack:dry-run
```

## License

MIT
