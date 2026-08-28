import { describe, expect, it, vi } from "vitest";
import {
  KNOWN_SEGMENTS,
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type SidebarCatalogEntry,
  type StatusLineSegmentId,
} from "../../src/shared/types.ts";
import type { SidebarPanelData } from "../../src/tui/sidebar-panels.ts";
import { buildSidebarSegmentCatalog } from "../../src/tui/sidebar-segments.ts";
import type { SidebarSnapshot } from "../../src/tui/sidebar-render.ts";

const CANONICAL_BUILTIN_IDS = Object.values(SIDEBAR_BUILTIN_ASSIGNMENTS).flat();

/** Every footer segment must reach at least one sidebar segment. */
const FOOTER_COVERAGE: Record<StatusLineSegmentId, string> = {
  model: "builtin:model",
  "model-with-reasoning": "builtin:thinking",
  "project-name": "builtin:project",
  "current-dir": "builtin:directory",
  "git-branch": "builtin:branch",
  "workspace-pulse": "builtin:changes",
  "run-state": "builtin:run-state",
  "context-remaining": "builtin:context-remaining",
  "context-used": "builtin:context-used",
  "used-tokens": "builtin:total-tokens",
  "total-input-tokens": "builtin:input",
  "total-output-tokens": "builtin:output",
  "session-id": "builtin:session-identity",
  "five-hour-limit": "builtin:usage-5h",
  "weekly-limit": "builtin:usage-weekly",
  "cache-read-tokens": "builtin:cache-read",
  "cache-write-tokens": "builtin:cache-write",
  "cache-hit": "builtin:cache-hit",
  "session-cost": "builtin:cost",
  "access-type": "builtin:access",
  "turn-progress": "builtin:turn-progress",
  "response-performance": "builtin:response-performance",
};

function snapshot(overrides: Partial<SidebarSnapshot> = {}): SidebarSnapshot {
  return {
    modelLabel: "claude-sonnet",
    provider: "anthropic",
    thinkingLevel: "high",
    projectName: "pi-status",
    sessionName: "release prep",
    sessionId: "abcdef1234567890",
    persisted: true,
    contextTokens: 24_300,
    contextWindow: 64_000,
    contextPercent: 38,
    sessionMetrics: {
      inputTokens: 1_200,
      outputTokens: 340,
      totalTokens: 2_100,
      cacheReadTokens: 500,
      cacheWriteTokens: 80,
      latestCacheHitPercent: 82,
      costUsd: 1.25,
    },
    fiveHourPercent: 35,
    weeklyPercent: 62,
    accessType: "subscription",
    pulse: {
      branch: "main",
      ahead: 2,
      behind: 1,
      staged: 3,
      unstaged: 5,
      relativeCwd: "src/tui",
    },
    branchEntryCount: 17,
    availableToolNames: ["bash", "read"],
    runState: "busy",
    activity: {
      run: { status: "active", startedAt: 0, durationMs: 125_000 },
      turn: { status: "active", number: 3, startedAt: 0, durationMs: 62_000 },
      activeTools: [
        {
          callId: "1",
          name: "bash",
          summary: "a",
          status: "active",
          startedAt: 0,
          durationMs: 10,
        },
        {
          callId: "2",
          name: "bash",
          summary: "b",
          status: "active",
          startedAt: 0,
          durationMs: 10,
        },
      ],
      recentTools: [
        {
          callId: "3",
          name: "grep",
          summary: "c",
          status: "complete",
          startedAt: 0,
          endedAt: 1_200,
          durationMs: 1_200,
        },
      ],
      completedToolCount: 4,
      failedToolCount: 1,
      response: {
        status: "streaming",
        startedAt: 0,
        firstTokenAt: 450,
        ttftMs: 450,
        outputTokens: 120,
        tokenCountKind: "final",
        tps: 12.3,
      },
      updatedAt: 5_000,
    },
    alerts: [{ key: "net", text: "connection lost" }],
    statuses: [{ key: "lsp", text: "ready" }],
    todos: [
      { id: 1, text: "write tests", status: "completed" },
      { id: 2, text: "ship it", status: "in_progress" },
    ],
    sidebarPanels: [],
    ...overrides,
  };
}

function byId(catalog: readonly SidebarCatalogEntry[]): Map<string, SidebarCatalogEntry> {
  return new Map(catalog.map((entry) => [entry.id, entry]));
}

function textOf(entry: SidebarCatalogEntry | undefined): string | undefined {
  if (!entry?.content) return undefined;
  if (entry.content.kind === "metric") return entry.content.value.map((s) => s.text).join("");
  return entry.content.rows.map((row) => row.map((s) => s.text).join("")).join("\n");
}

function values(catalog: readonly SidebarCatalogEntry[]): Record<string, string | undefined> {
  return Object.fromEntries(catalog.map((entry) => [entry.id, textOf(entry)]));
}

