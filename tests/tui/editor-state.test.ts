import { describe, expect, it } from "vitest";
import {
  editorReducer,
  getFilteredRows,
  getInteractiveRows,
  initEditorState,
} from "../../src/tui/editor-state.ts";
import type { PiStatusConfig, StatusLineZones } from "../../src/shared/types.ts";

function zones(overrides: Partial<StatusLineZones> = {}): StatusLineZones {
  return {
    topLeft: ["model-with-reasoning"],
    topRight: [],
    bottomLeft: ["current-dir"],
    bottomRight: [],
    ...overrides,
  };
}

function config(overrides: Partial<PiStatusConfig> = {}): PiStatusConfig {
  return { zones: zones(), extensionSegments: { hidden: [] }, ...overrides };
}

function next(
  state: ReturnType<typeof initEditorState>,
  action: Parameters<typeof editorReducer>[1],
) {
  const result = editorReducer(state, action);
  if (result.type !== "next") throw new Error("expected next state");
  return result.state;
}

describe("editor zones", () => {
  it("deep-copies zones and starts on top-left", () => {
    const source = config({ zones: zones({ topRight: ["git-branch"] }) });
    const state = initEditorState(source, []);
    source.zones.topRight.push("model");

    expect(state.zones).toEqual(zones({ topRight: ["git-branch"] }));
    expect(state.activeZone).toBe("topLeft");
  });

  it("tabs forward and backward with wraparound", () => {
    const state = initEditorState(config(), []);
    expect(next(state, { type: "next_zone" }).activeZone).toBe("topRight");
    expect(next(state, { type: "previous_zone" }).activeZone).toBe("bottomRight");
  });

  it("orders assigned rows by zone then keeps unassigned rows canonical", () => {
    const state = initEditorState(
      config({
        zones: zones({
          topLeft: ["git-branch"],
          topRight: ["current-dir"],
          bottomLeft: ["model"],
          bottomRight: ["run-state"],
        }),
      }),
      [],
    );
    const ids = getInteractiveRows(state)
      .filter((row): row is { type: "segment"; id: never } => row.type === "segment")
      .map((row) => row.id);
    expect(ids.slice(0, 4)).toEqual(["git-branch", "current-dir", "model", "run-state"]);
    expect(ids.slice(4, 7)).toEqual(["model-with-reasoning", "project-name", "context-remaining"]);
  });
});

describe("editor zone actions", () => {
  it("moves a selected segment into the active zone without duplicates", () => {
    let state = initEditorState(config(), []);
    state = next(state, { type: "next_zone" });
    const index = getFilteredRows(state).findIndex(
      (row) => row.type === "segment" && row.id === "current-dir",
    );
    state = next({ ...state, selectedIndex: index }, { type: "toggle" });
    const unassignedIndex = getFilteredRows(state).findIndex(
      (row) => row.type === "segment" && row.id === "current-dir",
    );
    state = next({ ...state, selectedIndex: unassignedIndex }, { type: "toggle" });

    expect(state.zones.topRight).toEqual(["current-dir"]);
    expect(state.zones.bottomLeft).toEqual([]);
  });

  it("removes from whichever zone holds it but protects the last assigned segment", () => {
    let state = initEditorState(config({ zones: zones({ bottomLeft: [] }) }), []);
    state = next(state, { type: "toggle" });
    expect(state.zones.topLeft).toEqual(["model-with-reasoning"]);

    state = initEditorState(config(), []);
    state = next(state, { type: "toggle" });
    expect(state.zones.topLeft).toEqual([]);
  });

  it("reorders only inside the active zone and not while searching", () => {
    let state = initEditorState(config({ zones: zones({ topLeft: ["model", "git-branch"] }) }), []);
    state = next(state, { type: "reorder_right" });
    expect(state.zones.topLeft).toEqual(["git-branch", "model"]);

    state = next(state, { type: "type_char", char: "m" });
    state = next(state, { type: "reorder_left" });
    expect(state.zones.topLeft).toEqual(["git-branch", "model"]);
  });

  it("saves a deep zone config and keeps extension status toggles separate", () => {
    let state = initEditorState(config(), ["alpha"]);
    const statusIndex = getFilteredRows(state).findIndex(
      (row) => row.type === "status" && row.key === "alpha",
    );
    state = next({ ...state, selectedIndex: statusIndex }, { type: "toggle" });
    const result = editorReducer(state, { type: "save" });

    expect(result).toEqual({
      type: "done",
      config: { zones: zones(), extensionSegments: { hidden: ["alpha"] } },
    });
  });
});
