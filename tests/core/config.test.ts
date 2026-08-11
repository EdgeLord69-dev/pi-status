import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, mkdtempSync: vi.fn(fs.mkdtempSync) };
});
import {
  SIDEBAR_LAYOUT_TOOL_SENTINEL,
  getConfigPath,
  loadConfig,
  normalizeExtensionSegments,
  normalizeSegments,
  normalizeSidebarPanelLayout,
  normalizeZones,
  saveConfig,
} from "../../src/core/config.ts";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  type ConfigStore,
  DEFAULT_SIDEBAR_PANEL_LAYOUT,
  DEFAULT_ZONES,
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  STATUS_LINE_ZONE_ORDER,
  type PiStatusConfig,
  type SidebarPanelLayout,
} from "../../src/shared/types.ts";
import { MemoryConfigStore } from "../helpers.ts";

const builtinAssignments = SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>;
const expectedDefaultLayout = (): SidebarPanelLayout =>
  BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
    id,
    visible: true,
    segments: [...builtinAssignments[id]],
  }));
const expectedDefault = expectedDefaultLayout;

const config: PiStatusConfig = {
  zones: { topLeft: ["git-branch"], topRight: [], bottomLeft: [], bottomRight: [] },
  extensionSegments: { hidden: ["alpha"] },
  extensionStatusZone: "bottomRight",
  completionNotifications: false,
  sidebarPanelLayout: expectedDefault(),
  sidebarHiddenSegments: [],
};

describe("config — normalization", () => {
  it("normalizes segments: dedupes, rejects unknowns and non-strings", () => {
    expect(
      normalizeSegments([
        "model",
        "model",
        "unknown",
        1,
        "current-dir",
        "git-branch",
        "project-name",
      ]),
    ).toEqual(["model", "current-dir", "git-branch", "project-name"]);
  });

  it("keeps normalizeSegments as a legacy seam that returns empty for non-arrays", () => {
    expect(normalizeSegments(undefined)).toEqual([]);
  });

  it("accepts the opt-in live activity and workspace segments", () => {
    expect(normalizeSegments(["turn-progress", "response-performance", "workspace-pulse"])).toEqual(
      ["turn-progress", "response-performance", "workspace-pulse"],
    );
  });

  it("normalizes zones in display order with one shared seen set", () => {
    expect(
      normalizeZones({
        topLeft: ["model", "model"],
        topRight: ["model", "git-branch"],
        bottomLeft: ["unknown", "current-dir"],
        bottomRight: "not-an-array",
      }),
    ).toEqual({
      topLeft: ["model"],
      topRight: ["git-branch"],
      bottomLeft: ["current-dir"],
      bottomRight: [],
    });
  });

  it("uses the four fixed display zones", () => {
    expect(STATUS_LINE_ZONE_ORDER).toEqual(["topLeft", "topRight", "bottomLeft", "bottomRight"]);
  });

  it("normalizes extension segments: dedupes, rejects empty and non-strings", () => {
    expect(normalizeExtensionSegments(undefined)).toEqual({ hidden: [] });
    expect(normalizeExtensionSegments({ hidden: ["a", "a", "", 1] })).toEqual({ hidden: ["a"] });
  });

  it("normalizes extension status zone: defaults to bottomRight, rejects invalid values", () => {
    const source = JSON.stringify({
      zones: { topLeft: ["model"], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: [] },
      extensionStatusZone: "unknown",
      completionNotifications: false,
      sidebarPanelLayout: expectedDefault(),
    });
    const store = new MemoryConfigStore();
    store.seed(getConfigPath("/agent"), source);
    expect(loadConfig({ agentDir: "/agent", store }).extensionStatusZone).toBe("bottomRight");
  });
});

