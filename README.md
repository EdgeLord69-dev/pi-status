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

Once installed, the footer updates automatically.

- Run `/statusline` inside Pi to open the interactive editor.
- Run `/statusline tools` to search and toggle Pi's currently available tools in a centered overlay. Valid changes apply to the session immediately, and the control will not disable the final active tool.
- Run `/statusline session` to view the current session name, ID, file, directory, and model.
- From the session menu, rename the current session or compact it after an explicit confirmation.
- Run `/statusline notifications [on|off]` to toggle opt-in native completion notifications on macOS and Windows.
- Run `/statusline preset [minimal|balanced|telemetry]` to choose a curated four-zone layout from a selector and confirm it before it is persisted.
- Use `Tab` and `Shift+Tab` to select the TL, TR, BL, or BR zone.
- Toggle segments on or off with `Space`.
- Reorder segments in the active zone with `Left` and `Right`.
- Search the segment list by typing.
- Preview the footer before saving.
- Hide individual extension status keys from the "Extension statuses" section.
- Save changes and reuse them the next time Pi starts.

While the editor is open, the live footer is temporarily hidden so the inline UI can use the full width cleanly.

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

## Session Actions

`/statusline session` uses Pi's current-session APIs. Renaming updates the current Pi session name, and compaction starts only after you confirm the prompt. These actions do not add pi-status settings or change the behavior of plain `/statusline`.

## Tool Controls

`/statusline tools` opens a centered searchable overlay that lists every tool Pi currently knows about, regardless of source. Each row shows the tool name and its current enabled/disabled state. Press `Enter` or `Space` to toggle a tool. Type to filter by name. Press `Esc` to close the overlay; changes made before closing remain active for the session.

- Rows include extension-provided tools alongside Pi's built-in tools.
- Valid changes apply to the session immediately and are session-scoped; they do not persist.
- Stale or unknown tool names (removed by another extension) are ignored during reconciliation.
- The final valid active tool cannot be disabled; the control restores the row and warns instead.
- An externally empty host active set stays empty until a row is explicitly enabled.
- No tool choices are persisted and no second settings framework is added.
- Plain `/statusline` (no argument) continues to open the footer segment editor.

## Display Presets

`/statusline preset [minimal|balanced|telemetry]` picks one of three curated four-zone layouts. The command shows the four-row preview as the confirmation message, writes the chosen layout to `<Pi agent directory>/extensions/statusline.json` only after you confirm, and updates the live footer in the same step. Cancellation at either prompt is silent and changes nothing.

- `/statusline preset` opens a selector titled `Choose display preset`; the choices are `minimal`, `balanced`, and `telemetry`. Cancelling the selector leaves every config field untouched.
- `/statusline preset minimal|balanced|telemetry` skips the selector. An unknown name or extra tokens show `Usage: /statusline preset [minimal|balanced|telemetry]`.
- Each preset replaces every segment in all four zones. The preview lists the exact IDs that will be written, with `—` for empty zones. Segments whose backing data is unavailable render blank until their source has data.
- Persistence path: `<Pi agent directory>/extensions/statusline.json` (overridable via `$PI_CODING_AGENT_DIR`). Other config fields—the completion-notification preference and extension-status hidden list—are preserved unchanged.

### Preset Layouts

`minimal`

```text
Top Left: model-with-reasoning
Top Right: —
Bottom Left: current-dir
Bottom Right: —
```

`balanced`

```text
Top Left: model-with-reasoning · run-state
Top Right: context-remaining
Bottom Left: current-dir · git-branch
Bottom Right: five-hour-limit · weekly-limit
```

`telemetry`

```text
Top Left: model-with-reasoning · run-state · turn-progress · response-performance
Top Right: context-used · context-remaining
Bottom Left: —
Bottom Right: total-input-tokens · total-output-tokens · cache-read-tokens · cache-write-tokens · cache-hit · session-cost · access-type · five-hour-limit · weekly-limit
```

Presets only change zone membership and order. They never modify your model, thinking level, tool selection, completion-notification preference, session identity, Git state, or workspace state.

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

`/statusline notifications [on|off]` toggles an opt-in, global preference for
bounded, best-effort native system notifications when a TUI agent run settles
or `@pi-vault/pi-questionnaire` enters its wait state.

- `/statusline notifications` reports the current state.
- `/statusline notifications on` enables completion notifications.
- `/statusline notifications off` disables them.
- `/statusline notifications maybe` (or any other arguments) reports
  `Usage: /statusline notifications [on|off]`.

The preference is global-only, off by default, and lives in the same
`extensions/statusline.json` file. There is no per-project or per-session
override.

The authoritative settlement signal is Pi's public `agent_settled` event. The
extension does not infer completion from `agent_end`, `turn_end`, assistant
text, or tool completion. When `@pi-vault/pi-questionnaire` is installed, the
extension also subscribes to its literal
`pi-vault:questionnaire:status` event and notifies once per false-to-true
interval; the event label is ignored, so prompts, answers, and other content
are never included in the notification body.

macOS and Windows receive best-effort native delivery through `/usr/bin/osascript`
or hidden `powershell.exe`. The notification text is fixed: `Pi finished` /
`The current run has settled.` on settlement, and `Pi needs input` /
`A questionnaire is waiting for you.` while a questionnaire is active. Notification
text is always passed through argv (macOS) or child-only environment variables
named `PI_STATUS_NOTIFICATION_TITLE` and `PI_STATUS_NOTIFICATION_BODY`
(Windows); no shell interpolation is used. Native processes are detached,
time-bounded, and fail silently if the OS rejects them. Other platforms and
RPC/print contexts do not receive notifications. Settings are updated
independently of the editor; failed writes leave both runtime state and the
notifier unchanged.

## Upgrade Notes For 0.2.x Users

If you are upgrading from `0.2.x`, note these compatibility changes:

- `context-window-size` and `extension-statuses` are no longer supported segment IDs.
- Existing configs that still mention removed IDs are normalized by dropping those unsupported entries.
- Extension status visibility now comes from per-key hidden status settings instead of a dedicated `extension-statuses` segment.
- Configuration now has a hard cutover to the global extension-owned `extensions/statusline.json` file; Pi `settings.json` values are ignored and not migrated automatically.
- The extension requires Node.js `>=24.15.0`.
- The tested Pi host baseline is now `@earendil-works/pi-coding-agent@0.82.0` and `@earendil-works/pi-tui@0.82.1`.

## Development And Verification

```bash
pnpm install
pnpm check
pnpm run pack:dry-run
```

## License

MIT
