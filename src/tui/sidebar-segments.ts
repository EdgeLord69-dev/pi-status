// Resolved, data-only sidebar segment catalog. Every entry is independently
// fault-isolated and free of themes, callbacks, and registry objects.

import {
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type NormalizedTodo,
  type SidebarCatalogEntry,
  type SidebarMetricContent,
  type SidebarPanelId,
  type SidebarSegmentContent,
  type SidebarSegmentRole,
  type SidebarSegmentSpan,
} from "../shared/types.ts";
import {
  sidebarAnonymousContributionSegmentId,
  sidebarContributionSegmentId,
  sidebarStatusSegmentId,
  sidebarTodoSegmentId,
  sidebarToolSegmentId,
} from "../core/sidebar-layout.ts";
import { formatActivityDuration, formatTtft } from "./formatters.ts";
import { formatCompactNumber } from "./render-utils.ts";
import { sanitizeSidebarPanelText } from "./sidebar-panels.ts";
import type { SidebarSnapshot } from "./sidebar-render.ts";

const UNAVAILABLE_TEXT = "—";
const CONTEXT_METER_WIDTH = 10;

type SpanInput = readonly [text: string, role: SidebarSegmentRole];

function spans(...parts: readonly SpanInput[]): SidebarSegmentSpan[] {
  return parts.map(([text, role]) => ({ text, role }));
}

function metric(
  value: SidebarSegmentSpan[],
  pairKey: string,
  extra: { unavailable?: boolean; collapseUnavailableKey?: string } = {},
): SidebarMetricContent {
  return {
    kind: "metric",
    value,
    pairKey,
    ...(extra.unavailable ? { unavailable: true } : {}),
    ...(extra.collapseUnavailableKey !== undefined
      ? { collapseUnavailableKey: extra.collapseUnavailableKey }
      : {}),
  };
}

function block(...rows: SidebarSegmentSpan[][]): SidebarSegmentContent {
  return { kind: "block", rows };
}

function text(value: string): string {
  return sanitizeSidebarPanelText(value, 160);
}

/** Metadata for one catalog entry before its content is resolved. */
interface SegmentDefinition {
  id: string;
  label: string;
  description: string;
  defaultPanelId: SidebarPanelId;
  persistence?: SidebarCatalogEntry["persistence"];
  defaultEnabled?: boolean;
  requiresWorkspacePulse?: boolean;
  priority?: SidebarCatalogEntry["priority"];
  dropOrder?: number;
  resolve: () => SidebarSegmentContent | null;
}

function resolveEntry(definition: SegmentDefinition): SidebarCatalogEntry {
  const base = {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    defaultPanelId: definition.defaultPanelId,
    persistence: definition.persistence ?? "stable",
    defaultEnabled: definition.defaultEnabled ?? true,
    requiresWorkspacePulse: definition.requiresWorkspacePulse ?? false,
    priority: definition.priority ?? "normal",
    dropOrder: definition.dropOrder ?? 100,
  } satisfies Omit<SidebarCatalogEntry, "available" | "content">;
  try {
    return { ...base, available: true, content: definition.resolve() };
  } catch {
    // One bad source never removes the segment from the editor.
    return { ...base, available: false, content: null };
  }
}

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function countedMetric(
  value: number | undefined,
  unit: string,
  role: SidebarSegmentRole,
  pairKey: string,
): SidebarSegmentContent | null {
  const amount = positive(value);
  if (amount === undefined) return null;
  return metric(spans([formatCompactNumber(amount), role], [` ${unit}`, "muted"]), pairKey);
}

function remainingPercent(usedPercent: number): number {
  return Math.min(100, Math.max(0, 100 - Math.round(usedPercent)));
}

function resetText(resetAt: number | undefined): string {
  if (!resetAt) return "";
  const remaining = Math.max(0, resetAt - Date.now());
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (days > 0) return ` ${days}d${hours}hr`;
  if (hours > 0) return ` ${hours}hr${minutes}min`;
  return ` ${minutes}m`;
}

function agentSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  return [
    {
      id: "builtin:model",
      label: "Model",
      description: "Active model name.",
      defaultPanelId: "agent",
      priority: "required",
      resolve: () => metric(spans([text(snapshot.modelLabel), "primary"]), "agent-identity"),
    },
    {
      id: "builtin:thinking",
      label: "Thinking",
      description: "Configured reasoning level.",
      defaultPanelId: "agent",
      priority: "important",
      resolve: () => {
        const level = text(snapshot.thinkingLevel);
        return level && level !== "off"
          ? metric(spans([level.toUpperCase(), "primary"]), "agent-identity")
          : metric(spans(["Off", "dim"]), "agent-identity");
      },
    },
    {
      id: "builtin:provider",
      label: "Provider",
      description: "Model provider.",
      defaultPanelId: "agent",
      dropOrder: 60,
      resolve: () =>
        snapshot.provider
          ? metric(spans([text(snapshot.provider).toUpperCase(), "muted"]), "agent-meta")
          : metric(spans([UNAVAILABLE_TEXT, "dim"]), "agent-meta", {
              unavailable: true,
              collapseUnavailableKey: "agent-meta",
            }),
    },
    {
      id: "builtin:access",
      label: "Access",
      description: "Subscription or metered access.",
      defaultPanelId: "agent",
      dropOrder: 61,
      resolve: () =>
        snapshot.accessType
          ? metric(
              spans([
                snapshot.accessType.toUpperCase(),
                snapshot.accessType === "subscription" ? "ready" : "muted",
              ]),
              "agent-meta",
            )
          : metric(spans([UNAVAILABLE_TEXT, "dim"]), "agent-meta", {
              unavailable: true,
              collapseUnavailableKey: "agent-meta",
            }),
    },
  ];
}

function activitySegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  const activity = snapshot.activity;
  return [
    {
      id: "builtin:run-state",
      label: "Run state",
      description: "Ready, Queued, or Working.",
      defaultPanelId: "activity",
      priority: "required",
      resolve: () => {
        const state =
          snapshot.runState === "idle"
            ? (["Ready", "ready"] as const)
            : snapshot.runState === "queued"
              ? (["Queued", "warning"] as const)
              : (["Working", "working"] as const);
        return metric(spans([state[0], state[1]]), "run");
      },
    },
    {
      id: "builtin:run-timing",
      label: "Run timing",
      description: "Elapsed time for the active run.",
      defaultPanelId: "activity",
      priority: "optional",
      dropOrder: 40,
      resolve: () =>
        activity && activity.run.status !== "idle"
          ? metric(
              spans(
                ["Run ", "muted"],
                [formatActivityDuration(activity.run.durationMs), "primary"],
              ),
              "activity-timing",
            )
          : null,
    },
    {
      id: "builtin:turn-progress",
      label: "Turn progress",
      description: "Current turn number and elapsed time.",
      defaultPanelId: "activity",
      priority: "optional",
      dropOrder: 50,
      resolve: () =>
        activity && activity.turn.status !== "idle" && activity.turn.number > 0
          ? metric(
              spans(
                [`Turn ${activity.turn.number} `, "muted"],
                [formatActivityDuration(activity.turn.durationMs), "primary"],
              ),
              "activity-timing",
            )
          : null,
    },
    {
      id: "builtin:response-performance",
      label: "Response performance",
      description: "Time to first token and token rate.",
      defaultPanelId: "activity",
      priority: "optional",
      dropOrder: 30,
      resolve: () => {
        const response = activity?.response;
        if (!response || response.status === "idle" || response.ttftMs === undefined) return null;
        const ttft = spans([`TTFT ${formatTtft(response.ttftMs)}`, "output"]);
        if (response.tps === undefined || !Number.isFinite(response.tps))
          return metric(ttft, "activity-response");
        const estimate = response.tokenCountKind === "estimated" ? "~" : "";
        return metric(
          [
            ...ttft,
            ...spans([" · ", "dim"], [`${estimate}${response.tps.toFixed(1)} tok/s`, "output"]),
          ],
          "activity-response",
        );
      },
    },
    {
      id: "builtin:tool-outcomes",
      label: "Tool outcomes",
      description: "Completed and failed tool calls.",
      defaultPanelId: "activity",
      priority: "optional",
      dropOrder: 20,
      resolve: () => {
        const done = positive(activity?.completedToolCount);
        const failed = positive(activity?.failedToolCount);
        if (done === undefined && failed === undefined) return null;
        const parts: SidebarSegmentSpan[] = [];
        if (done !== undefined) parts.push(...spans([`${done} done`, "ready"]));
        if (failed !== undefined) {
          if (parts.length > 0) parts.push(...spans([" · ", "dim"]));
          parts.push(...spans([`${failed} failed`, "error"]));
        }
        return metric(parts, "activity-outcomes");
      },
    },
    {
      id: "builtin:recent-tools",
      label: "Recent tool",
      description: "Latest completed tool call and its duration.",
      defaultPanelId: "activity",
      priority: "optional",
      dropOrder: 10,
      resolve: () => {
        const recent = activity?.recentTools[0];
        return recent
          ? metric(
              spans(
                [text(recent.name), "primary"],
                [` ${formatActivityDuration(recent.durationMs)}`, "muted"],
              ),
              "activity-recent",
            )
          : null;
      },
    },
  ];
}

function contextSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  const tokens = snapshot.contextTokens;
  const window = snapshot.contextWindow;
  const percent = snapshot.contextPercent;
  const complete = tokens !== undefined && window !== undefined && percent !== undefined;
  return [
    {
      id: "builtin:context-used",
      label: "Context used",
      description: "Tokens consumed by the current context.",
      defaultPanelId: "context",
      priority: "required",
      resolve: () =>
        complete
          ? metric(
              spans([formatCompactNumber(tokens), "context"], [" used", "muted"]),
              "context-usage",
            )
          : metric(spans([UNAVAILABLE_TEXT, "dim"], [" used", "dim"]), "context-usage", {
              unavailable: true,
            }),
    },
    {
      id: "builtin:context-remaining",
      label: "Context left",
      description: "Tokens still available in the context window.",
      defaultPanelId: "context",
      priority: "required",
      resolve: () =>
        complete
          ? metric(
              spans(
                [formatCompactNumber(Math.max(0, window - tokens)), "context"],
                [" left", "muted"],
              ),
              "context-usage",
            )
          : metric(spans([UNAVAILABLE_TEXT, "dim"], [" left", "dim"]), "context-usage", {
              unavailable: true,
            }),
    },
    {
      id: "builtin:context-meter",
      label: "Context meter",
      description: "Proportional context usage bar.",
      defaultPanelId: "context",
      priority: "important",
      dropOrder: 90,
      resolve: () => {
        if (!complete) return null;
        const role: SidebarSegmentRole =
          percent >= 80 ? "error" : percent >= 60 ? "warning" : "context";
        const filled = Math.min(
          CONTEXT_METER_WIDTH,
          Math.max(0, Math.round((percent / 100) * CONTEXT_METER_WIDTH)),
        );
        return block(
          spans(
            ["[", "dim"],
            ["■".repeat(filled), role],
            ["·".repeat(CONTEXT_METER_WIDTH - filled), "dim"],
            ["] ", "dim"],
            [`${Math.round(percent)}%`, role],
          ),
        );
      },
    },
  ];
}

function workspaceSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  const pulse = snapshot.pulse;
  return [
    {
      id: "builtin:project",
      label: "Project",
      description: "Repository or working directory name.",
      defaultPanelId: "workspace",
      priority: "important",
      dropOrder: 80,
      resolve: () => metric(spans([text(snapshot.projectName), "primary"]), "workspace-identity"),
    },
    {
      id: "builtin:directory",
      label: "Directory",
      description: "Working directory relative to the repository root.",
      defaultPanelId: "workspace",
      priority: "optional",
      dropOrder: 5,
      requiresWorkspacePulse: true,
      resolve: () =>
        pulse?.relativeCwd
          ? metric(spans([`./${text(pulse.relativeCwd)}`, "muted"]), "workspace-location")
          : null,
    },
    {
      id: "builtin:branch",
      label: "Branch",
      description: "Checked-out Git branch.",
      defaultPanelId: "workspace",
      dropOrder: 70,
      requiresWorkspacePulse: true,
      resolve: () =>
        pulse?.branch ? metric(spans([text(pulse.branch), "accent"]), "workspace-identity") : null,
    },
    {
      id: "builtin:changes",
      label: "Changes",
      description: "Staged and unstaged file counts.",
      defaultPanelId: "workspace",
      priority: "optional",
      dropOrder: 35,
      requiresWorkspacePulse: true,
      resolve: () => {
        const staged = positive(pulse?.staged);
        const unstaged = positive(pulse?.unstaged);
        if (staged === undefined && unstaged === undefined) return null;
        const parts: SidebarSegmentSpan[] = [];
        if (staged !== undefined) parts.push(...spans([`${staged} staged`, "ready"]));
        if (unstaged !== undefined) {
          if (parts.length > 0) parts.push(...spans([" · ", "dim"]));
          parts.push(...spans([`${unstaged} unstaged`, "warning"]));
        }
        return metric(parts, "workspace-changes");
      },
    },
    {
      id: "builtin:sync-state",
      label: "Sync state",
      description: "Commits ahead of and behind the upstream branch.",
      defaultPanelId: "workspace",
      priority: "optional",
      dropOrder: 25,
      requiresWorkspacePulse: true,
      resolve: () => {
        const ahead = positive(pulse?.ahead);
        const behind = positive(pulse?.behind);
        if (ahead === undefined && behind === undefined) return null;
        const parts: SidebarSegmentSpan[] = [];
        if (ahead !== undefined) parts.push(...spans([`↑${ahead}`, "ready"]));
        if (behind !== undefined) {
          if (parts.length > 0) parts.push(...spans([" ", "dim"]));
          parts.push(...spans([`↓${behind}`, "warning"]));
        }
        return metric(parts, "workspace-sync");
      },
    },
    {
      id: "builtin:session-identity",
      label: "Session",
      description: "Session name, or its ID when unnamed.",
      defaultPanelId: "workspace",
      priority: "optional",
      dropOrder: 45,
      resolve: () => {
        const name = snapshot.sessionName ? text(snapshot.sessionName) : "";
        if (name) return metric(spans([name, "primary"]), "workspace-session");
        return snapshot.sessionId
          ? metric(spans([`sid ${text(snapshot.sessionId).slice(0, 8)}`, "muted"]), "session-meta")
          : null;
      },
    },
    {
      id: "builtin:entry-count",
      label: "Entries",
      description: "Entries recorded on the current branch.",
      defaultPanelId: "workspace",
      priority: "optional",
      dropOrder: 15,
      resolve: () =>
        metric(
          spans(
            [String(Math.max(0, Math.trunc(snapshot.branchEntryCount))), "primary"],
            [" entries", "muted"],
          ),
          "session-meta",
        ),
    },
    {
      id: "builtin:persistence",
      label: "Persistence",
      description: "Whether the session is written to disk.",
      defaultPanelId: "workspace",
      priority: "optional",
      dropOrder: 16,
      resolve: () =>
        metric(
          spans([
            snapshot.persisted ? "Persisted" : "Ephemeral",
            snapshot.persisted ? "ready" : "muted",
          ]),
          "session-meta",
        ),
    },
  ];
}

function usageSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  const metrics = snapshot.sessionMetrics;
  return [
    {
      id: "builtin:usage-5h",
      label: "5h limit",
      description: "Remaining share of the five-hour rate window.",
      defaultPanelId: "usage",
      priority: "important",
      dropOrder: 75,
      resolve: () =>
        snapshot.fiveHourPercent === undefined
          ? null
          : metric(
              spans(
                ["5h ", "muted"],
                [
                  `${remainingPercent(snapshot.fiveHourPercent)}%${resetText(snapshot.fiveHourResetAt)}`,
                  "cost",
                ],
                [" left", "muted"],
              ),
              "usage-limits",
            ),
    },
    {
      id: "builtin:usage-weekly",
      label: "Weekly limit",
      description: "Remaining share of the weekly rate window.",
      defaultPanelId: "usage",
      priority: "important",
      dropOrder: 74,
      resolve: () =>
        snapshot.weeklyPercent === undefined
          ? null
          : metric(
              spans(
                ["wk ", "muted"],
                [
                  `${remainingPercent(snapshot.weeklyPercent)}%${resetText(snapshot.weeklyResetAt)}`,
                  "cost",
                ],
                [" left", "muted"],
              ),
              "usage-limits",
            ),
    },
    {
      id: "builtin:usage-reset",
      label: "Resets available",
      description: "Available banked usage resets (run /codex-reset to redeem one).",
      defaultPanelId: "usage",
      priority: "important",
      dropOrder: 76,
      resolve: () => {
        const count = snapshot.resetCreditsAvailable ?? 0;
        if (count <= 0) return null;
        return metric(
          spans([`${count} reset${count === 1 ? "" : "s"} available`, "warning"]),
          "usage-reset",
        );
      },
    },
    {
      id: "builtin:total-tokens",
      label: "Total tokens",
      description: "Tokens billed for this session.",
      defaultPanelId: "usage",
      priority: "optional",
      dropOrder: 55,
      resolve: () => countedMetric(metrics?.totalTokens, "tokens", "primary", "usage-totals"),
    },
    {
      id: "builtin:cost",
      label: "Cost",
      description: "Estimated session cost.",
      defaultPanelId: "usage",
      priority: "optional",
      dropOrder: 56,
      resolve: () => {
        const cost = metrics?.costUsd;
        if (cost === undefined || !Number.isFinite(cost)) return null;
        return metric(spans([`$${cost.toFixed(cost < 1 ? 4 : 2)}`, "cost"]), "usage-totals");
      },
    },
    {
      id: "builtin:input",
      label: "Input tokens",
      description: "Prompt tokens sent this session.",
      defaultPanelId: "usage",
      priority: "optional",
      dropOrder: 22,
      resolve: () => countedMetric(metrics?.inputTokens, "input", "input", "usage-io"),
    },
    {
      id: "builtin:output",
      label: "Output tokens",
      description: "Completion tokens received this session.",
      defaultPanelId: "usage",
      priority: "optional",
      dropOrder: 23,
      resolve: () => countedMetric(metrics?.outputTokens, "output", "output", "usage-io"),
    },
    {
      id: "builtin:cache-read",
      label: "Cache read",
      description: "Tokens served from the prompt cache.",
      defaultPanelId: "usage",
      priority: "optional",
      dropOrder: 12,
      resolve: () => countedMetric(metrics?.cacheReadTokens, "cache read", "cache", "usage-cache"),
    },
    {
      id: "builtin:cache-write",
      label: "Cache write",
      description: "Tokens written into the prompt cache.",
      defaultPanelId: "usage",
      priority: "optional",
      dropOrder: 13,
      resolve: () =>
        countedMetric(metrics?.cacheWriteTokens, "cache write", "cache", "usage-cache"),
    },
    {
      id: "builtin:cache-hit",
      label: "Cache hit",
      description: "Share of the latest request served from cache.",
      defaultPanelId: "usage",
      priority: "optional",
      dropOrder: 14,
      resolve: () => {
        const hit = metrics?.latestCacheHitPercent;
        if (hit === undefined || !Number.isFinite(hit)) return null;
        return metric(
          spans([`${Math.round(hit)}%`, "cache"], [" cache hit", "muted"]),
          "usage-cache",
        );
      },
    },
  ];
}

function toolsSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  return [
    {
      id: "builtin:active-tool-count",
      label: "Active tools",
      description: "Live tool calls against configured tool definitions.",
      defaultPanelId: "tools",
      priority: "optional",
      dropOrder: 18,
      resolve: () =>
        metric(
          spans(
            [`${snapshot.activity?.activeTools.length ?? 0} active`, "primary"],
            [" · ", "dim"],
            [`${snapshot.availableToolNames.length} available`, "muted"],
          ),
          "tools-count",
        ),
    },
  ];
}

function todoCheck(todo: NormalizedTodo): SpanInput {
  if (todo.status === "completed") return ["✓", "ready"];
  return todo.status === "in_progress" ? ["◐", "warning"] : ["○", "dim"];
}

function todosSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  return [
    {
      id: "builtin:todos-progress",
      label: "Todos progress",
      description: "Completed share of the current TODO list.",
      defaultPanelId: "todos",
      priority: "optional",
      dropOrder: 65,
      resolve: () => {
        if (snapshot.todos.length === 0) return null;
        const done = snapshot.todos.filter((todo) => todo.status === "completed").length;
        return metric(
          spans([`${done}/${snapshot.todos.length}`, "accent"], [" todos", "muted"]),
          "todos",
        );
      },
    },
  ];
}

function statusSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  const definitions: SegmentDefinition[] = [];
  const push = (
    entry: { key: string; text: string },
    panelId: SidebarPanelId,
    marker: SpanInput,
  ): void => {
    const id = sidebarStatusSegmentId(entry.key);
    if (id === undefined) return;
    definitions.push({
      id,
      label: text(entry.key),
      description: "Status published by another extension.",
      defaultPanelId: panelId,
      priority: panelId === "alerts" ? "important" : "optional",
      dropOrder: panelId === "alerts" ? 85 : 28,
      resolve: () =>
        block(spans(marker, [` ${text(entry.text)}`, panelId === "alerts" ? marker[1] : "muted"])),
    });
  };
  for (const alert of snapshot.alerts) {
    push(
      alert,
      "alerts",
      /\b(error|failed?|failure|offline|unavailable)\b/i.test(alert.text)
        ? ["✕", "error"]
        : ["▲", "warning"],
    );
  }
  for (const status of snapshot.statuses) push(status, "statuses", ["•", "muted"]);
  return definitions;
}

function toolNameSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  const definitions: SegmentDefinition[] = [];
  for (const name of snapshot.availableToolNames) {
    const id = sidebarToolSegmentId(name);
    if (id === undefined) continue;
    definitions.push({
      id,
      label: text(name),
      description: "Configured tool; shows live calls while it runs.",
      defaultPanelId: "tools",
      defaultEnabled: false,
      priority: "optional",
      dropOrder: 8,
      resolve: () => {
        const calls = (snapshot.activity?.activeTools ?? []).filter(
          (tool) => tool.name === name,
        ).length;
        if (calls === 0) return null;
        return metric(
          calls > 1
            ? spans([text(name), "primary"], [` ×${calls}`, "muted"])
            : spans([text(name), "primary"]),
          "tool-call",
        );
      },
    });
  }
  return definitions;
}

function todoRowSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  return snapshot.todos.map((todo) => ({
    id: sidebarTodoSegmentId(todo.id),
    label: text(todo.text),
    description: "One TODO row for this session.",
    defaultPanelId: "todos" as SidebarPanelId,
    persistence: "session" as const,
    priority: "optional" as const,
    dropOrder: 26,
    resolve: () =>
      block(
        spans(
          todoCheck(todo),
          [` #${todo.id} `, "accent"],
          [text(todo.text), todo.status === "completed" ? "dim" : "primary"],
        ),
      ),
  }));
}

function contributionSegments(snapshot: SidebarSnapshot): SegmentDefinition[] {
  const definitions: SegmentDefinition[] = [];
  for (const panel of snapshot.sidebarPanels) {
    panel.rows.forEach((row, index) => {
      const explicitId =
        typeof row.id === "string" ? sidebarContributionSegmentId(panel.id, row.id) : undefined;
      const id =
        explicitId ?? sidebarAnonymousContributionSegmentId(panel.id, panel.generation, index);
      definitions.push({
        id,
        label: text(panel.title),
        description: `Row contributed by ${text(panel.source)}.`,
        defaultPanelId: panel.id,
        persistence: explicitId === undefined ? "session" : "stable",
        priority: "optional",
        dropOrder: 24,
        resolve: () => block(spans([text(row.text), row.role ?? panel.role ?? "primary"])),
      });
    });
  }
  return definitions;
}

/** Build the resolved catalog for one snapshot in canonical order. */
export function buildSidebarSegmentCatalog(
  snapshot: SidebarSnapshot,
): readonly SidebarCatalogEntry[] {
  const builtins: Record<string, SegmentDefinition[]> = {
    agent: agentSegments(snapshot),
    activity: activitySegments(snapshot),
    context: contextSegments(snapshot),
    workspace: workspaceSegments(snapshot),
    usage: usageSegments(snapshot),
    tools: toolsSegments(snapshot),
    alerts: [],
    statuses: [],
    todos: todosSegments(snapshot),
  };
  const definitions: SegmentDefinition[] = [];
  for (const panelId of Object.keys(SIDEBAR_BUILTIN_ASSIGNMENTS)) {
    definitions.push(...(builtins[panelId] ?? []));
  }
  definitions.push(
    ...statusSegments(snapshot),
    ...toolNameSegments(snapshot),
    ...todoRowSegments(snapshot),
    ...contributionSegments(snapshot),
  );
  return definitions.map(resolveEntry);
}