describe("config — sidebar panel layout", () => {
  it("defines the exact built-in order and all-visible default", () => {
    expect(BUILTIN_SIDEBAR_PANEL_IDS).toEqual([
      "agent",
      "activity",
      "alerts",
      "statuses",
      "todos",
      "context",
      "workspace",
      "usage",
      "tools",
    ]);
    expect(DEFAULT_SIDEBAR_PANEL_LAYOUT).toEqual(expectedDefault());
  });

  it("returns fresh defaults for missing and non-array layouts", () => {
    const first = normalizeSidebarPanelLayout(undefined);
    const second = normalizeSidebarPanelLayout({});

    const firstEntry = first[0];
    expect(firstEntry).toBeDefined();
    if (firstEntry) firstEntry.visible = false;
    expect(second).toEqual(expectedDefault());
    expect(normalizeSidebarPanelLayout("agent")).toEqual(expectedDefault());

    const store = new MemoryConfigStore();
    expect(loadConfig({ agentDir: "/agent", store }).sidebarPanelLayout).toEqual(expectedDefault());
  });

  it("rejects malformed entries, unknown built-ins, and invalid contributed IDs", () => {
    expect(
      normalizeSidebarPanelLayout([
        null,
        [],
        "agent",
        {},
        { id: 1, visible: true },
        { id: "unknown", visible: true },
        { id: "Vendor:panel", visible: true },
        { id: "vendor:Panel", visible: true },
        { id: "1vendor:panel", visible: true },
        { id: "vendor:1panel", visible: true },
        { id: "vendor.panel:name", visible: true },
        { id: "vendor:panel.name", visible: true },
        { id: "vendor::panel", visible: true },
        { id: "vendor:panel\n", visible: true },
        { id: "vendor:panel\r", visible: true },
        { id: "vendor:panel\r\n", visible: true },
        { id: "vendor:panel ", visible: true },
        { id: "vendor:panel ", visible: true },
        { id: `a:${"b".repeat(127)}`, visible: true },
      ]),
    ).toEqual(expectedDefault());
  });

  it("accepts strict lowercase contributed IDs through the 128-character limit", () => {
    const maxLengthId = `${`a${"1".repeat(62)}`}:b${"2".repeat(63)}`;

    expect(maxLengthId).toHaveLength(128);
    expect(
      normalizeSidebarPanelLayout([
        { id: "vendor_1:panel-2", visible: true },
        { id: maxLengthId, visible: true },
      ]),
    ).toEqual([
      { id: "vendor_1:panel-2", visible: true, segments: [] },
      { id: maxLengthId, visible: true, segments: [] },
      ...expectedDefault(),
    ]);
  });

  it("retains first duplicates and unavailable contributions, hides non-true values, and appends built-ins", () => {
    expect(
      normalizeSidebarPanelLayout([
        { id: "vendor:missing", visible: "true" },
        { id: "todos", visible: false },
        { id: "vendor:missing", visible: true },
        { id: "activity", visible: true },
      ]),
    ).toEqual([
      { id: "vendor:missing", visible: false, segments: [] },
      { id: "todos", visible: false, segments: [...builtinAssignments.todos] },
      { id: "activity", visible: true, segments: [...builtinAssignments.activity] },
      { id: "agent", visible: true, segments: [...builtinAssignments.agent] },
      { id: "alerts", visible: true, segments: [] },
      { id: "statuses", visible: true, segments: [] },
      { id: "context", visible: true, segments: [...builtinAssignments.context] },
      { id: "workspace", visible: true, segments: [...builtinAssignments.workspace] },
      { id: "usage", visible: true, segments: [...builtinAssignments.usage] },
      { id: "tools", visible: true, segments: [...builtinAssignments.tools] },
    ]);
  });

  it("repairs Agent visibility when every retained entry is hidden", () => {
    const normalized = normalizeSidebarPanelLayout([
      { id: "vendor:missing", visible: false },
      ...BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: false })),
    ]);

    expect(normalized).toEqual([
      { id: "vendor:missing", visible: false, segments: [] },
      ...BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
        id,
        visible: id === "agent",
        segments: [...builtinAssignments[id]],
      })),
    ]);
  });

  it("preserves ordered layouts and does not alias normalized input or loaded defaults", () => {
    const input = [
      { id: "vendor:panel", visible: true, segments: ["custom:row"] },
      { id: "tools", visible: false, segments: [] },
    ];
    const sidebarPanelLayout = normalizeSidebarPanelLayout(input);
    const inputEntry = input[0];
    expect(inputEntry).toBeDefined();
    if (inputEntry) inputEntry.visible = false;
    expect(sidebarPanelLayout[0]).toEqual({
      id: "vendor:panel",
      visible: true,
      segments: ["custom:row"],
    });

    const store = new MemoryConfigStore();
    const withLayout = { ...config, sidebarPanelLayout };
    saveConfig(withLayout, { agentDir: "/agent", store });
    expect(JSON.parse(store.read(getConfigPath("/agent")) as string).sidebarPanelLayout).toEqual(
      sidebarPanelLayout,
    );
    expect(loadConfig({ agentDir: "/agent", store }).sidebarPanelLayout).toEqual(
      sidebarPanelLayout,
    );

    const emptyStore = new MemoryConfigStore();
    const first = loadConfig({ agentDir: "/agent", store: emptyStore });
    const loadedEntry = first.sidebarPanelLayout[0];
    expect(loadedEntry).toBeDefined();
    if (loadedEntry) loadedEntry.visible = false;
    expect(loadConfig({ agentDir: "/agent", store: emptyStore }).sidebarPanelLayout).toEqual(
      expectedDefault(),
    );
  });
});

