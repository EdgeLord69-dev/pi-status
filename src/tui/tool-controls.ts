import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";

// ── Pure transition validator ─────────────────────────────────────────────────

type ToolChange =
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

export interface DashboardTool {
  name: string;
  description: string;
  enabled: boolean;
}

export function readToolSnapshot(pi: ExtensionAPI): DashboardTool[] {
  const catalog = pi.getAllTools();
  if (catalog.length === 0) return [];
  const validNames = new Set(catalog.map(({ name }) => name));
  const activeNames = new Set(pi.getActiveTools().filter((name) => validNames.has(name)));
  return catalog.map(({ name, description }) => ({
    name,
    description,
    enabled: activeNames.has(name),
  }));
}

export type LiveToolToggle =
  | { type: "applied"; tools: DashboardTool[] }
  | { type: "ignore"; tools: DashboardTool[] }
  | { type: "reject-last-active" };

export function toggleLiveTool(
  pi: ExtensionAPI,
  changedName: string,
  enabled: boolean,
): LiveToolToggle {
  const tools = readToolSnapshot(pi);
  const change = calculateToolChange(
    tools.map(({ name }) => name),
    tools.filter((tool) => tool.enabled).map(({ name }) => name),
    changedName,
    enabled ? "enabled" : "disabled",
  );
  if (change.type === "reject-last-active") return change;
  if (change.type === "ignore") return { type: "ignore", tools };

  pi.setActiveTools(change.names);
  const activeNames = new Set(change.names);
  return {
    type: "applied",
    tools: tools.map((tool) => ({ ...tool, enabled: activeNames.has(tool.name) })),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warn(ctx: ExtensionCommandContext, message: string): void {
  try {
    ctx.ui.notify(message, "warning");
  } catch {}
}

// ── Overlay entry point ──────────────────────────────────────────────────────

export async function openToolControls(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    warn(ctx, "/statusline tools requires interactive TUI");
    return;
  }

  let initialTools: DashboardTool[];
  try {
    initialTools = readToolSnapshot(pi);
  } catch (err) {
    warn(ctx, `Could not load Pi tools: ${errorText(err)}`);
    return;
  }

  if (initialTools.length === 0) {
    warn(ctx, "No tools are available");
    return;
  }

  const allTools = initialTools.map(({ name, description }) => ({ name, description }));
  const initialActiveNames = initialTools.filter(({ enabled }) => enabled).map(({ name }) => name);

  const items: SettingItem[] = allTools.map((t) => ({
    id: t.name,
    label: t.name,
    description: t.description,
    currentValue: initialActiveNames.includes(t.name) ? "enabled" : "disabled",
    values: ["enabled", "disabled"],
  }));

  try {
    await ctx.ui.custom<void>(
      (tui, _theme, _kb, done) => {
        let settingsList: SettingsList;
        let confirmedActiveNames = [...initialActiveNames];

        const syncRows = (activeNames: readonly string[]) => {
          confirmedActiveNames = [...activeNames];
          for (const item of items) {
            settingsList.updateValue(
              item.id,
              activeNames.includes(item.id) ? "enabled" : "disabled",
            );
          }
        };

        settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 16),
          getSettingsListTheme(),
          (changedName, value) => {
            let currentCatalog: string[];
            let currentActive: string[];
            try {
              currentCatalog = pi.getAllTools().map((t) => t.name);
              currentActive = pi.getActiveTools().filter((name) => currentCatalog.includes(name));
            } catch (err) {
              syncRows(confirmedActiveNames);
              warn(ctx, `Could not refresh Pi tools: ${errorText(err)}`);
              return;
            }

            const change = calculateToolChange(currentCatalog, currentActive, changedName, value);

            if (change.type === "ignore") {
              syncRows(currentActive);
              return;
            }

            if (change.type === "reject-last-active") {
              syncRows(currentActive);
              warn(ctx, "At least one tool must remain active");
              return;
            }

            try {
              pi.setActiveTools(change.names);
            } catch (err) {
              syncRows(currentActive);
              warn(ctx, `Could not update Pi tools: ${errorText(err)}`);
              return;
            }
            syncRows(change.names);
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
    warn(ctx, `Could not open tool controls: ${errorText(err)}`);
  }
}
