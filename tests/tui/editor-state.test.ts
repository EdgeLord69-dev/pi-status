import { describe, expect, it } from "vitest";
import { editorReducer, getFilteredRows, initEditorState } from "../../src/tui/editor-state.ts";

function makeState(overrides?: {
  segments?: Parameters<typeof initEditorState>[0]["segments"];
  discovered?: string[];
  usageAvailable?: boolean;
}) {
  return initEditorState(
    {
      segments: overrides?.segments ?? ["model-with-reasoning", "current-dir"],
      extensionSegments: { hidden: [] },
    },
    overrides?.discovered ?? [],
    overrides?.usageAvailable,
  );
}

describe("initEditorState", () => {
  it("initializes with config segments as enabled", () => {
    const state = makeState({ segments: ["model", "git-branch"] });
    expect(state.enabledSegments).toEqual(["model", "git-branch"]);
  });

  it("starts with selectedIndex 0 and empty query", () => {
    const state = makeState();
    expect(state.selectedIndex).toBe(0);
    expect(state.query).toBe("");
  });

  it("filters usage segments when usageAvailable is false", () => {
    const state = makeState({ usageAvailable: false });
    const ids = state.visibleSegments.map((s) => s.id);
    expect(ids).not.toContain("five-hour-limit");
    expect(ids).not.toContain("weekly-limit");
  });

  it("includes usage segments when usageAvailable is true", () => {
    const state = makeState({ usageAvailable: true });
    const ids = state.visibleSegments.map((s) => s.id);
    expect(ids).toContain("five-hour-limit");
    expect(ids).toContain("weekly-limit");
  });
});

describe("editorReducer — navigation", () => {
  it("move_down increments selectedIndex", () => {
    const state = makeState();
    const result = editorReducer(state, { type: "move_down" });
    expect(result.type).toBe("next");
    if (result.type === "next") {
      expect(result.state.selectedIndex).toBe(1);
    }
  });

  it("move_up decrements selectedIndex", () => {
    const state = { ...makeState(), selectedIndex: 2 };
    const result = editorReducer(state, { type: "move_up" });
    if (result.type === "next") {
      expect(result.state.selectedIndex).toBe(1);
    }
  });

  it("move_up clamps to 0", () => {
    const state = makeState();
    const result = editorReducer(state, { type: "move_up" });
    if (result.type === "next") {
      expect(result.state.selectedIndex).toBe(0);
    }
  });

  it("move_down clamps to last index", () => {
    const state = makeState();
    const list = getFilteredRows(state);
    const atEnd = { ...state, selectedIndex: list.length - 1 };
    const result = editorReducer(atEnd, { type: "move_down" });
    if (result.type === "next") {
      expect(result.state.selectedIndex).toBe(list.length - 1);
    }
  });
});

describe("editorReducer — toggle", () => {
  it("toggle removes first enabled segment", () => {
    const state = makeState({ segments: ["model", "current-dir"] });
    const result = editorReducer(state, { type: "toggle" });
    if (result.type === "next") {
      expect(result.state.enabledSegments).toEqual(["current-dir"]);
    }
  });

  it("toggle adds disabled segment", () => {
    const state = makeState({ segments: ["model"] });
    // move to first disabled segment (after model in the list)
    const list = getFilteredRows(state);
    const firstDisabledIdx = list.findIndex((r) => r.type === "segment" && r.id !== "model");
    const positioned = { ...state, selectedIndex: firstDisabledIdx };
    const result = editorReducer(positioned, { type: "toggle" });
    if (result.type === "next") {
      expect(result.state.enabledSegments.length).toBe(2);
    }
  });

  it("toggle hides a shown extension status", () => {
    const state = makeState({ discovered: ["ext-a", "ext-b"] });
    const list = getFilteredRows(state);
    const statusIdx = list.findIndex((r) => r.type === "status" && r.key === "ext-a");
    const positioned = { ...state, selectedIndex: statusIdx };
    expect(positioned.shownStatuses.has("ext-a")).toBe(true);
    const result = editorReducer(positioned, { type: "toggle" });
    if (result.type === "next") {
      expect(result.state.shownStatuses.has("ext-a")).toBe(false);
    }
  });

  it("toggle shows a hidden extension status", () => {
    const state = initEditorState(
      {
        segments: ["model"],
        extensionSegments: { hidden: ["ext-a"] },
      },
      ["ext-a"],
    );
    const list = getFilteredRows(state);
    const statusIdx = list.findIndex((r) => r.type === "status" && r.key === "ext-a");
    const positioned = { ...state, selectedIndex: statusIdx };
    expect(positioned.shownStatuses.has("ext-a")).toBe(false);
    const result = editorReducer(positioned, { type: "toggle" });
    if (result.type === "next") {
      expect(result.state.shownStatuses.has("ext-a")).toBe(true);
    }
  });
});

describe("editorReducer — reorder", () => {
  it("reorder_right swaps segment forward", () => {
    const state = makeState({ segments: ["model", "current-dir", "git-branch"] });
    // selectedIndex 0 → model
    const result = editorReducer(state, { type: "reorder_right" });
    if (result.type === "next") {
      expect(result.state.enabledSegments).toEqual(["current-dir", "model", "git-branch"]);
    }
  });

  it("reorder_left does nothing at index 0", () => {
    const state = makeState({ segments: ["model", "current-dir"] });
    const result = editorReducer(state, { type: "reorder_left" });
    if (result.type === "next") {
      expect(result.state.enabledSegments).toEqual(["model", "current-dir"]);
    }
  });

  it("reorder is disabled while searching", () => {
    const state = { ...makeState({ segments: ["model", "current-dir"] }), query: "m" };
    const result = editorReducer(state, { type: "reorder_right" });
    if (result.type === "next") {
      expect(result.state.enabledSegments).toEqual(["model", "current-dir"]);
    }
  });
});

describe("editorReducer — search", () => {
  it("type_char appends to query", () => {
    const state = makeState();
    const result = editorReducer(state, { type: "type_char", char: "m" });
    if (result.type === "next") {
      expect(result.state.query).toBe("m");
    }
  });

  it("backspace removes last char", () => {
    const state = { ...makeState(), query: "mod" };
    const result = editorReducer(state, { type: "backspace" });
    if (result.type === "next") {
      expect(result.state.query).toBe("mo");
    }
  });

  it("backspace on empty query is no-op", () => {
    const state = makeState();
    const result = editorReducer(state, { type: "backspace" });
    if (result.type === "next") {
      expect(result.state.query).toBe("");
    }
  });
});

describe("editorReducer — save/cancel", () => {
  it("save returns done with config", () => {
    const state = makeState({ segments: ["model"] });
    const result = editorReducer(state, { type: "save" });
    expect(result.type).toBe("done");
    if (result.type === "done") {
      expect(result.config).not.toBeNull();
      expect(result.config?.segments).toEqual(["model"]);
    }
  });

  it("cancel returns done with null", () => {
    const state = makeState();
    const result = editorReducer(state, { type: "cancel" });
    expect(result).toEqual({ type: "done", config: null });
  });
});