describe("sidebar catalog completeness", () => {
  it("emits all 32 built-ins exactly once in canonical order", () => {
    const ids = buildSidebarSegmentCatalog(snapshot())
      .map((entry) => entry.id)
      .filter((id) => id.startsWith("builtin:"));
    expect(ids).toEqual(CANONICAL_BUILTIN_IDS);
  });

  it("gives each built-in its canonical home panel", () => {
    const catalog = byId(buildSidebarSegmentCatalog(snapshot()));
    for (const [panelId, segmentIds] of Object.entries(SIDEBAR_BUILTIN_ASSIGNMENTS)) {
      for (const id of segmentIds) {
        expect(catalog.get(id)?.defaultPanelId).toBe(panelId);
      }
    }
  });

  it("covers every footer segment with a sidebar segment", () => {
    const catalog = byId(buildSidebarSegmentCatalog(snapshot()));
    for (const segment of KNOWN_SEGMENTS) {
      expect(catalog.has(FOOTER_COVERAGE[segment])).toBe(true);
    }
  });

  it("produces data-only content that survives structuredClone", () => {
    const catalog = buildSidebarSegmentCatalog(snapshot({ sidebarPanels: [contributedPanel()] }));
    expect(structuredClone(catalog)).toEqual(catalog);
  });
});

