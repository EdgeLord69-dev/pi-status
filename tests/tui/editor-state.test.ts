import { describe, expect, it } from "vitest";
import {
  SEGMENT_METADATA,
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
  return {
    zones: zones(),
    extensionSegments: { hidden: [] },
    ...overrides,
    completionNotifications: overrides.completionNotifications ?? false,
  };
}

function configWith(
  completionNotifications: boolean,
  overrides: Partial<PiStatusConfig> = {},
): PiStatusConfig {
  return config({ ...overrides, completionNotifications });
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
  it("describes both live activity segments", () => {
    expect(SEGMENT_METADATA.get("turn-progress")).toMatchObject({ label: "Turn Progress" });
    expect(SEGMENT_METADATA.get("response-performance")).toMatchObject({
      label: "Response Performance",
    });
  });

  it("lists and searches all telemetry segment choices", () => {
    const state = initEditorState(config(), []);
    const telemetry = [
      "cache-read-tokens",
      "cache-write-tokens",
      "cache-hit",
      "session-cost",
      "access-type",
    ];
    const ids = getInteractiveRows(state)
      .filter((row): row is { type: "segment"; id: never } => row.type === "segment")
      .map((row) => row.id);
    expect(ids.filter((id) => telemetry.includes(id))).toEqual(telemetry);
    expect(
      getFilteredRows({ ...state, query: "cache" })
        .filter((row): row is { type: "segment"; id: never } => row.type === "segment")
        .map((row) => row.id),
    ).toEqual(expect.arrayContaining(["cache-read-tokens", "cache-write-tokens", "cache-hit"]));
  });

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

  it("clamps navigation when selection or search results change", () => {
    const state = initEditorState(config(), []);
    const lastIndex = getFilteredRows(state).length - 1;
    expect(next({ ...state, selectedIndex: lastIndex }, { type: "move_down" }).selectedIndex).toBe(
      lastIndex,
    );
    expect(
      next({ ...state, selectedIndex: lastIndex, query: "no-match" }, { type: "move_down" })
        .selectedIndex,
    ).toBe(0);
  });

  it("searches segment metadata and extension status keys", () => {
    const state = initEditorState(config(), ["alpha"]);
    const segmentMatches = getFilteredRows({ ...state, query: "git" }).map((row) =>
      row.type === "segment" ? row.id : row.key,
    );
    expect(segmentMatches).toContain("git-branch");
    expect(segmentMatches).not.toContain("run-state");
    expect(
      getFilteredRows({ ...state, query: "alpha" }).map((row) =>
        row.type === "segment" ? row.id : row.key,
      ),
    ).toContain("alpha");
  });

  it("hides unavailable usage choices without dropping assigned values on save", () => {
    const state = initEditorState(
      config({ zones: zones({ topLeft: ["five-hour-limit", "model"] }) }),
      [],
      false,
    );

    expect(state.visibleSegments.map(({ id }) => id)).not.toContain("five-hour-limit");
    expect(editorReducer(state, { type: "save" })).toEqual({
      type: "done",
      config: {
        zones: zones({ topLeft: ["five-hour-limit", "model"] }),
        extensionSegments: { hidden: [] },
        completionNotifications: false,
      },
    });
  });
});

