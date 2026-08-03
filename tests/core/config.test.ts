import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, mkdtempSync: vi.fn(fs.mkdtempSync) };
});
import {
  getConfigPath,
  loadConfig,
  normalizeExtensionSegments,
  normalizeSegments,
  normalizeZones,
  saveConfig,
} from "../../src/core/config.ts";
import {
  type ConfigStore,
  DEFAULT_ZONES,
  STATUS_LINE_ZONE_ORDER,
  type PiStatusConfig,
} from "../../src/shared/types.ts";
import { MemoryConfigStore } from "../helpers.ts";

const config: PiStatusConfig = {
  zones: { topLeft: ["git-branch"], topRight: [], bottomLeft: [], bottomRight: [] },
  extensionSegments: { hidden: ["alpha"] },
  completionNotifications: false,
  showSidebarToolNames: false,
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
      completionNotifications: false,
      showSidebarToolNames: false,
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
        completionNotifications: false,
        showSidebarToolNames: false,
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

  it("saves only zones and extensionSegments", () => {
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

describe("config — sidebar tool names", () => {
  it.each([
    ["missing", undefined, false],
    ["literal true", true, true],
    ["string yes", "yes", false],
  ])("normalizes showSidebarToolNames: %s", (_case, value, expected) => {
    const store = new MemoryConfigStore();
    const input = { zones: DEFAULT_ZONES, extensionSegments: { hidden: [] } } as Record<
      string,
      unknown
    >;
    if (value !== undefined) input.showSidebarToolNames = value;
    store.seed(getConfigPath("/agent"), JSON.stringify(input));

    expect(loadConfig({ agentDir: "/agent", store }).showSidebarToolNames).toBe(expected);
  });

  it("serializes showSidebarToolNames: true through saveConfig", () => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent");

    saveConfig({ ...config, showSidebarToolNames: true }, { agentDir: "/agent", store });

    expect(JSON.parse(store.read(path) as string).showSidebarToolNames).toBe(true);
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
      completionNotifications: false,
      showSidebarToolNames: false,
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
        showSidebarToolNames: false,
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
        showSidebarToolNames: false,
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
      ["completionNotifications", "extensionSegments", "showSidebarToolNames", "zones"].sort(),
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
