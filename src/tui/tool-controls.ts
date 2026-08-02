import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export function toggleLiveTool(pi: ExtensionAPI, changedName: string, enabled: boolean) {
  const tools = readToolSnapshot(pi);
  if (!tools.some(({ name }) => name === changedName)) return { type: "ignore" as const, tools };
  const next = tools.map((tool) => (tool.name === changedName ? { ...tool, enabled } : tool));
  if (!next.some((tool) => tool.enabled)) return { type: "reject-last-active" as const };
  pi.setActiveTools(next.filter((tool) => tool.enabled).map(({ name }) => name));
  return { type: "applied" as const, tools: next };
}
