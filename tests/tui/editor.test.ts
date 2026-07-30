import { describe, expect, it, vi } from "vitest";
import { Key, matchesKey, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { PiStatusConfig } from "../../src/shared/types.ts";
import type { FooterRenderInput } from "../../src/tui/render.ts";
import { collectHiddenStatuses, createStatusLineEditor } from "../../src/tui/editor.ts";
import { noTheme, type StatusLineTheme } from "../../src/tui/theme.ts";

type EditorComponent = Component & { handleInput: (data: string) => void };

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const ENTER = "\r";
const ESCAPE = "\x1b";
const BACKSPACE = "\x7f";
const SPACE = " ";

const IDENTITY_THEME: StatusLineTheme = noTheme;
const HIGHLIGHT_THEME: StatusLineTheme = {
  fg: (color, text) => (color === "accent" ? `«${text}»` : text),
  bold: (text) => `**${text}**`,
  dim: (text) => text,
  rainbow: (text) => text,
};

function makeConfig(overrides?: Partial<PiStatusConfig>): PiStatusConfig {
  return {
    segments: ["model-with-reasoning", "current-dir"],
    extensionSegments: { hidden: [] },
    ...overrides,
  };
}

function makePreviewInput(): Omit<FooterRenderInput, "segments" | "extensionSegments"> {
  return {
    cwd: "/Users/test/project",
    thinkingLevel: "medium",
    runState: "idle",
  };
}

function makeEditor(options?: {
  config?: PiStatusConfig;
  discovered?: string[];
  theme?: StatusLineTheme;
  usageAvailable?: boolean;
}) {
  const done = vi.fn();
  const requestRender = vi.fn();
  const editor = createStatusLineEditor({
    config: options?.config ?? makeConfig(),
    discoveredStatuses: options?.discovered ?? [],
    previewInput: makePreviewInput(),
    theme: options?.theme ?? IDENTITY_THEME,
    done,
    requestRender,
    usageAvailable: options?.usageAvailable,
  }) as EditorComponent;
  return { editor, done, requestRender };
}

function stripAnsi(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI SGR sequences
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderLines(editor: EditorComponent, width = 120): string[] {
  return editor.render(width).map(stripAnsi);
}

function rowLines(lines: string[]): string[] {
  return lines.slice(5, -3);
}

function activeInteractiveRow(lines: string[]): string | undefined {
  return rowLines(lines).find((line) => line.includes("\u25B8"));
}

describe("statusline editor shell", () => {
  it("renders the exact Codex-style shell layout in order", () => {
    const { editor } = makeEditor();
    const lines = renderLines(editor);

    expect(lines.slice(0, 5)).toEqual([
      "Configure Status Line",
      "Select which items to display in the status line.",
      "",
      "Type to search",
      "\u25B8 ",
    ]);
  });

  it("shows the visible query line for typed text", () => {
    const { editor } = makeEditor();
    editor.handleInput("m");
    editor.handleInput("o");
    editor.handleInput("d");
    expect(renderLines(editor)[4]).toBe("\u25B8 mod");
  });

  it("always renders the preview line and help line at the bottom", () => {
    const { editor } = makeEditor();
    const lines = renderLines(editor);

    expect(lines).not.toContain("Preview:");
    expect(lines.at(-3)).toBe("");
    expect((lines.at(-2) ?? "").length).toBeGreaterThan(0);
    expect(lines.at(-1)).toBe("Toggle: Space  •  Reorder: ← / →  •  Save: Enter  •  Cancel: Esc");
  });

  it("swaps the reorder clause in the help line when search is active", () => {
    const { editor } = makeEditor();
    editor.handleInput("m");
    expect(renderLines(editor).at(-1)).toBe(
      "Toggle: Space  •  Reorder: disabled while search is active  •  Save: Enter  •  Cancel: Esc",
    );
  });
});

describe("statusline editor hidden status collection", () => {
  it("returns hidden keys sorted alphabetically", () => {
    expect(
      collectHiddenStatuses({
        discoveredKeys: ["c", "a", "b"],
        shownKeys: ["a", "c"],
      }),
    ).toEqual(["b"]);
  });

  it("returns empty array when all are shown", () => {
    expect(
      collectHiddenStatuses({
        discoveredKeys: ["a", "b"],
        shownKeys: ["a", "b"],
      }),
    ).toEqual([]);
  });
});

describe("statusline editor query input", () => {
  it("appends printable ASCII characters to the query but keeps Space reserved for toggle", () => {
    const { editor } = makeEditor();
    editor.handleInput("a");
    editor.handleInput("B");
    editor.handleInput("1");
    editor.handleInput(SPACE);
    expect(renderLines(editor)[4]).toBe("\u25B8 aB1");
  });

  it("removes the last character on backspace", () => {
    const { editor } = makeEditor();
    editor.handleInput("a");
    editor.handleInput("b");
    editor.handleInput("c");
    editor.handleInput(BACKSPACE);
    expect(renderLines(editor)[4]).toBe("\u25B8 ab");
  });
});

describe("statusline editor usage availability", () => {
  it("hides usage-backed segments when usage is unavailable", () => {
    const { editor } = makeEditor({ usageAvailable: false });
    const lines = rowLines(renderLines(editor, 200));
    expect(lines.some((line) => line.includes("5h Limit"))).toBe(false);
    expect(lines.some((line) => line.includes("Weekly Limit"))).toBe(false);
  });

  it("preserves saved usage-backed segments when usage is unavailable", () => {
    const { editor, done } = makeEditor({
      usageAvailable: false,
      config: makeConfig({
        segments: ["five-hour-limit", "model-with-reasoning", "weekly-limit"],
      }),
    });
    editor.handleInput(ENTER);
    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;
    expect(saved?.segments).toEqual(["five-hour-limit", "model-with-reasoning", "weekly-limit"]);
  });
});

describe("statusline editor sections and ordering", () => {
  it("shows both section headers and the divider when query is empty", () => {
    const { editor } = makeEditor();
    const lines = rowLines(renderLines(editor));

    expect(lines).toContain("Status line items");
    expect(lines).toContain("Extension statuses");
    expect(lines.some((line) => /^─+$/.test(line))).toBe(true);
  });

  it("renders enabled segments before disabled segments", () => {
    const { editor } = makeEditor({
      config: makeConfig({
        segments: ["current-dir", "git-branch"],
      }),
    });
    const lines = rowLines(renderLines(editor, 200));
    const segmentLines = lines.filter(
      (line) =>
        line.includes("Model") || line.includes("Current Dir") || line.includes("Git Branch"),
    );

    expect(segmentLines[0]).toContain("Current Dir (1)");
    expect(segmentLines[1]).toContain("Git Branch (2)");
    expect(segmentLines[2]).toContain("Model");
  });

  it("preserves saved order for enabled segments", () => {
    const { editor } = makeEditor({
      config: makeConfig({
        segments: ["git-branch", "current-dir", "model"],
      }),
    });
    const lines = rowLines(renderLines(editor, 200));
    const enabledLines = lines.filter((line) => /\([123]\)/.test(line));

    expect(enabledLines[0]).toContain("Git Branch (1)");
    expect(enabledLines[1]).toContain("Current Dir (2)");
    expect(enabledLines[2]).toContain("Model (3)");
  });

  it("preserves canonical order for disabled segments", () => {
    const { editor } = makeEditor({
      config: makeConfig({ segments: ["current-dir"] }),
    });
    const lines = rowLines(renderLines(editor, 200));
    const modelIndex = lines.findIndex((line) => line.includes("Model"));
    const reasoningIndex = lines.findIndex((line) => line.includes("Model + Reasoning"));
    const projectNameIndex = lines.findIndex((line) => line.includes("Project Name"));

    expect(modelIndex).toBeLessThan(reasoningIndex);
    expect(reasoningIndex).toBeLessThan(projectNameIndex);
  });

  it("keeps discovered extension-status rows alphabetically sorted", () => {
    const { editor } = makeEditor({
      discovered: ["zeta-status", "alpha-status", "beta-status"],
    });
    const lines = rowLines(renderLines(editor, 200));
    const alphaIndex = lines.findIndex((line) => line.includes("alpha-status"));
    const betaIndex = lines.findIndex((line) => line.includes("beta-status"));
    const zetaIndex = lines.findIndex((line) => line.includes("zeta-status"));

    expect(alphaIndex).toBeLessThan(betaIndex);
    expect(betaIndex).toBeLessThan(zetaIndex);
  });

  it("renders discovered extension-status rows in the extension section", () => {
    const { editor } = makeEditor({
      discovered: ["alpha-status", "beta-status"],
    });
    const lines = rowLines(renderLines(editor, 200));
    const alphaIndex = lines.findIndex((line) => line.includes("alpha-status"));
    const betaIndex = lines.findIndex((line) => line.includes("beta-status"));

    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(alphaIndex).toBeLessThan(betaIndex);
  });

  it("shows the empty-state hint when no extension statuses are discovered", () => {
    const { editor } = makeEditor();
    const lines = rowLines(renderLines(editor, 200));

    expect(lines).toContain("No extension statuses yet.");
  });
});

describe("statusline editor search", () => {
  it("searches segment rows by label and description", () => {
    const { editor } = makeEditor();
    for (const char of "queued") editor.handleInput(char);
    const lines = rowLines(renderLines(editor, 200));

    expect(lines.some((line) => line.includes("Run State"))).toBe(true);
    expect(lines.some((line) => line.includes("Model + Reasoning"))).toBe(false);
  });

  it("searches discovered status rows by key and generic description", () => {
    const { editor } = makeEditor({ discovered: ["custom-status"] });

    for (const char of "custom") editor.handleInput(char);
    let lines = rowLines(renderLines(editor, 200));
    expect(lines.some((line) => line.includes("custom-status"))).toBe(true);

    for (let i = 0; i < 6; i++) editor.handleInput(BACKSPACE);
    for (const char of "visibility") editor.handleInput(char);
    lines = rowLines(renderLines(editor, 200));
    expect(lines.some((line) => line.includes("custom-status"))).toBe(true);
  });

  it("omits section headers, divider, and empty-state hint while searching", () => {
    const { editor } = makeEditor();
    editor.handleInput("m");
    const lines = rowLines(renderLines(editor, 200));

    expect(lines).not.toContain("Status line items");
    expect(lines).not.toContain("Extension statuses");
    expect(lines.some((line) => /^─+$/.test(line))).toBe(false);
    expect(lines).not.toContain("No extension statuses yet.");
  });

  it("shows an empty list area when a non-empty search has no matches", () => {
    const { editor } = makeEditor({ discovered: ["alpha-status"] });
    for (const char of "zzz") editor.handleInput(char);
    expect(rowLines(renderLines(editor, 200))).toEqual([]);
  });
});

describe("statusline editor descriptions", () => {
  it("renders segment descriptions with the exact copy", () => {
    const { editor } = makeEditor();
    const lines = renderLines(editor, 200);

    expect(lines.some((line) => line.includes("Current model name with reasoning level"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("Project name (omitted when unavailable)"))).toBe(
      true,
    );
  });

  it("renders generic descriptions for discovered rows", () => {
    const { editor } = makeEditor({ discovered: ["custom-status"] });
    const lines = renderLines(editor, 200);

    expect(lines.some((line) => line.includes("Toggle visibility in the status line"))).toBe(true);
  });
});

describe("statusline editor interactions", () => {
  it("moves up and down across interactive rows only", () => {
    const { editor } = makeEditor({ theme: HIGHLIGHT_THEME });
    const before = activeInteractiveRow(editor.render(200));
    editor.handleInput(DOWN);
    const after = activeInteractiveRow(editor.render(200));

    expect(before).toContain("Model + Reasoning");
    expect(after).toContain("Current Dir");
  });

  it("toggles the currently selected segment row on space", () => {
    const { editor, done } = makeEditor();
    editor.handleInput(SPACE);
    editor.handleInput(ENTER);
    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;

    expect(saved?.segments).toEqual(["current-dir"]);
  });

  it("reorders enabled segments with left and right", () => {
    const { editor, done } = makeEditor({
      config: makeConfig({ segments: ["model", "current-dir"] }),
    });
    editor.handleInput(DOWN);
    editor.handleInput(LEFT);
    editor.handleInput(ENTER);
    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;

    expect(saved?.segments).toEqual(["current-dir", "model"]);
  });

  it("moves enabled segments later with right", () => {
    const { editor, done } = makeEditor({
      config: makeConfig({ segments: ["model", "current-dir", "git-branch"] }),
    });
    editor.handleInput(RIGHT);
    editor.handleInput(ENTER);
    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;

    expect(saved?.segments).toEqual(["current-dir", "model", "git-branch"]);
  });

  it("keeps the selection indicator on the moved item after reorder", () => {
    const { editor } = makeEditor({
      config: makeConfig({ segments: ["model", "current-dir", "git-branch"] }),
      theme: HIGHLIGHT_THEME,
    });
    editor.handleInput(DOWN); // select current-dir (index 1)
    expect(activeInteractiveRow(editor.render(200))).toContain("Current Dir");

    editor.handleInput(LEFT); // move current-dir before model
    expect(activeInteractiveRow(editor.render(200))).toContain("Current Dir");

    editor.handleInput(RIGHT); // move current-dir back after model
    expect(activeInteractiveRow(editor.render(200))).toContain("Current Dir");
  });

  it("keeps left/right as no-ops for disabled segments", () => {
    const { editor, done } = makeEditor({
      config: makeConfig({ segments: ["current-dir"] }),
    });
    editor.handleInput(LEFT);
    editor.handleInput(RIGHT);
    editor.handleInput(ENTER);
    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;

    expect(saved?.segments).toEqual(["current-dir"]);
  });

  it("keeps left/right as no-ops for discovered rows", () => {
    const { editor, done } = makeEditor({ discovered: ["alpha-status"] });
    for (let i = 0; i < 14; i++) editor.handleInput(DOWN);
    editor.handleInput(LEFT);
    editor.handleInput(RIGHT);
    editor.handleInput(DOWN);
    editor.handleInput(LEFT);
    editor.handleInput(RIGHT);
    editor.handleInput(ENTER);
    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;

    expect(saved?.segments).toEqual(["model-with-reasoning", "current-dir"]);
  });

  it("keeps left/right as no-ops while a query is active", () => {
    const { editor, done } = makeEditor({
      config: makeConfig({ segments: ["model", "current-dir"] }),
    });
    editor.handleInput("m");
    editor.handleInput(LEFT);
    editor.handleInput(RIGHT);
    editor.handleInput(ENTER);
    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;

    expect(saved?.segments).toEqual(["model", "current-dir"]);
  });

  it("saves on Enter and cancels on Escape", () => {
    const enterEditor = makeEditor();
    enterEditor.editor.handleInput(ENTER);
    expect(enterEditor.done).toHaveBeenCalledWith(
      expect.objectContaining({ segments: expect.any(Array) }),
    );

    const escEditor = makeEditor();
    escEditor.editor.handleInput(ESCAPE);
    expect(escEditor.done).toHaveBeenCalledWith(null);
  });

  it("persists the current draft on Enter with all pending changes", () => {
    const initialConfig = makeConfig({
      segments: ["model", "current-dir", "git-branch"],
    });
    const { editor, done } = makeEditor({ config: initialConfig });
    editor.handleInput(DOWN);
    editor.handleInput(SPACE); // toggles off current-dir
    editor.handleInput(ENTER);

    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;
    expect(saved?.segments).toEqual(["model", "git-branch"]);
  });

  it("leaves the runtime config unchanged on Escape", () => {
    const initialConfig = makeConfig({
      segments: ["model", "current-dir", "git-branch"],
    });
    const { editor, done } = makeEditor({ config: initialConfig });
    editor.handleInput(DOWN);
    editor.handleInput(SPACE);
    editor.handleInput(DOWN);
    editor.handleInput(SPACE);
    editor.handleInput(DOWN);
    editor.handleInput(SPACE);
    editor.handleInput(ESCAPE);

    expect(done).toHaveBeenCalledWith(null);
    expect(initialConfig.segments).toEqual(["model", "current-dir", "git-branch"]);
  });

  it("preserves keybinding matching for the editor keys", () => {
    expect(matchesKey(UP, Key.up)).toBe(true);
    expect(matchesKey(DOWN, Key.down)).toBe(true);
    expect(matchesKey(LEFT, Key.left)).toBe(true);
    expect(matchesKey(RIGHT, Key.right)).toBe(true);
    expect(matchesKey(ENTER, Key.enter)).toBe(true);
    expect(matchesKey(ESCAPE, Key.escape)).toBe(true);
    expect(matchesKey(BACKSPACE, Key.backspace)).toBe(true);
    expect(matchesKey(SPACE, Key.space)).toBe(true);
  });
});

describe("statusline editor live preview and layout", () => {
  it("renders the preview as the bottom preview line without a Preview label", () => {
    const { editor } = makeEditor({
      config: makeConfig({ segments: ["model-with-reasoning", "current-dir"] }),
    });
    const lines = renderLines(editor, 200);

    expect(lines).not.toContain("Preview:");
    expect(lines.at(-3)).toBe("");
    expect(lines.at(-2)).toBe("/Users/test/project");
    expect(lines.at(-1)).toBe("Toggle: Space  •  Reorder: ← / →  •  Save: Enter  •  Cancel: Esc");
  });

  it("updates the preview line after toggling a segment", () => {
    const { editor } = makeEditor({
      config: makeConfig({ segments: ["model-with-reasoning", "current-dir"] }),
    });
    const before = renderLines(editor, 200).at(-2);
    expect(before).toBe("/Users/test/project");
    editor.handleInput(DOWN);
    editor.handleInput(SPACE); // toggle off current-dir
    const after = renderLines(editor, 200).at(-2);
    expect(after).toBe("");
  });

  it("updates the preview line after reordering enabled segments", () => {
    const editor = createStatusLineEditor({
      config: makeConfig({ segments: ["current-dir", "run-state"] }),
      discoveredStatuses: [],
      previewInput: { ...makePreviewInput(), runState: "busy" },
      theme: IDENTITY_THEME,
      done: vi.fn(),
      requestRender: vi.fn(),
    }) as EditorComponent;
    expect(editor.render(200).at(-2)).toBe("/Users/test/project · busy");
    editor.handleInput(DOWN);
    editor.handleInput(LEFT);
    expect(editor.render(200).at(-2)).toBe("busy · /Users/test/project");
  });

  it("keeps the preview line stable when the user only edits the search query", () => {
    const { editor } = makeEditor({
      config: makeConfig({ segments: ["current-dir", "run-state"] }),
    });
    const initial = renderLines(editor, 200).at(-2);
    expect(initial).toBe("/Users/test/project · idle");
    editor.handleInput("c");
    editor.handleInput("u");
    editor.handleInput("r");
    expect(renderLines(editor, 200).at(-2)).toBe(initial);
  });

  it("renders aligned label and description columns when width allows", () => {
    const { editor } = makeEditor();
    const lines = renderLines(editor, 200);
    const target = lines.find((line) => line.includes("Model + Reasoning"));

    expect(target).toBe(
      "\u25B8 [\u2022] Model + Reasoning (1)     Current model name with reasoning level",
    );
  });

  it("falls back to label - description form on narrow widths", () => {
    const { editor } = makeEditor();
    const lines = renderLines(editor, 40);
    const target = lines.find((line) => line.includes("Model + Reasoning"));

    expect(target).toBe("\u25B8 [\u2022] Model + Reasoning (1) - Current...");
  });

  it("never renders lines wider than the requested width", () => {
    for (const width of [1, 2, 3, 5, 10, 40, 80, 200]) {
      const { editor } = makeEditor({ discovered: ["very-long-status-name"] });
      const lines = renderLines(editor, width);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe("statusline editor width hardening", () => {
  it("keeps the selected row width-safe at tiny widths", () => {
    const { editor } = makeEditor({ theme: HIGHLIGHT_THEME });
    for (const width of [1, 2, 3]) {
      const lines = editor.render(width);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("keeps unselected rows width-safe at tiny widths", () => {
    const { editor } = makeEditor({ theme: HIGHLIGHT_THEME });
    editor.handleInput(DOWN);
    for (const width of [1, 2, 3]) {
      const lines = editor.render(width);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("keeps aligned wide-width row output exact and deterministic", () => {
    const { editor } = makeEditor();
    const lines = renderLines(editor, 200);
    const target = lines.find((line) => line.includes("Model + Reasoning"));
    expect(target).toBe(
      "\u25B8 [\u2022] Model + Reasoning (1)     Current model name with reasoning level",
    );
  });

  it("keeps narrow-width fallback row output exact and deterministic", () => {
    const { editor } = makeEditor();
    const lines = renderLines(editor, 30);
    const target = lines.find((line) => line.includes("Model + Reasoning"));
    expect(target).toBe("\u25B8 [\u2022] Model + Reasoning... - .");
  });

  it("renders the preview with the full requested width without the extra two-column loss", () => {
    const longCwd = "/Users/test/project/very/long/path/that/exceeds/fifty/characters/xx";
    const editor = createStatusLineEditor({
      config: makeConfig({ segments: ["current-dir"] }),
      discoveredStatuses: [],
      previewInput: { ...makePreviewInput(), cwd: longCwd },
      theme: IDENTITY_THEME,
      done: vi.fn(),
      requestRender: vi.fn(),
    }) as EditorComponent;

    const width = 50;
    const lines = renderLines(editor, width);
    const preview = lines.at(-2) ?? "";
    expect(visibleWidth(preview)).toBe(width);
  });

  it("truncates the default help line within width and keeps it readable", () => {
    const { editor } = makeEditor();
    const lines = renderLines(editor, 30);
    const help = lines.at(-1) ?? "";
    expect(visibleWidth(help)).toBeLessThanOrEqual(30);
    expect(help).toBe("Toggle: Space  •  Reorder: ...");
  });

  it("truncates the searching help line within width and keeps it readable", () => {
    const { editor } = makeEditor();
    editor.handleInput("m");
    const lines = renderLines(editor, 30);
    const help = lines.at(-1) ?? "";
    expect(visibleWidth(help)).toBeLessThanOrEqual(30);
    expect(help).toBe("Toggle: Space  •  Reorder: ...");
  });

  it("keeps default and searching help lines distinct at widths that show full copy", () => {
    for (const width of [40, 80, 120, 200]) {
      const baseEditor = makeEditor();
      const baseHelp = baseEditor.editor.render(width).map(stripAnsi).at(-1) ?? "";

      const searching = makeEditor();
      searching.editor.handleInput("m");
      const searchHelp = searching.editor.render(width).map(stripAnsi).at(-1) ?? "";

      expect(baseHelp).not.toBe(searchHelp);
      expect(baseHelp.startsWith("Toggle: Space")).toBe(true);
      expect(searchHelp.startsWith("Toggle: Space")).toBe(true);
    }
  });

  it("truncates the subtitle, section, and hint lines within width", () => {
    for (const width of [1, 5, 10, 30, 80, 200]) {
      const { editor } = makeEditor({ discovered: ["alpha-status"] });
      const lines = renderLines(editor, width);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("keeps all rendered lines within width across representative widths", () => {
    for (const width of [1, 2, 3, 5, 10, 20, 30, 40, 60, 80, 120, 200]) {
      const { editor } = makeEditor({
        discovered: ["alpha-status", "beta-status", "gamma-status"],
      });
      const lines = renderLines(editor, width);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe("statusline editor discovered-status filter persistence", () => {
  it("saves extensionSegments with hidden key when toggling status off", () => {
    const { editor, done } = makeEditor({
      config: makeConfig({
        segments: ["model-with-reasoning", "current-dir"],
        extensionSegments: { hidden: [] },
      }),
      discovered: ["alpha-status", "beta-status"],
    });

    for (let i = 0; i < 14; i++) editor.handleInput(DOWN);
    editor.handleInput(SPACE);
    editor.handleInput(ENTER);
    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;

    expect(saved?.extensionSegments).toEqual({
      hidden: ["alpha-status"],
    });
  });

  it("saves extensionSegments with no hidden keys when toggling status on", () => {
    const { editor, done } = makeEditor({
      config: makeConfig({
        segments: ["model-with-reasoning", "current-dir"],
        extensionSegments: { hidden: ["alpha-status", "beta-status"] },
      }),
      discovered: ["alpha-status", "beta-status"],
    });

    for (let i = 0; i < 14; i++) editor.handleInput(DOWN);
    editor.handleInput(SPACE);
    editor.handleInput(ENTER);
    const saved = done.mock.calls[0]?.[0] as PiStatusConfig | null;

    expect(saved?.extensionSegments).toEqual({
      hidden: ["beta-status"],
    });
  });
});

type SpyCall = readonly unknown[];

function makeSpyTheme(): {
  theme: StatusLineTheme;
  calls: { fg: SpyCall[]; bold: SpyCall[]; dim: SpyCall[] };
} {
  const calls = {
    fg: [] as SpyCall[],
    bold: [] as SpyCall[],
    dim: [] as SpyCall[],
  };
  // Spy passes text through unchanged so the editor's existing width
  // hardening still applies to the rendered output. We verify the
  // requested styling through call tracking, not through the returned
  // string. This keeps the test independent of any specific ANSI
  // encoding and lets the existing width tests continue to pass.
  const theme: StatusLineTheme = {
    fg: (color, text) => {
      calls.fg.push([color, text]);
      return text;
    },
    bold: (text) => {
      calls.bold.push([text]);
      return text;
    },
    dim: (text) => {
      calls.dim.push([text]);
      return text;
    },
    rainbow: (text) => text,
  };
  return { theme, calls };
}

describe("statusline editor theme plumbing", () => {
  it("renders the title as fg('accent', bold(title))", () => {
    const { theme, calls } = makeSpyTheme();
    const { editor } = makeEditor({ theme });
    editor.render(200);

    // The title is the only place we wrap bold inside fg("accent", …).
    // Find the fg call whose payload is the bolded title — that uniquely
    // identifies the title rendering.
    const titleCall = calls.fg.find(([, payload]) => payload === "Configure Status Line");
    expect(titleCall?.[0]).toBe("accent");

    // The bold call must have wrapped the title text directly, not the
    // already-wrapped fg result.
    expect(calls.bold).toContainEqual(["Configure Status Line"]);
  });

  it("uses borderMuted for the section divider line", () => {
    const { theme, calls } = makeSpyTheme();
    const { editor } = makeEditor({ theme });
    editor.render(200);

    const dividerCall = calls.fg.find(
      ([color, payload]) =>
        color === "borderMuted" && typeof payload === "string" && payload.includes("─"),
    );
    expect(dividerCall).toBeDefined();
    expect(dividerCall?.[0]).toBe("borderMuted");
  });

  it("uses dim for row descriptions, helper copy, and the search placeholder", () => {
    const { theme, calls } = makeSpyTheme();
    const { editor } = makeEditor({ theme });
    editor.render(200);

    // Collect every dim(text) target we expect to see at least once.
    const dimTexts = new Set(calls.dim.map(([text]) => text as string));

    // Row description copy
    expect(dimTexts.has("Current model name with reasoning level")).toBe(true);
    // Subtitle
    expect(dimTexts.has("Select which items to display in the status line.")).toBe(true);
    // Search placeholder
    expect(dimTexts.has("Type to search")).toBe(true);
    // Help line copy
    expect(dimTexts.has("Toggle: Space  •  Reorder: ← / →  •  Save: Enter  •  Cancel: Esc")).toBe(
      true,
    );
    // Empty-state hint
    expect(dimTexts.has("No extension statuses yet.")).toBe(true);
  });

  it("uses fg('accent', ...) for the title and fg('borderMuted', ...) for the divider", () => {
    const { theme, calls } = makeSpyTheme();
    const { editor } = makeEditor({ theme });
    editor.render(200);

    const colors = new Set(calls.fg.map(([color]) => color as string));
    expect(colors.has("accent")).toBe(true);
    expect(colors.has("borderMuted")).toBe(true);
  });

  it("keeps the rendered output within the requested width when the theme wraps text", () => {
    // Use a theme that wraps the text with real ANSI escape sequences so we
    // can verify the editor's truncateToWidth still respects the requested
    // visible width even when the rendered text contains zero-width styling.
    const ANSI_THEME: StatusLineTheme = {
      fg: (_color, text) => `\x1b[33m${text}\x1b[0m`,
      bold: (text) => `\x1b[1m${text}\x1b[22m`,
      dim: (text) => `\x1b[2m${text}\x1b[22m`,
      rainbow: (text) => text,
    };
    for (const width of [1, 5, 30, 80, 200]) {
      const { editor } = makeEditor({
        theme: ANSI_THEME,
        discovered: ["alpha-status"],
      });
      const lines = editor.render(width);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe("statusline editor live theme sync", () => {
  it("recolors menu chrome and preview when the live theme changes", () => {
    // Build a mutable theme object that the editor can read on every
    // render. The accent tag changes between renders so the second
    // render produces visibly different output, which proves the editor
    // is reading the live theme on every render instead of caching the
    // first render's styling.
    let accentTag = "first-accent";
    let borderTag = "first-border";
    const theme: StatusLineTheme = {
      fg: (color, text) => {
        if (color === "accent") return `[${accentTag}]${text}[/${accentTag}]`;
        if (color === "borderMuted") return `[${borderTag}]${text}[/${borderTag}]`;
        return text;
      },
      bold: (text) => `[B]${text}[/B]`,
      dim: (text) => text,
      rainbow: (text) => text,
    };

    const editor = createStatusLineEditor({
      config: makeConfig({ segments: ["model-with-reasoning"] }),
      discoveredStatuses: [],
      previewInput: {
        ...makePreviewInput(),
        model: { id: "gpt-5", name: "GPT-5", reasoning: true },
      },
      theme,
      done: vi.fn(),
      requestRender: vi.fn(),
    }) as EditorComponent;

    const firstLines = editor.render(200);
    const firstTitle = firstLines[0] ?? "";
    expect(firstTitle).toContain("[first-accent]");
    expect(firstTitle).toContain("[B]Configure Status Line[/B]");

    // The divider is the only line that uses borderMuted.
    const firstDivider = firstLines.find((line) => line.startsWith("[first-border]"));
    expect(firstDivider).toBeDefined();
    const firstPreview = firstLines.at(-2) ?? "";
    expect(firstPreview).toContain("[first-accent]GPT-5[/first-accent]");
    expect(firstPreview).toContain("[med]");

    // Pi swaps the live theme mid-session: update the captured tags.
    accentTag = "second-accent";
    borderTag = "second-border";

    // Invalidate and rerender — should pick up the new colors without
    // reopening `/statusline`.
    editor.invalidate();
    const secondLines = editor.render(200);
    const secondTitle = secondLines[0] ?? "";
    expect(secondTitle).toContain("[second-accent]");
    expect(secondTitle).toContain("[B]Configure Status Line[/B]");

    const secondDivider = secondLines.find((line) => line.startsWith("[second-border]"));
    expect(secondDivider).toBeDefined();
    const secondPreview = secondLines.at(-2) ?? "";
    expect(secondPreview).toContain("[second-accent]GPT-5[/second-accent]");
    expect(secondPreview).toContain("[med]");
  });
});
