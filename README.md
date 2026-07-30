# @pi-vault/pi-status

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-status)](https://www.npmjs.com/package/@pi-vault/pi-status)
[![Quality](https://github.com/pi-vault/pi-status/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-status/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Replace Pi's default footer with a compact, configurable status line that shows the session details you actually care about. `@pi-vault/pi-status` installs a live footer, adds `/statusline` for interactive configuration, and optionally surfaces usage-backed limits through [`@pi-vault/pi-usage`](https://www.npmjs.com/package/@pi-vault/pi-usage).

Default footer:

```text
model-with-reasoning · current-dir
```

## Screenshots

Default status line rendering:

![Status line UI](docs/assets/statusline-ui.png)

Interactive configuration editor (`/statusline`):

![Status line configuration](docs/assets/statusline-configuration.png)

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
- Toggle segments on or off with `Space`.
- Reorder enabled segments with `Left` and `Right`.
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
- `run-state`
- `context-remaining`
- `context-used`
- `used-tokens`
- `total-input-tokens`
- `total-output-tokens`
- `session-id`
- `five-hour-limit`
- `weekly-limit`

`five-hour-limit` and `weekly-limit` depend on standalone [`@pi-vault/pi-usage`](https://www.npmjs.com/package/@pi-vault/pi-usage). `/statusline` shows those segments after `pi-usage` responds, and the live footer omits them until compatible live limit window data is available.

## Extension Status Behavior

Extension statuses are no longer configured as a normal footer segment.

- Status text reported by other Pi extensions is appended automatically when it is visible.
- `/statusline` lets you hide individual status keys.
- Hidden keys stay hidden through persisted settings.
- If no visible extension statuses remain, nothing extra is appended to the footer.

## Common Examples

Keep it minimal:

```text
model-with-reasoning · current-dir
```

Show more session detail:

```text
model · run-state · git-branch · context-used · context-remaining · session-id
```

Usage-aware footer:

```text
model-with-reasoning · current-dir · five-hour-limit · weekly-limit
```

If another extension reports status text, that text appears after your configured segments automatically, for example:

```text
model-with-reasoning · current-dir · alpha: ready
```

## Configuration Behavior

`@pi-vault/pi-status` stores one global configuration file at
`<Pi agent directory>/extensions/statusline.json`. When
`PI_CODING_AGENT_DIR` is set, the path is
`$PI_CODING_AGENT_DIR/extensions/statusline.json`; otherwise Pi supplies its
default agent directory.

The file contains the statusline config directly:

```json
{
  "segments": ["model-with-reasoning", "current-dir"],
  "extensionSegments": { "hidden": [] }
}
```

There are no project-specific overrides. pi-status no longer reads or writes
Pi's global or project `settings.json`. Existing `statusLine` values in those
files are ignored and left unchanged. To keep them, manually copy the contents
of the old `statusLine` object into `extensions/statusline.json`.

## Upgrade Notes For 0.2.x Users

If you are upgrading from `0.2.x`, note these compatibility changes:

- `context-window-size` and `extension-statuses` are no longer supported segment IDs.
- Existing configs that still mention removed IDs are normalized by dropping those unsupported entries.
- Extension status visibility now comes from per-key hidden status settings instead of a dedicated `extension-statuses` segment.
- Configuration now has a hard cutover to the global extension-owned `extensions/statusline.json` file; Pi `settings.json` values are ignored and not migrated automatically.
- The extension requires Node.js `>=24.15.0`.
- The tested Pi host baseline is now `@earendil-works/pi-coding-agent@0.82.0` and `@earendil-works/pi-tui@0.82.0`.

## Development And Verification

```bash
pnpm install
pnpm check
pnpm run pack:dry-run
```

## License

MIT
