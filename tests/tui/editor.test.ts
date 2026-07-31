import { describe, expect, it, vi } from "vitest";
import type { Component } from "@earendil-works/pi-tui";
import type { PiStatusConfig } from "../../src/shared/types.ts";
import type { FooterRenderInput } from "../../src/tui/render.ts";
import { createStatusLineEditor } from "../../src/tui/editor.ts";
import { noTheme } from "../../src/tui/theme.ts";

type Editor = Component & { handleInput(data: string): void };
const TAB = "\t";
const SHIFT_TAB = "\x1b[Z";

function config(): PiStatusConfig {
  return {
    zones: {
      topLeft: ["model-with-reasoning"],
      topRight: [],
      bottomLeft: ["current-dir"],
      bottomRight: [],
    },
    extensionSegments: { hidden: [] },
    completionNotifications: false,
  };
}

function editor(options: { config?: PiStatusConfig; discovered?: string[] } = {}) {
  const done = vi.fn();
  const component = createStatusLineEditor({
    config: options.config ?? config(),
    discoveredStatuses: options.discovered ?? [],
    previewInput: {
      model: { name: "Test", reasoning: false },
      cwd: "/tmp/test",
      thinkingLevel: "off",
      runState: "idle",
    } satisfies Omit<FooterRenderInput, "zones" | "extensionSegments">,
    theme: noTheme,
    done,
    requestRender: vi.fn(),
  }) as Editor;
  return { component, done };
}

describe("statusline editor input", () => {
  it("uses Tab and Shift+Tab to cycle active zones", () => {
    const { component } = editor();
    expect(component.render(200).join("\n")).toContain("[TL]");
    component.handleInput(TAB);
    expect(component.render(200).join("\n")).toContain("[TR]");
    component.handleInput(SHIFT_TAB);
    expect(component.render(200).join("\n")).toContain("[TL]");
    component.handleInput(SHIFT_TAB);
    expect(component.render(200).join("\n")).toContain("[BR]");
  });

  it("saves zones and status visibility, while cancel returns null", () => {
    const initial = config();
    const saved = editor({ config: initial, discovered: ["alpha"] });
    saved.component.handleInput("\x1b[B");
    saved.component.handleInput(" ");
    saved.component.handleInput("\r");

    expect(saved.done).toHaveBeenCalledWith({
      zones: {
        topLeft: ["model-with-reasoning", "current-dir"],
        topRight: [],
        bottomLeft: [],
        bottomRight: [],
      },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
    });
    expect(initial.zones.bottomLeft).toEqual(["current-dir"]);

    const cancelled = editor();
    cancelled.component.handleInput("\x1b");
    expect(cancelled.done).toHaveBeenCalledWith(null);
  });

  it("searches with printable input and keeps Space reserved for toggling", () => {
    const { component } = editor();
    component.handleInput("m");
    component.handleInput("o");
    component.handleInput(" ");
    expect(component.render(200)[4]).toBe("▸ mo");
    component.handleInput("\x7f");
    expect(component.render(200)[4]).toBe("▸ m");
  });
});