describe("config — nested sidebar layout", () => {
  it("accepts nested entries with explicit segments", () => {
    expect(
      normalizeSidebarPanelLayout([
        {
          id: "agent",
          visible: true,
          segments: ["builtin:model", "contribution:vendor:panel:row_a"],
        },
        { id: "activity", visible: false, segments: [] },
      ]),
    ).toEqual([
      {
        id: "agent",
        visible: true,
        segments: ["builtin:model", "contribution:vendor:panel:row_a"],
      },
      { id: "activity", visible: false, segments: [] },
      ...expectedDefault().filter((p) => p.id !== "agent" && p.id !== "activity"),
    ]);
  });

  it("uses curated built-ins for panels missing segments", () => {
    expect(
      normalizeSidebarPanelLayout([
        { id: "agent", visible: true },
      ]),
    ).toEqual([
      { id: "agent", visible: true, segments: [...builtinAssignments.agent] },
      ...expectedDefault().filter((p) => p.id !== "agent"),
    ]);
  });

  it("keeps explicit empty segments empty", () => {
    expect(
      normalizeSidebarPanelLayout([
        { id: "agent", visible: true, segments: [] },
      ]),
    ).toEqual([
      { id: "agent", visible: true, segments: [] },
      ...expectedDefault().filter((p) => p.id !== "agent"),
    ]);
  });

  it("globally deduplicates assignments and caps at 2048", () => {
    const overflow = Array.from({ length: 2_050 }, (_, i) => `tag:${i}`);
    const expected = overflow.slice(0, 2_048);
    expect(
      normalizeSidebarPanelLayout([
        { id: "agent", visible: true, segments: overflow },
      ]),
    ).toEqual([
      { id: "agent", visible: true, segments: expected },
      ...expectedDefault().slice(1),
    ]);
  });

  it("dedupes segments within the same panel", () => {
    expect(
      normalizeSidebarPanelLayout([
        { id: "agent", visible: true, segments: ["a", "a", "b", "a"] },
      ]),
    ).toEqual([
      { id: "agent", visible: true, segments: ["a", "b"] },
      ...expectedDefault().slice(1),
    ]);
  });

  it("does not include sessions-only or sentinel IDs in the persisted output", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    saveConfig(
      {
        ...config,
        sidebarPanelLayout: [
          { id: "agent", visible: true, segments: ["session:todo:1", "extra:row"] },
        ],
      },
      { agentDir: "/agent", store },
    );
    const written = JSON.parse(store.read(path) as string);
    expect(written.sidebarPanelLayout[0].segments).toEqual(["extra:row"]);
    expect(written.sidebarHiddenSegments).toEqual([]);
  });
});

describe("config — legacy inputs as raw load inputs", () => {
  it("migrates a legacy sidebarExtensionSegments hidden list into sidebarHiddenSegments", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({
        zones: DEFAULT_ZONES,
        extensionSegments: { hidden: [] },
        sidebarExtensionSegments: { hidden: ["build", "lint"] },
      }),
    );
    expect(loadConfig({ agentDir: "/agent", store }).sidebarHiddenSegments).toEqual([
      "build",
      "lint",
    ]);
  });

  it("treats showSidebarToolNames: true as the internal sentinel in hidden segments", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({
        zones: DEFAULT_ZONES,
        extensionSegments: { hidden: [] },
        showSidebarToolNames: true,
      }),
    );
    const loaded = loadConfig({ agentDir: "/agent", store });
    expect(loaded.sidebarHiddenSegments).toEqual([SIDEBAR_LAYOUT_TOOL_SENTINEL]);
  });

  it("excludes assigned IDs from sidebarHiddenSegments", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({
        zones: DEFAULT_ZONES,
        extensionSegments: { hidden: [] },
        sidebarExtensionSegments: { hidden: ["builtin:model", "no:assignment"] },
      }),
    );
    expect(loadConfig({ agentDir: "/agent", store }).sidebarHiddenSegments).toEqual([
      "no:assignment",
    ]);
  });

  it("does not write sidebarExtensionSegments or showSidebarToolNames to disk", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    saveConfig({ ...config, sidebarHiddenSegments: ["alpha"] }, { agentDir: "/agent", store });
    const written = JSON.parse(store.read(path) as string);
    expect(written).not.toHaveProperty("sidebarExtensionSegments");
    expect(written).not.toHaveProperty("showSidebarToolNames");
    expect(written.sidebarHiddenSegments).toEqual(["alpha"]);
  });
});