describe("sidebar catalog values", () => {
  it("formats the curated built-in values exactly", () => {
    expect(values(buildSidebarSegmentCatalog(snapshot()))).toMatchObject({
      "builtin:model": "claude-sonnet",
      "builtin:thinking": "HIGH",
      "builtin:provider": "ANTHROPIC",
      "builtin:access": "SUBSCRIPTION",
      "builtin:run-state": "Working",
      "builtin:run-timing": "Run 2m 05s",
      "builtin:turn-progress": "Turn 3 1m 02s",
      "builtin:response-performance": "TTFT 450ms · 12.3 tok/s",
      "builtin:tool-outcomes": "4 done · 1 failed",
      "builtin:recent-tools": "grep 1s",
      "builtin:context-used": "24.3k used",
      "builtin:context-remaining": "39.7k left",
      "builtin:project": "pi-status",
      "builtin:directory": "./src/tui",
      "builtin:branch": "main",
      "builtin:changes": "3 staged · 5 unstaged",
      "builtin:sync-state": "↑2 ↓1",
      "builtin:usage-5h": "5h 65% left",
      "builtin:usage-weekly": "wk 38% left",
      "builtin:total-tokens": "2.1k tokens",
      "builtin:cost": "$1.25",
      "builtin:input": "1.2k input",
      "builtin:output": "340 output",
      "builtin:cache-read": "500 cache read",
      "builtin:cache-write": "80 cache write",
      "builtin:cache-hit": "82% cache hit",
      "builtin:session-identity": "release prep",
      "builtin:entry-count": "17 entries",
      "builtin:persistence": "Persisted",
      "builtin:active-tool-count": "2 active · 2 available",
      "builtin:todos-progress": "1/2 todos",
    });
  });

  it("includes reset minutes when hours remain", () => {
    const now = Date.parse("2026-06-14T10:00:00Z");
    vi.useFakeTimers({ now });
    try {
      const catalog = buildSidebarSegmentCatalog(
        snapshot({
          fiveHourResetAt: now + (4 * 60 + 23) * 60_000,
        }),
      );
      expect(textOf(byId(catalog).get("builtin:usage-5h"))).toBe("5h 65% 4hr23min left");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows burn rate arrows beside both usage limits", () => {
    const now = Date.parse("2026-06-14T10:00:00Z");
    vi.useFakeTimers({ now });
    try {
      const catalog = buildSidebarSegmentCatalog(
        snapshot({
          fiveHourPercent: 60,
          fiveHourResetAt: now + 2.5 * 60 * 60 * 1000,
          fiveHourBurnRate: 10,
          weeklyPercent: 20,
          weeklyResetAt: now + 3.5 * 24 * 60 * 60 * 1000,
          weeklyBurnRate: -30,
        }),
      );
      expect(textOf(byId(catalog).get("builtin:usage-5h"))).toBe("5h 40% 2hr30min left ↑10%");
      expect(textOf(byId(catalog).get("builtin:usage-weekly"))).toBe("wk 80% 3d12hr left ↓30%");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the estimated token rate with a tilde", () => {
    const base = snapshot();
    const activity = base.activity;
    if (!activity) throw new Error("expected activity");
    const catalog = buildSidebarSegmentCatalog(
      snapshot({
        activity: {
          ...activity,
          response: { ...activity.response, tokenCountKind: "estimated" },
        },
      }),
    );
    expect(textOf(byId(catalog).get("builtin:response-performance"))).toBe(
      "TTFT 450ms · ~12.3 tok/s",
    );
  });

  it("falls back to a session id when the session is unnamed", () => {
    const catalog = buildSidebarSegmentCatalog(snapshot({ sessionName: undefined }));
    expect(textOf(byId(catalog).get("builtin:session-identity"))).toBe("sid abcdef12");
  });

  it("reports an ephemeral session", () => {
    const catalog = buildSidebarSegmentCatalog(snapshot({ persisted: false }));
    expect(textOf(byId(catalog).get("builtin:persistence"))).toBe("Ephemeral");
  });

  it("renders the context meter as a full-width block", () => {
    const content = byId(buildSidebarSegmentCatalog(snapshot())).get(
      "builtin:context-meter",
    )?.content;
    expect(content?.kind).toBe("block");
  });

  it("keeps required context entries with dim placeholders when unavailable", () => {
    const catalog = byId(
      buildSidebarSegmentCatalog(
        snapshot({ contextTokens: undefined, contextWindow: undefined, contextPercent: undefined }),
      ),
    );
    const used = catalog.get("builtin:context-used");
    expect(used?.priority).toBe("required");
    expect(textOf(used)).toBe("— used");
    expect(used?.content?.kind === "metric" && used.content.unavailable).toBe(true);
  });

  it("omits optional metrics that carry no information", () => {
    const catalog = byId(
      buildSidebarSegmentCatalog(
        snapshot({
          fiveHourPercent: undefined,
          weeklyPercent: undefined,
          sessionMetrics: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            latestCacheHitPercent: undefined,
            costUsd: undefined,
          },
        }),
      ),
    );
    for (const id of [
      "builtin:usage-5h",
      "builtin:usage-weekly",
      "builtin:total-tokens",
      "builtin:cost",
      "builtin:input",
      "builtin:output",
      "builtin:cache-read",
      "builtin:cache-write",
      "builtin:cache-hit",
    ]) {
      expect(catalog.get(id)?.content).toBeNull();
    }
  });

  it("omits idle activity timings and zero tool counts", () => {
    const catalog = byId(
      buildSidebarSegmentCatalog(
        snapshot({
          runState: "idle",
          activity: {
            run: { status: "idle", durationMs: 0 },
            turn: { status: "idle", number: 0, durationMs: 0 },
            activeTools: [],
            recentTools: [],
            completedToolCount: 0,
            failedToolCount: 0,
            response: { status: "idle" },
            updatedAt: 0,
          },
        }),
      ),
    );
    expect(textOf(catalog.get("builtin:run-state"))).toBe("Ready");
    expect(catalog.get("builtin:run-timing")?.content).toBeNull();
    expect(catalog.get("builtin:turn-progress")?.content).toBeNull();
    expect(catalog.get("builtin:response-performance")?.content).toBeNull();
    expect(catalog.get("builtin:tool-outcomes")?.content).toBeNull();
    expect(catalog.get("builtin:recent-tools")?.content).toBeNull();
  });

  it("keeps provider and access collapsible when both are missing", () => {
    const catalog = byId(
      buildSidebarSegmentCatalog(snapshot({ provider: undefined, accessType: undefined })),
    );
    for (const id of ["builtin:provider", "builtin:access"]) {
      const content = catalog.get(id)?.content;
      expect(content?.kind === "metric" && content.unavailable).toBe(true);
      expect(content?.kind === "metric" && content.collapseUnavailableKey).toBe("agent-meta");
    }
  });

  it("marks workspace segments that need a pulse", () => {
    const catalog = byId(buildSidebarSegmentCatalog(snapshot()));
    expect(catalog.get("builtin:branch")?.requiresWorkspacePulse).toBe(true);
    expect(catalog.get("builtin:changes")?.requiresWorkspacePulse).toBe(true);
    expect(catalog.get("builtin:project")?.requiresWorkspacePulse).toBe(false);
  });

  it("drops optional activity segments before required ones", () => {
    const catalog = byId(buildSidebarSegmentCatalog(snapshot()));
    const order = [
      "builtin:recent-tools",
      "builtin:tool-outcomes",
      "builtin:response-performance",
      "builtin:run-timing",
      "builtin:turn-progress",
    ].map((id) => catalog.get(id)?.dropOrder ?? Number.NaN);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(catalog.get("builtin:run-state")?.priority).toBe("required");
  });
});

function contributedPanel(overrides: Partial<SidebarPanelData> = {}): SidebarPanelData {
  return {
    id: "build:panel",
    title: "Build",
    rows: [{ text: "passing", id: "row_one" }, { text: "anonymous" }],
    role: "primary",
    available: true,
    source: "build",
    generation: 3,
    ...overrides,
  };
}

describe("sidebar catalog dynamic identities", () => {
  it("sanitizes dynamic labels before they reach editor metadata", () => {
    const catalog = buildSidebarSegmentCatalog(
      snapshot({
        alerts: [],
        statuses: [{ key: "\u001b[31mlsp\u001b[0m", text: "ready" }],
        availableToolNames: ["\u001b[31mbash\u001b[0m"],
        todos: [{ id: 1, text: "\u001b[31mship\u001b[0m", status: "pending" }],
        sidebarPanels: [
          contributedPanel({ title: "\u001b[31mBuild\u001b[0m", rows: [{ text: "passing" }] }),
        ],
      }),
    );
    const dynamicLabels = catalog
      .filter(({ id }) => !id.startsWith("builtin:"))
      .map(({ label }) => label);

    expect(dynamicLabels).toEqual(["lsp", "bash", "ship", "Build"]);
  });

  it("gives statuses and alerts stable encoded identities", () => {
    const catalog = byId(
      buildSidebarSegmentCatalog(
        snapshot({
          alerts: [{ key: "net:core", text: "connection lost" }],
          statuses: [{ key: "lsp", text: "ready" }],
        }),
      ),
    );
    expect(catalog.get("status:net%3Acore")?.defaultPanelId).toBe("alerts");
    expect(catalog.get("status:lsp")?.defaultPanelId).toBe("statuses");
    expect(catalog.get("status:lsp")?.persistence).toBe("stable");
    expect(textOf(catalog.get("status:lsp"))).toBe("• ready");
  });

  it("gives each configured tool a disabled-by-default stable segment", () => {
    const catalog = byId(buildSidebarSegmentCatalog(snapshot()));
    const bash = catalog.get("tool:bash");
    expect(bash?.defaultEnabled).toBe(false);
    expect(bash?.persistence).toBe("stable");
    expect(bash?.defaultPanelId).toBe("tools");
  });

  it("shows live call multiplicity for an active configured tool", () => {
    const catalog = byId(buildSidebarSegmentCatalog(snapshot()));
    expect(textOf(catalog.get("tool:bash"))).toBe("bash ×2");
  });

  it("keeps an inactive configured tool available with no content", () => {
    const catalog = byId(buildSidebarSegmentCatalog(snapshot()));
    const read = catalog.get("tool:read");
    expect(read?.available).toBe(true);
    expect(read?.content).toBeNull();
  });

  it("skips a configured tool whose stable ID would exceed the bound", () => {
    const catalog = byId(
      buildSidebarSegmentCatalog(snapshot({ availableToolNames: ["t".repeat(300)] })),
    );
    expect([...catalog.keys()].filter((id) => id.startsWith("tool:"))).toEqual([]);
  });

  it("gives each TODO a session-only identity", () => {
    const catalog = byId(buildSidebarSegmentCatalog(snapshot()));
    expect(catalog.get("session:todo:1")?.persistence).toBe("session");
    expect(catalog.get("session:todo:1")?.defaultPanelId).toBe("todos");
    expect(textOf(catalog.get("session:todo:2"))).toBe("◐ #2 ship it");
  });

  it("uses stable identities for explicit contributed row IDs", () => {
    const catalog = byId(
      buildSidebarSegmentCatalog(snapshot({ sidebarPanels: [contributedPanel()] })),
    );
    const explicit = catalog.get("contribution:build%3Apanel:row_one");
    expect(explicit?.persistence).toBe("stable");
    expect(explicit?.defaultPanelId).toBe("build:panel");
    expect(textOf(explicit)).toBe("passing");
  });

  it("uses generation-scoped session identities for anonymous contributed rows", () => {
    const catalog = byId(
      buildSidebarSegmentCatalog(snapshot({ sidebarPanels: [contributedPanel()] })),
    );
    const anonymous = catalog.get("session:contribution:build%3Apanel:3:1");
    expect(anonymous?.persistence).toBe("session");
    expect(textOf(anonymous)).toBe("anonymous");
  });

  it("isolates one failing row without losing the rest of the catalog", () => {
    const panel = contributedPanel();
    const rows = [
      { text: "fine" },
      Object.defineProperty({ id: "row_bad" }, "text", {
        get() {
          throw new Error("boom");
        },
      }) as { text: string; id: string },
    ];
    const catalog = byId(
      buildSidebarSegmentCatalog(
        snapshot({ sidebarPanels: [{ ...panel, rows: rows as SidebarPanelData["rows"] }] }),
      ),
    );
    const failed = catalog.get("contribution:build%3Apanel:row_bad");
    expect(failed?.available).toBe(false);
    expect(failed?.content).toBeNull();
    expect(textOf(catalog.get("session:contribution:build%3Apanel:3:0"))).toBe("fine");
    expect(textOf(catalog.get("builtin:model"))).toBe("claude-sonnet");
  });
});