describe("editor zone actions", () => {
  it("toggles and reorders a telemetry segment through the generic editor actions", () => {
    let state = initEditorState(
      config({ zones: zones({ topLeft: ["model"], bottomLeft: [] }) }),
      [],
    );
    let index = getFilteredRows(state).findIndex(
      (row) => row.type === "segment" && row.id === "session-cost",
    );
    state = next({ ...state, selectedIndex: index }, { type: "toggle" });
    expect(state.zones.topLeft).toEqual(["model", "session-cost"]);

    index = getFilteredRows(state).findIndex(
      (row) => row.type === "segment" && row.id === "session-cost",
    );
    state = next({ ...state, selectedIndex: index }, { type: "reorder_left" });
    expect(state.zones.topLeft).toEqual(["session-cost", "model"]);
  });

  it("moves a selected segment into the active zone without duplicates", () => {
    let state = initEditorState(config(), []);
    state = next(state, { type: "next_zone" });
    const index = getFilteredRows(state).findIndex(
      (row) => row.type === "segment" && row.id === "current-dir",
    );
    state = next({ ...state, selectedIndex: index }, { type: "toggle" });

    expect(state.zones.topRight).toEqual(["current-dir"]);
    expect(state.zones.bottomLeft).toEqual([]);
  });

  it("moves the sole assigned segment instead of blocking it", () => {
    const state = initEditorState(
      config({
        zones: zones({
          topLeft: [],
          bottomLeft: ["current-dir"],
        }),
      }),
      [],
    );
    const index = getFilteredRows(state).findIndex(
      (row) => row.type === "segment" && row.id === "current-dir",
    );
    const moved = next({ ...state, selectedIndex: index }, { type: "toggle" });

    expect(moved.zones.topLeft).toEqual(["current-dir"]);
    expect(moved.zones.bottomLeft).toEqual([]);
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

  it("keeps reorder at zone boundaries and outside the active zone as no-ops", () => {
    const state = initEditorState(
      config({ zones: zones({ topLeft: ["model", "git-branch"] }) }),
      [],
    );
    expect(next(state, { type: "reorder_left" }).zones).toEqual(state.zones);

    const topRight = next(state, { type: "next_zone" });
    expect(next(topRight, { type: "reorder_right" }).zones).toEqual(state.zones);
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
      config: {
        zones: zones(),
        extensionSegments: { hidden: ["alpha"] },
        completionNotifications: false,
      },
    });
  });

  it("shows an initially hidden status and cancels without a config", () => {
    let state = initEditorState(config({ extensionSegments: { hidden: ["alpha"] } }), ["alpha"]);
    const statusIndex = getFilteredRows(state).findIndex(
      (row) => row.type === "status" && row.key === "alpha",
    );
    state = next({ ...state, selectedIndex: statusIndex }, { type: "toggle" });

    expect(editorReducer(state, { type: "save" })).toMatchObject({
      config: { extensionSegments: { hidden: [] } },
    });
    expect(editorReducer(state, { type: "cancel" })).toEqual({ type: "done", config: null });
  });

  it("returns zone arrays that do not alias editor state", () => {
    const state = initEditorState(config(), []);
    const result = editorReducer(state, { type: "save" });
    if (result.type !== "done" || !result.config) throw new Error("expected saved config");

    result.config.zones.topLeft.push("model");

    expect(state.zones.topLeft).toEqual(["model-with-reasoning"]);
  });

  it("carries the completion notification preference through init and save when true", () => {
    const state = initEditorState(configWith(true), []);
    const result = editorReducer(state, { type: "save" });
    if (result.type !== "done" || !result.config) throw new Error("expected saved config");
    expect(result.config.completionNotifications).toBe(true);
  });

  it("carries the completion notification preference through init and save when false", () => {
    const state = initEditorState(configWith(false), []);
    const result = editorReducer(state, { type: "save" });
    if (result.type !== "done" || !result.config) throw new Error("expected saved config");
    expect(result.config.completionNotifications).toBe(false);
  });

  it("preserves the completion notification preference across segment and status edits", () => {
    let state = initEditorState(configWith(true), ["alpha"]);
    const statusIndex = getFilteredRows(state).findIndex(
      (row) => row.type === "status" && row.key === "alpha",
    );
    state = next({ ...state, selectedIndex: statusIndex }, { type: "toggle" });
    const result = editorReducer(state, { type: "save" });
    if (result.type !== "done" || !result.config) throw new Error("expected saved config");
    expect(result.config.completionNotifications).toBe(true);
    expect(result.config.extensionSegments).toEqual({ hidden: ["alpha"] });
  });

  it("does not expose a toggle that changes the completion notification preference", () => {
    const state = initEditorState(configWith(true), []);
    const actions: Parameters<typeof editorReducer>[1][] = [
      { type: "move_up" },
      { type: "move_down" },
      { type: "next_zone" },
      { type: "previous_zone" },
      { type: "toggle" },
      { type: "reorder_left" },
      { type: "reorder_right" },
      { type: "type_char", char: "x" },
      { type: "backspace" },
    ];
    for (const action of actions) {
      const after = editorReducer(state, action);
      if (after.type === "next") {
        expect(after.state.completionNotifications).toBe(true);
      }
    }
  });
});