describe("config — direct extension file", () => {
  it("migrates a legacy segments array into the top-left zone", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    store.seed(path, JSON.stringify({ segments: ["git-branch"] }));

    expect(loadConfig({ agentDir: "/agent", store })).toMatchObject({
      zones: {
        topLeft: ["git-branch"],
        topRight: [],
        bottomLeft: [],
        bottomRight: [],
      },
    });
  });

  it("uses an own zones value in preference to legacy segments", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    store.seed(
      path,
      JSON.stringify({
        zones: { topLeft: [], topRight: ["git-branch"] },
        segments: ["model"],
      }),
    );

    expect(loadConfig({ agentDir: "/agent", store }).zones).toEqual({
      topLeft: [],
      topRight: ["git-branch"],
      bottomLeft: [],
      bottomRight: [],
    });
  });

  it("does not fall back to legacy segments when an own zones value is malformed", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({ zones: { topLeft: "bad" }, segments: ["model"] }),
    );

    expect(loadConfig({ agentDir: "/agent", store }).zones).toEqual(DEFAULT_ZONES);
  });

  it("uses defaults for a missing, malformed, or wholly empty layout", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    store.seed(path, JSON.stringify({ segments: "model" }));
    expect(loadConfig({ agentDir: "/agent", store }).zones).toEqual(DEFAULT_ZONES);

    store.seed(path, JSON.stringify({ zones: { topLeft: [], bottomRight: [] } }));
    expect(loadConfig({ agentDir: "/agent", store }).zones).toEqual(DEFAULT_ZONES);
  });

  it("uses the exact extension config path", () => {
    expect(getConfigPath("/agent")).toBe(join("/agent", "extensions", "statusline.json"));
  });

  it("hard-cuts over from legacy global and project settings without accessing them", () => {
    const store = new MemoryConfigStore();
    const agentDir = "/agent-root";
    const path = getConfigPath(agentDir);
    store.seed(
      "/agent-root/settings.json",
      JSON.stringify({ statusLine: { segments: ["model"] } }),
    );
    store.seed(
      "/work/repo/.pi/settings.json",
      JSON.stringify({ statusLine: { segments: ["git-branch"] } }),
    );

    expect(loadConfig({ agentDir, store })).toEqual({
      zones: DEFAULT_ZONES,
      extensionSegments: { hidden: [] },
      extensionStatusZone: "bottomRight",
      completionNotifications: false,
      sidebarPanelLayout: expectedDefault(),
      sidebarHiddenSegments: [],
    });
    expect(store.accessPaths).toEqual([path]);
    expect(store.accessPaths.some((accessed) => accessed.includes("settings.json"))).toBe(false);
  });

  it("loads and normalizes the direct config schema", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    store.seed(
      path,
      JSON.stringify({
        segments: ["git-branch", "git-branch", "unknown"],
        extensionSegments: { hidden: ["alpha", "alpha", "", 1] },
      }),
    );

    expect(loadConfig({ agentDir: "/agent", store })).toEqual(config);
    expect(store.existsPaths).toEqual([]);
    expect(store.readPaths).toEqual([path]);
  });

  it.each(["{ bad", "null", "[]"])(
    "returns a fresh default for malformed or non-object config: %s",
    (content) => {
      const store = new MemoryConfigStore();
      store.seed(getConfigPath("/agent"), content);

      expect(loadConfig({ agentDir: "/agent", store })).toEqual({
        zones: DEFAULT_ZONES,
        extensionSegments: { hidden: [] },
        extensionStatusZone: "bottomRight",
        completionNotifications: false,
        sidebarPanelLayout: expectedDefault(),
        sidebarHiddenSegments: [],
      });
    },
  );

  it("saves the direct config schema without accessing legacy settings", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");

    expect(saveConfig(config, { agentDir: "/agent", store })).toEqual({ path });
    expect(JSON.parse(store.read(path) as string)).toEqual(config);
    expect(store.accessPaths).toEqual([path, path, path]);
    expect(store.accessPaths.some((accessed) => accessed.includes("settings.json"))).toBe(false);
  });

  it("saves only the published fields", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    const dirtyConfig = { ...config, segments: ["model"], unknown: true } as PiStatusConfig & {
      segments: string[];
      unknown: boolean;
    };

    saveConfig(dirtyConfig, { agentDir: "/agent", store });

    expect(JSON.parse(store.read(path) as string)).toEqual(config);
  });

  it("deep-clones default zones", () => {
    const store = new MemoryConfigStore();
    const first = loadConfig({ agentDir: "/agent", store });
    first.zones.topLeft.length = 0;
    first.zones.bottomLeft.push("model");

    expect(loadConfig({ agentDir: "/agent", store }).zones).toEqual(DEFAULT_ZONES);
  });

  it.each(["{ bad", "null", "[]"])(
    "refuses to overwrite malformed or non-object config: %s",
    (content) => {
      const store = new MemoryConfigStore();
      const path = getConfigPath("/agent");
      store.seed(path, content);

      expect(() => saveConfig(config, { agentDir: "/agent", store })).toThrow(
        /refusing to overwrite malformed or non-object config/i,
      );
      expect(store.writePaths).toEqual([]);
    },
  );

  it("propagates storage read and write failures", () => {
    const readStore: ConfigStore = {
      exists: () => false,
      read: () => {
        throw new Error("read failed");
      },
      write: () => {},
    };
    expect(() => loadConfig({ agentDir: "/agent", store: readStore })).toThrow("read failed");

    const writeStore = new MemoryConfigStore();
    writeStore.write = () => {
      throw new Error("write failed");
    };
    expect(() => saveConfig(config, { agentDir: "/agent", store: writeStore })).toThrow(
      "write failed",
    );
  });
});

