import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fitFooterRow } from "../../src/tui/layout.ts";
import type { FooterLayoutKey } from "../../src/tui/render.ts";

type Item = { key: FooterLayoutKey; text: string; marker: number };
const item = (key: FooterLayoutKey, text: string = key, marker = 0): Item => ({
  key,
  text,
  marker,
});

describe("fitFooterRow", () => {
  it("copies empty rows and rejects zero width", () => {
    const left: Item[] = [item("model")];
    const right: Item[] = [];
    const result = fitFooterRow(left, right, 0, " · ", visibleWidth);
    expect(result).toEqual({ left: [], right: [] });
    expect(result.left).not.toBe(left);
    expect(result.right).not.toBe(right);
  });

  it("keeps a fitting left-only or right-only row", () => {
    expect(fitFooterRow([item("model")], [], 1, " · ", visibleWidth)).toEqual({
      left: [item("model")],
      right: [],
    });
    expect(fitFooterRow([], [item("current-dir")], 1, " · ", visibleWidth)).toEqual({
      left: [],
      right: [item("current-dir")],
    });
  });

  it("measures both sides and separators", () => {
    const result = fitFooterRow(
      [item("model", "aa"), item("current-dir", "bb")],
      [item("git-branch", "cc")],
      7,
      " · ",
      visibleWidth,
    );
    expect(result).toEqual({ left: [item("model", "aa"), item("current-dir", "bb")], right: [] });
  });

  it("measures ANSI text by visible width", () => {
    const red = "\u001b[31mred\u001b[0m";
    expect(
      fitFooterRow([item("model", red)], [item("current-dir", "x")], 5, " · ", visibleWidth),
    ).toEqual({
      left: [item("model", red)],
      right: [item("current-dir", "x")],
    });
  });

  it("removes higher-order items first and keeps survivor order", () => {
    const result = fitFooterRow(
      [item("model", "a", 1), item("current-dir", "b", 2), item("git-branch", "c", 3)],
      [],
      5,
      " · ",
      visibleWidth,
    );
    expect(result.left).toEqual([item("model", "a", 1), item("current-dir", "b", 2)]);
  });

  it("keeps higher-priority right content over lower-priority left content", () => {
    const result = fitFooterRow(
      [item("session-id", "s")],
      [item("model", "m")],
      1,
      " · ",
      visibleWidth,
    );

    expect(result).toEqual({ left: [], right: [item("model", "m")] });
  });

  it("drops a later candidate on a priority tie", () => {
    const result = fitFooterRow([item("model")], [item("run-state")], 1, " · ", visibleWidth);
    expect(result).toEqual({ left: [item("model")], right: [] });
  });

  it("drops extension status before configured segments", () => {
    const result = fitFooterRow(
      [item("model")],
      [item("model", "ext")],
      5,
      " · ",
      visibleWidth,
    );
    expect(result).toEqual({ left: [item("model")], right: [] });
  });

  it("drops telemetry before the existing model anchor", () => {
    expect(
      fitFooterRow(
        [item("model", "m"), item("cache-read-tokens", "cache")],
        [],
        1,
        " · ",
        visibleWidth,
      ),
    ).toEqual({ left: [item("model", "m")], right: [] });
  });

  it("keeps turn progress ahead of response performance at narrow widths", () => {
    const items = [
      item("turn-progress", "t"),
      item("response-performance", "r"),
      item("current-dir", "c"),
    ];
    expect(fitFooterRow(items, [], 5, " · ", visibleWidth).left).toEqual(items.slice(0, 2));
    expect(fitFooterRow(items, [], 1, " · ", visibleWidth).left).toEqual(items.slice(0, 1));
  });

  it("keeps one oversized item rather than removing every item", () => {
    expect(fitFooterRow([item("model", "oversized")], [], 1, " · ", visibleWidth)).toEqual({
      left: [item("model", "oversized")],
      right: [],
    });
  });

  it("preserves generic metadata", () => {
    const source = item("model", "a", 42);
    const result = fitFooterRow([source], [], 1, " · ", visibleWidth);
    expect(result.left[0]).toBe(source);
    expect(result.left[0]?.marker).toBe(42);
  });
});
