# @pi-vault/pi-status

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-status)](https://www.npmjs.com/package/@pi-vault/pi-status)
[![Quality](https://github.com/pi-vault/pi-status/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-status/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Replace Pi's default footer with a compact, configurable status line that shows the session details you actually care about. `@pi-vault/pi-status` installs a live footer, adds `/statusline` for interactive configuration, and surfaces a sidebar with the same live session data. Optionally, install [`@pi-vault/pi-usage`](https://www.npmjs.com/package/@pi-vault/pi-usage) to light up usage-limit segments.

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

## Quick Start

Once installed, the footer updates automatically. Run `/statusline` inside Pi to open the dashboard — a centered overlay with six tabs:

- **Statusbar** — the four-zone footer layout (TL, TR, BL, BR).
- **Sidebar** — toggle, reorder, and search the panels that show on the right edge.
- **Statuses** — per-key visibility for extension-reported status text.
- **Session** — current session details, with Rename and Compact inside the same overlay.
- **Tools** — per-tool enable/disable; applies immediately.
- **Settings** — opt-in completion notifications.

`Tab` / `Shift+Tab` moves between tabs, arrow keys navigate, `Space` toggles, type to search. The saved footer remains visible behind the dashboard overlay.

Pi 0.84.1 or newer is required.

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

`five-hour-limit` and `weekly-limit` require [`@pi-vault/pi-usage`](https://www.npmjs.com/package/@pi-vault/pi-usage); they appear in `/statusline` only after `pi-usage` is loaded.

The five telemetry segments (`cache-read-tokens`, `cache-write-tokens`, `cache-hit`, `session-cost`, `access-type`) are opt-in — none are enabled by default. `access-type` reads `subscription` for OAuth or `kimi-coding` models and `metered` otherwise. `session-cost` is best-effort telemetry rather than billing-grade data.

The two live activity segments (`turn-progress`, `response-performance`) are also opt-in and session-local — nothing is persisted and nothing leaves the runtime. `turn-progress` shows the active tool (or the most recent one) plus counts. `response-performance` shows time-to-first-token and a streaming tokens-per-second estimate.

### Workspace Pulse

`workspace-pulse` is an opt-in, read-only Git workspace summary. It runs only two bounded `git` commands per refresh (root lookup and a porcelain status), each with a 2-second timeout and a 256 KiB cap, and it never blocks other Git operations. Refreshes happen on session start, every `turn_start`, and 250 ms after every `tool_execution_end`. It never polls the filesystem.

Output: a `Git` anchor, a clean / conflict indicator, the branch name, staged / unstaged / untracked counts, and ahead / behind upstream. When a refresh fails, the last known state stays visible with a stale marker. Changed-file paths are never retained or displayed.

## Footer Layout And Extension Statuses

The footer has four ordered zones: TL (top-left), TR (top-right), BL (bottom-left), BR (bottom-right). Top zones render on the first row, bottom zones on the second; left zones left-align, right zones right-align. The two rows fit independently at narrow widths — lower-priority items drop as needed, then the remaining line is truncated.

Extension statuses are not normal footer segments. Visible statuses are pinned to the bottom-right zone and drop before configured segments when space is tight. Use `/statusline` to hide individual status keys.

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

`@pi-vault/pi-status` stores one global configuration file at `<Pi agent directory>/extensions/statusline.json`. When `PI_CODING_AGENT_DIR` is set, the path is `$PI_CODING_AGENT_DIR/extensions/statusline.json`; otherwise Pi supplies its default agent directory.

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

Missing, malformed, or empty layouts fall back to the default layout. A legacy direct config with a `"segments"` array still loads by placing those segments in TL; the first save from `/statusline` rewrites it to the `zones` shape. There are no project-specific overrides — pi-status no longer reads or writes Pi's global or project `settings.json`.

Set `NO_COLOR` (even to an empty string) to disable color in both the footer and `/statusline`; its presence, not its value, is what matters.

## Completion Notifications

The Settings tab in `/statusline` controls an opt-in, global preference for direct-terminal notifications when a TUI agent run settles or `@pi-vault/pi-questionnaire` enters its wait state. The preference is off by default and lives in `extensions/statusline.json`.

Outside a Herdr pane, the preference enables Ghostty OSC 9 notifications with fixed text (`Pi finished` / `Pi needs input`). Terminal control characters are removed before sending, and write failures do not interrupt Pi.

Inside a Herdr pane (`HERDR_ENV=1`), pi-status forwards the same semantic events to Herdr and lets it decide how to present them. The official Herdr Pi integration owns settlement state, presentation, toast delivery, delay, and sound.

RPC and print contexts do not receive direct notifications.

## Sidebar

`@pi-vault/pi-status` installs a right-edge, non-capturing sidebar that surfaces the same live data the footer tracks — session, run, turn, tools, workspace pulse, extension statuses — alongside optional contributions from other extensions. The sidebar is on by default and runs only in TUI sessions.

### Built-in panels and order

Nine built-in panels ship in this default order:

1. `agent` — current model, provider, thinking level, access type
2. `activity` — run, turn, tool count, TTFT / tokens-per-second
3. `alerts` — extension statuses whose text matches an exception keyword
4. `statuses` — every other discovered extension status
5. `todos` — pending / in-progress / completed task list
6. `context` — used tokens, context window, percentage, meter
7. `workspace` — project name, branch, workspace pulse summary
8. `usage` — session input/output/cache tokens and cost
9. `tools` — active vs available tool count, optionally expanded to names

### Width and resize

At very narrow widths the sidebar collapses to a compact layout; at widths below 92 columns it hides entirely to preserve the main viewport. Press `Ctrl+Shift+R` to enter temporary Resize mode, then use arrow keys to adjust the width, `Enter` to accept, `Escape` to restore the previous width. You can also drag the divider with the mouse while in Resize mode.

### Contributing panels

Other extensions can publish structured panels through the public contribution channel `pi-status:sidebar-panels`. Panel IDs must be namespaced (`vendor:name`). Newly registered contributions are hidden by default — add them via the Sidebar tab to make them appear.

## Upgrade Notes For 0.3.x Users

If you are upgrading from `0.3.x`, note these compatibility changes:

- `/statusline` is the sole dashboard command; former `tools`, `session`, `notifications`, and `preset` arguments are no longer accepted.
- The dashboard is a six-tab overlay: Statusbar, Sidebar, Statuses, Session, Tools, Settings.
- Configuration lives in the global extension-owned `<Pi agent directory>/extensions/statusline.json`. Pi `settings.json` values are ignored and not migrated automatically.
- Per-tool sidebar rows replace the old global tool-name switch and default to disabled.
- Several new opt-in segments are available: `workspace-pulse`, `turn-progress`, `response-performance`, `cache-read-tokens`, `cache-write-tokens`, `cache-hit`, `session-cost`, `access-type`.
- The tested Pi host baseline is now `@earendil-works/pi-coding-agent@0.84.1` and `@earendil-works/pi-tui@0.84.1`.
- The extension requires Node.js `>=24.15.0`.

## Development & Verification

```bash
pnpm install
pnpm check
pnpm run pack:dry-run
pnpm run release:check
```

## Acknowledgements

The sidebar is a port of [`pi-atelier`](https://github.com/michaelmjhhhh/pi-atelier)'s sidebar (`d78f1d1`), including the split-pane controller, palette, and overall layout model. Built on the public Pi APIs exported from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT. See [`LICENSE`](LICENSE).