describe("config — load/save round-trip", () => {
  it("preserves sidebarHiddenSegments and extensionStatusZone through save and reload", () => {
    const store = new MemoryConfigStore();
    const source: PiStatusConfig = {
      ...config,
      sidebarHiddenSegments: ["build", "lint"],
      extensionStatusZone: "topLeft",
    };
    saveConfig(source, { agentDir: "/agent", store });
    const loaded = loadConfig({ agentDir: "/agent", store });
    expect(loaded.sidebarHiddenSegments).toEqual(["build", "lint"]);
    expect(loaded.extensionStatusZone).toBe("topLeft");
  });

  it("injects defaults for configs that pre-date the new fields", () => {
    const store = new MemoryConfigStore();
    const legacy = JSON.stringify({
      zones: { topLeft: ["model"], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
        id,
        visible: true,
      })),
    });
    store.seed(getConfigPath("/agent"), legacy);
    const loaded = loadConfig({ agentDir: "/agent", store });
    expect(loaded.sidebarHiddenSegments).toEqual([]);
    expect(loaded.extensionStatusZone).toBe("bottomRight");
  });

  it("round-trips a config with sidebarHiddenSegments only", () => {
    const store = new MemoryConfigStore();
    const partial = JSON.stringify({
      zones: { topLeft: ["model"], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: [] },
      sidebarHiddenSegments: ["x"],
      completionNotifications: false,
      sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
        id,
        visible: true,
      })),
    });
    store.seed(getConfigPath("/agent"), partial);
    const loaded = loadConfig({ agentDir: "/agent", store });
    expect(loaded.sidebarHiddenSegments).toEqual(["x"]);
    expect(loaded.extensionStatusZone).toBe("bottomRight");
  });
});

