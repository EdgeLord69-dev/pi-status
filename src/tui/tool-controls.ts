import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export interface DashboardTool {
  name: string;
  description: string;
  enabled: boolean;
}
export function readToolSnapshot(pi: ExtensionAPI): DashboardTool[] {
  const catalog = pi.getAllTools();
  if (catalog.length === 0) return [];
  const activeNames = new Set(pi.getActiveTools());
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
    tools.filter(({ enabled }) => enabled).map(({ name }) => name),
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
