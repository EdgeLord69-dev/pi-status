import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";

// ── Pure transition validator ─────────────────────────────────────────────────

export type ToolChange =
  | { type: "apply"; names: string[] }
  | { type: "ignore" }
  | { type: "reject-last-active" };

export function calculateToolChange(
  allNames: readonly string[],
  activeNames: readonly string[],
  changedName: string,
  value: string,
): ToolChange {
  const valid = new Set(allNames);
  if (!valid.has(changedName)) return { type: "ignore" };
  const next = new Set(activeNames.filter((name) => valid.has(name)));
  if (value === "enabled") next.add(changedName);
  else if (value === "disabled") next.delete(changedName);
  else return { type: "ignore" };
  if (next.size === 0) return { type: "reject-last-active" };
  return { type: "apply", names: allNames.filter((name) => next.has(name)) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeNotify(ctx: ExtensionCommandContext, message: string, type: "info" | "warning"): void {
  try {
    ctx.ui.notify(message, type);
  } catch {}
}

// ── Overlay entry point ──────────────────────────────────────────────────────

export async function openToolControls(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/statusline tools requires interactive TUI", "warning");
    return;
  }

  let allTools: { name: string; description?: string }[];
  try {
    allTools = pi.getAllTools();
  } catch (err) {
    safeNotify(ctx, `Could not load Pi tools: ${errorText(err)}`, "warning");
    return;
  }

  if (allTools.length === 0) {
    safeNotify(ctx, "No tools are available", "warning");
    return;
  }

  const allNames = allTools.map((t) => t.name);

  // Snapshot at open; runtime changes are re-read on every toggle.
  let activeTools: string[];
  try {
    activeTools = pi.getActiveTools();
  } catch (err) {
    safeNotify(ctx, `Could not load Pi tools: ${errorText(err)}`, "warning");
    return;
  }

  const activeSet = new Set(activeTools.filter((n) => allNames.includes(n)));

  function restoreRows() {
    for (const name of allNames) {
      settingsList.updateValue(name, activeSet.has(name) ? "enabled" : "disabled");
    }
  }

  const items: SettingItem[] = allTools.map((t) => ({
    id: t.name,
    label: t.name,
    description: t.description,
    currentValue: activeSet.has(t.name) ? "enabled" : "disabled",
    values: ["enabled", "disabled"],
  }));

  let settingsList: SettingsList;

  try {
    await ctx.ui.custom(
      (tui, _theme, _kb, done) => {
        settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 16),
          getSettingsListTheme(),
          (changedName, value) => {
            // Re-read both host lists for every toggle.
            let currentActive: string[];
            try {
              currentActive = pi.getActiveTools();
            } catch {
              restoreRows();
              return;
            }

            let currentCatalog: string[];
            try {
              currentCatalog = pi.getAllTools().map((t) => t.name);
            } catch {
              restoreRows();
              return;
            }

            const change = calculateToolChange(currentCatalog, currentActive, changedName, value);

            if (change.type === "ignore") {
              restoreRows();
              return;
            }

            if (change.type === "reject-last-active") {
              safeNotify(ctx, "At least one tool must remain active", "warning");
              restoreRows();
              return;
            }

            // apply
            try {
              pi.setActiveTools(change.names);
              activeSet.clear();
              for (const n of change.names) activeSet.add(n);
              for (const name of currentCatalog) {
                settingsList.updateValue(
                  name,
                  change.names.includes(name) ? "enabled" : "disabled",
                );
              }
            } catch (err) {
              safeNotify(ctx, `Could not apply tool change: ${errorText(err)}`, "warning");
              restoreRows();
            }
          },
          () => done(undefined),
          { enableSearch: true },
        );

        return {
          render: (width) => settingsList.render(width),
          invalidate: () => settingsList.invalidate(),
          handleInput(data) {
            settingsList.handleInput(data);
            tui.requestRender();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "70%",
          minWidth: 32,
          maxHeight: "80%",
          margin: 1,
        },
      },
    );
  } catch (err) {
    safeNotify(ctx, `Could not open tool controls: ${errorText(err)}`, "warning");
  }
}