describe("config — filesystem", () => {
  let agentDir: string;

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("round-trips through PI_CODING_AGENT_DIR with no temp residue", () => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-status-fs-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    const path = join(agentDir, "extensions", "statusline.json");

    expect(loadConfig()).toEqual({
      zones: DEFAULT_ZONES,
      extensionSegments: { hidden: [] },
      extensionStatusZone: "bottomRight",
      completionNotifications: false,
      sidebarPanelLayout: expectedDefault(),
      sidebarHiddenSegments: [],
    });
    vi.mocked(mkdtempSync).mockClear();
    expect(saveConfig(config)).toEqual({ path });
    expect(loadConfig()).toEqual(config);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(config);
    expect(mkdtempSync).toHaveBeenCalledWith(join(dirname(path), ".pi-status-"));
    const tempDir = vi.mocked(mkdtempSync).mock.results[0]?.value;
    expect(typeof tempDir).toBe("string");
    expect(existsSync(tempDir as string)).toBe(false);
  });
});

describe("config — completion notifications", () => {
  it("defaults completionNotifications to false when the file is missing", () => {
    const store = new MemoryConfigStore();
    expect(loadConfig({ agentDir: "/agent", store }).completionNotifications).toBe(false);
  });

  it("defaults completionNotifications to false when the key is absent", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({ zones: DEFAULT_ZONES, extensionSegments: { hidden: [] } }),
    );
    expect(loadConfig({ agentDir: "/agent", store }).completionNotifications).toBe(false);
  });

  it("defaults completionNotifications to false when the value is false", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({
        zones: DEFAULT_ZONES,
        extensionSegments: { hidden: [] },
        completionNotifications: false,
        sidebarPanelLayout: expectedDefault(),
      }),
    );
    expect(loadConfig({ agentDir: "/agent", store }).completionNotifications).toBe(false);
  });

  it.each(["true", 1, "yes", {}, []])(
    "only literal true enables completionNotifications (rejects %s)",
    (value) => {
      const store = new MemoryConfigStore();
      store.seed(
        getConfigPath("/agent"),
        JSON.stringify({
          zones: DEFAULT_ZONES,
          extensionSegments: { hidden: [] },
          completionNotifications: value,
        }),
      );
      expect(loadConfig({ agentDir: "/agent", store }).completionNotifications).toBe(false);
    },
  );

  it("enables completionNotifications only when the stored value is literal true", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({
        zones: DEFAULT_ZONES,
        extensionSegments: { hidden: [] },
        completionNotifications: true,
        sidebarPanelLayout: expectedDefault(),
      }),
    );
    expect(loadConfig({ agentDir: "/agent", store }).completionNotifications).toBe(true);
  });

  it("preserves completionNotifications: true through saveConfig", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    const enabled = { ...config, completionNotifications: true };

    saveConfig(enabled, { agentDir: "/agent", store });
    expect(JSON.parse(store.read(path) as string).completionNotifications).toBe(true);
    expect(loadConfig({ agentDir: "/agent", store }).completionNotifications).toBe(true);
  });

  it("preserves completionNotifications: false through saveConfig", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    const disabled = { ...config, completionNotifications: false };

    saveConfig(disabled, { agentDir: "/agent", store });
    expect(JSON.parse(store.read(path) as string).completionNotifications).toBe(false);
    expect(loadConfig({ agentDir: "/agent", store }).completionNotifications).toBe(false);
  });

  it("serializes completionNotifications as part of the direct config schema", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");

    saveConfig({ ...config, completionNotifications: true }, { agentDir: "/agent", store });
    const written = JSON.parse(store.read(path) as string);
    expect(written).toEqual({ ...config, completionNotifications: true });
    expect(Object.keys(written).sort()).toEqual(
      [
        "completionNotifications",
        "extensionSegments",
        "extensionStatusZone",
        "sidebarHiddenSegments",
        "sidebarPanelLayout",
        "zones",
      ].sort(),
    );
  });

  it("still refuses to overwrite malformed or non-object config even when notifications are set", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");
    store.seed(path, "{ bad");

    expect(() =>
      saveConfig({ ...config, completionNotifications: true }, { agentDir: "/agent", store }),
    ).toThrow(/refusing to overwrite malformed or non-object config/i);
    expect(store.writePaths).toEqual([]);
  });

  it("falls back to the default completionNotifications: false for malformed configs", () => {
    const store = new MemoryConfigStore();
    store.seed(getConfigPath("/agent"), "{ bad");
    expect(loadConfig({ agentDir: "/agent", store }).completionNotifications).toBe(false);
  });
});
