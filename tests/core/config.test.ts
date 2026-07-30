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
  saveConfig,
} from "../../src/core/config.ts";
import { DEFAULT_SEGMENTS, type PiStatusConfig } from "../../src/shared/types.ts";
import { MemoryConfigStore } from "../helpers.ts";

const config: PiStatusConfig = {
  segments: ["git-branch"],
  extensionSegments: { hidden: ["alpha"] },
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

  it("normalizes extension segments: dedupes, rejects empty and non-strings", () => {
    expect(normalizeExtensionSegments(undefined)).toEqual({ hidden: [] });
    expect(normalizeExtensionSegments({ hidden: ["a", "a", "", 1] })).toEqual({ hidden: ["a"] });
  });
});

describe("config — direct extension file", () => {
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
      segments: DEFAULT_SEGMENTS,
      extensionSegments: { hidden: [] },
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
    expect(store.accessPaths).toEqual([path, path]);
  });

  it.each(["{ bad", "null", "[]"])(
    "returns a fresh default for malformed or non-object config: %s",
    (content) => {
      const store = new MemoryConfigStore();
      store.seed(getConfigPath("/agent"), content);

      expect(loadConfig({ agentDir: "/agent", store })).toEqual({
        segments: DEFAULT_SEGMENTS,
        extensionSegments: { hidden: [] },
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
    const readStore = new MemoryConfigStore();
    readStore.read = () => {
      throw new Error("read failed");
    };
    readStore.seed(getConfigPath("/agent"), "{}");
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

    expect(loadConfig()).toEqual({ segments: DEFAULT_SEGMENTS, extensionSegments: { hidden: [] } });
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
