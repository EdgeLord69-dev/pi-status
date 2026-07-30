import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getSettingsPaths,
  loadConfig,
  normalizeExtensionSegments,
  normalizeSegments,
  saveConfigToSettings,
} from "../../src/core/config.ts";
import { DEFAULT_SEGMENTS } from "../../src/shared/types.ts";
import { MemorySettingsStore } from "../helpers.ts";

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

describe("config — loadConfig", () => {
  it("returns default when no settings files exist", () => {
    const store = new MemorySettingsStore();
    const result = loadConfig({ cwd: "/project", store });
    expect(result.source).toBe("default");
    expect(result.config.segments).toEqual(DEFAULT_SEGMENTS);
  });

  it("loads from global settings", () => {
    const store = new MemorySettingsStore();
    const paths = getSettingsPaths("/project");
    store.seed(paths.global, JSON.stringify({ statusLine: { segments: ["git-branch"] } }));
    const result = loadConfig({ cwd: "/project", store });
    expect(result.source).toBe("settings");
    expect(result.config.segments).toEqual(["git-branch"]);
  });

  it("merges project settings over global settings", () => {
    const store = new MemorySettingsStore();
    const paths = getSettingsPaths("/project");
    store.seed(paths.global, JSON.stringify({ statusLine: { segments: ["git-branch"] } }));
    store.seed(
      paths.project,
      JSON.stringify({
        statusLine: { extensionSegments: { hidden: ["x"] } },
      }),
    );
    const result = loadConfig({ cwd: "/project", store });
    expect(result.source).toBe("settings");
    expect(result.config.segments).toEqual(["git-branch"]);
    expect(result.config.extensionSegments).toEqual({ hidden: ["x"] });
  });

  it("returns default when both settings files are malformed JSON", () => {
    const store = new MemorySettingsStore();
    const paths = getSettingsPaths("/project");
    store.seed(paths.global, "{ bad");
    store.seed(paths.project, "{ bad");
    const result = loadConfig({ cwd: "/project", store });
    expect(result.source).toBe("default");
    expect(result.config.segments).toEqual(DEFAULT_SEGMENTS);
  });
});

describe("config — saveConfigToSettings", () => {
  it("saves to project when project has statusLine key", () => {
    const store = new MemorySettingsStore();
    const paths = getSettingsPaths("/project");
    store.seed(paths.project, JSON.stringify({ statusLine: { segments: ["model"] }, x: 1 }));

    const result = saveConfigToSettings(
      { segments: ["current-dir"], extensionSegments: { hidden: [] } },
      { cwd: "/project", store },
    );
    expect(result.target).toBe("project");

    const rawProject = store.read(paths.project);
    expect(rawProject).not.toBeNull();
    const written = JSON.parse(rawProject as string);
    expect(written.x).toBe(1);
    expect(written.statusLine.segments).toEqual(["current-dir"]);
    expect(written.statusLine.extensionSegments).toEqual({ hidden: [] });
  });

  it("saves to global when project has no statusLine key", () => {
    const store = new MemorySettingsStore();
    const paths = getSettingsPaths("/project");
    store.seed(paths.project, JSON.stringify({ y: 2 }));

    const result = saveConfigToSettings(
      { segments: ["model"], extensionSegments: { hidden: ["a"] } },
      { cwd: "/project", store },
    );
    expect(result.target).toBe("global");

    const rawGlobal = store.read(paths.global);
    expect(rawGlobal).not.toBeNull();
    const written = JSON.parse(rawGlobal as string);
    expect(written.statusLine.segments).toEqual(["model"]);
    expect(written.statusLine.extensionSegments).toEqual({ hidden: ["a"] });
  });

  it("saves to global when project settings file does not exist", () => {
    const store = new MemorySettingsStore();

    const result = saveConfigToSettings(
      { segments: ["model"], extensionSegments: { hidden: [] } },
      { cwd: "/project", store },
    );
    expect(result.target).toBe("global");
  });

  it("throws when target global settings are malformed", () => {
    const store = new MemorySettingsStore();
    const paths = getSettingsPaths("/project");
    store.seed(paths.project, JSON.stringify({ y: 2 }));
    store.seed(paths.global, "{ bad");

    expect(() =>
      saveConfigToSettings(
        { segments: ["model"], extensionSegments: { hidden: [] } },
        { cwd: "/project", store },
      ),
    ).toThrow(/refusing to write malformed/i);
  });

  it("throws when project settings are malformed", () => {
    const store = new MemorySettingsStore();
    const paths = getSettingsPaths("/project");
    store.seed(paths.project, "{ bad");

    expect(() =>
      saveConfigToSettings(
        { segments: ["model"], extensionSegments: { hidden: [] } },
        { cwd: "/project", store },
      ),
    ).toThrow(/project settings are malformed/i);
  });
});

describe("config — FsSettingsStore integration", () => {
  it("round-trips through real filesystem", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-status-fs-"));
    const globalHome = join(dir, "home");
    const project = join(dir, "project");

    mkdirSync(join(project, ".pi"), { recursive: true });
    mkdirSync(join(globalHome, ".pi/agent"), { recursive: true });
    writeFileSync(
      join(project, ".pi/settings.json"),
      JSON.stringify({ statusLine: { segments: ["model"] } }),
      "utf8",
    );

    const oldHome = process.env.HOME;
    process.env.HOME = globalHome;
    try {
      const loaded = loadConfig({ cwd: project });
      expect(loaded.config.segments).toEqual(["model"]);

      saveConfigToSettings(
        { segments: ["git-branch"], extensionSegments: { hidden: [] } },
        { cwd: project },
      );

      const raw = JSON.parse(readFileSync(join(project, ".pi/settings.json"), "utf8"));
      expect(raw.statusLine.segments).toEqual(["git-branch"]);
    } finally {
      process.env.HOME = oldHome;
    }
  });
});
