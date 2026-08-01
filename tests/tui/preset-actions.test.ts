import { describe, expect, it, vi } from "vitest";
import {
  DISPLAY_PRESET_NAMES,
  displayPreset,
  displayPresetPreview,
  handleDisplayPreset,
  isDisplayPresetName,
} from "../../src/tui/preset-actions.ts";
import { DEFAULT_ZONES } from "../../src/shared/types.ts";

describe("DISPLAY_PRESET_NAMES", () => {
  it("lists presets in user-facing order", () => {
    expect(DISPLAY_PRESET_NAMES).toEqual(["minimal", "balanced", "telemetry"]);
  });
});

describe("displayPreset", () => {
  it.each([
    [
      "minimal",
      {
        topLeft: ["model-with-reasoning"],
        topRight: [],
        bottomLeft: ["current-dir"],
        bottomRight: [],
      },
    ],
    [
      "balanced",
      {
        topLeft: ["model-with-reasoning", "run-state"],
        topRight: ["context-remaining"],
        bottomLeft: ["current-dir", "git-branch"],
        bottomRight: ["five-hour-limit", "weekly-limit"],
      },
    ],
    [
      "telemetry",
      {
        topLeft: ["model-with-reasoning", "run-state", "turn-progress", "response-performance"],
        topRight: ["context-used", "context-remaining"],
        bottomLeft: [],
        bottomRight: [
          "total-input-tokens",
          "total-output-tokens",
          "cache-read-tokens",
          "cache-write-tokens",
          "cache-hit",
          "session-cost",
          "access-type",
          "five-hour-limit",
          "weekly-limit",
        ],
      },
    ],
  ] as const)("defines %s exactly", (name, expected) => {
    expect(displayPreset(name)).toEqual(expected);
  });

  it("returns clones whose zone arrays can be mutated independently", () => {
    const first = displayPreset("balanced");
    first.topLeft.push("model");
    first.bottomRight.length = 0;
    const second = displayPreset("balanced");
    expect(second.topLeft).toEqual(["model-with-reasoning", "run-state"]);
    expect(second.bottomRight).toEqual(["five-hour-limit", "weekly-limit"]);
  });

  it("matches the DEFAULT_ZONES layout for the minimal preset", () => {
    expect(displayPreset("minimal")).toEqual(DEFAULT_ZONES);
  });

  it("keeps every segment ID unique across all four zones of each preset", () => {
    for (const name of DISPLAY_PRESET_NAMES) {
      const zones = displayPreset(name);
      const all = [...zones.topLeft, ...zones.topRight, ...zones.bottomLeft, ...zones.bottomRight];
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

describe("isDisplayPresetName", () => {
  it.each(DISPLAY_PRESET_NAMES)("recognises %s", (name) => {
    expect(isDisplayPresetName(name)).toBe(true);
  });

  it("rejects non-preset strings", () => {
    expect(isDisplayPresetName("")).toBe(false);
    expect(isDisplayPresetName("wip")).toBe(false);
    expect(isDisplayPresetName("MINIMAL")).toBe(false);
  });
});

describe("displayPresetPreview", () => {
  it("emits exactly four lines using persisted segment IDs", () => {
    expect(displayPresetPreview(displayPreset("balanced"))).toBe(
      [
        "Top Left: model-with-reasoning · run-state",
        "Top Right: context-remaining",
        "Bottom Left: current-dir · git-branch",
        "Bottom Right: five-hour-limit · weekly-limit",
      ].join("\n"),
    );
  });

  it("uses the em dash for empty zones", () => {
    expect(displayPresetPreview(displayPreset("minimal"))).toBe(
      [
        "Top Left: model-with-reasoning",
        "Top Right: —",
        "Bottom Left: current-dir",
        "Bottom Right: —",
      ].join("\n"),
    );
  });
});

type Spies = {
  select: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
};

function buildCtx(
  spies: Partial<Spies> = {},
  mode: "tui" | "rpc" = "tui",
): { ctx: Parameters<typeof handleDisplayPreset>[0]; spies: Spies } {
  const select = spies.select ?? vi.fn(async () => undefined);
  const confirm = spies.confirm ?? vi.fn(async () => false);
  const notify = spies.notify ?? vi.fn();
  const ctx = {
    mode,
    ui: { select, confirm, notify } as unknown as Parameters<typeof handleDisplayPreset>[0]["ui"],
  } as unknown as Parameters<typeof handleDisplayPreset>[0];
  return { ctx, spies: { select, confirm, notify } };
}

describe("handleDisplayPreset", () => {
  it("offers a mutable copy of DISPLAY_PRESET_NAMES and applies the result", async () => {
    const select = vi.fn(async (title: string, options: string[]) => {
      expect(title).toBe("Choose display preset");
      expect([...options]).toEqual([...DISPLAY_PRESET_NAMES]);
      options.push("rogue");
      expect(options).toEqual([...DISPLAY_PRESET_NAMES, "rogue"]);
      expect(DISPLAY_PRESET_NAMES).toEqual(["minimal", "balanced", "telemetry"]);
      return "balanced";
    });
    const confirm = vi.fn(async (title: string, message: string) => {
      expect(title).toBe("Apply balanced preset?");
      expect(message).toBe(
        [
          "Top Left: model-with-reasoning · run-state",
          "Top Right: context-remaining",
          "Bottom Left: current-dir · git-branch",
          "Bottom Right: five-hour-limit · weekly-limit",
        ].join("\n"),
      );
      return true;
    });
    const save = vi.fn();
    const { ctx, spies } = buildCtx({ select, confirm });
    await handleDisplayPreset(ctx, { type: "select" }, save);

    expect(save).toHaveBeenCalledWith(displayPreset("balanced"));
    expect(spies.notify).toHaveBeenCalledWith("Applied balanced display preset.", "info");
  });

  it("skips the selector when an apply action is given directly", async () => {
    const select = vi.fn();
    const confirm = vi.fn(async () => true);
    const save = vi.fn();
    const { ctx } = buildCtx({ select, confirm });
    await handleDisplayPreset(ctx, { type: "apply", name: "minimal" }, save);

    expect(select).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith("Apply minimal preset?", expect.any(String));
    expect(save).toHaveBeenCalledWith(displayPreset("minimal"));
  });

  it("does nothing when the selection is cancelled", async () => {
    const select = vi.fn(async () => undefined);
    const save = vi.fn();
    const { ctx, spies } = buildCtx({ select });
    await handleDisplayPreset(ctx, { type: "select" }, save);

    expect(spies.confirm).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(spies.notify).not.toHaveBeenCalledWith(
      expect.stringMatching(/Applied/),
      expect.any(String),
    );
  });

  it("does nothing when confirmation is rejected", async () => {
    const confirm = vi.fn(async () => false);
    const save = vi.fn();
    const { ctx, spies } = buildCtx({ confirm });
    await handleDisplayPreset(ctx, { type: "apply", name: "telemetry" }, save);

    expect(save).not.toHaveBeenCalled();
    expect(spies.notify).not.toHaveBeenCalledWith(
      expect.stringMatching(/Applied/),
      expect.any(String),
    );
  });

  it("warns and exits on RPC mode before opening dialogs", async () => {
    const select = vi.fn();
    const confirm = vi.fn();
    const save = vi.fn();
    const { ctx, spies } = buildCtx({ select, confirm }, "rpc");
    await handleDisplayPreset(ctx, { type: "apply", name: "minimal" }, save);

    expect(select).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(spies.notify).toHaveBeenCalledWith(
      "/statusline preset requires interactive TUI",
      "warning",
    );
  });

  it("surfaces the exact usage string for the invalid action", async () => {
    const save = vi.fn();
    const { ctx, spies } = buildCtx();
    await handleDisplayPreset(ctx, { type: "invalid" }, save);

    expect(save).not.toHaveBeenCalled();
    expect(spies.notify).toHaveBeenCalledWith(
      "Usage: /statusline preset [minimal|balanced|telemetry]",
      "warning",
    );
  });

  it("warns and exits when the selector returns an unrecognised name", async () => {
    const select = vi.fn(async () => "rogue");
    const save = vi.fn();
    const { ctx, spies } = buildCtx({ select });
    await handleDisplayPreset(ctx, { type: "select" }, save);

    expect(spies.confirm).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(spies.notify).toHaveBeenCalledWith(
      "Usage: /statusline preset [minimal|balanced|telemetry]",
      "warning",
    );
  });

  it("warns once and skips success when the save callback throws", async () => {
    const confirm = vi.fn(async () => true);
    const save = vi.fn(() => {
      throw new Error("disk full");
    });
    const { ctx, spies } = buildCtx({ confirm });
    await handleDisplayPreset(ctx, { type: "apply", name: "minimal" }, save);

    expect(spies.notify).toHaveBeenCalledWith("Failed to apply display preset", "warning");
    expect(spies.notify).not.toHaveBeenCalledWith("Applied minimal display preset.", "info");
  });

  it("emits success only after the save callback resolves", async () => {
    const calls: string[] = [];
    const confirm = vi.fn(async () => true);
    const save = vi.fn(() => {
      calls.push("save");
    });
    const notify = vi.fn((message: string) => {
      calls.push(`notify:${message}`);
    });
    const { ctx } = buildCtx({ confirm, notify });
    await handleDisplayPreset(ctx, { type: "apply", name: "telemetry" }, save);

    expect(calls).toEqual(["save", "notify:Applied telemetry display preset."]);
  });
});
