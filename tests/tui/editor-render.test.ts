import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initEditorState } from "../../src/tui/editor-state.ts";
import { renderEditor } from "../../src/tui/editor-render.ts";
import { noTheme } from "../../src/tui/theme.ts";

const input = { cwd: "/tmp/test", thinkingLevel: "off", runState: "idle" as const };

function render(width = 80) {
  return renderEditor(
    initEditorState(
      {
        zones: {
          topLeft: ["model-with-reasoning"],
          topRight: ["run-state"],
          bottomLeft: ["current-dir"],
          bottomRight: ["git-branch"],
        },
        extensionSegments: { hidden: [] },
        completionNotifications: false,
      },
      ["alpha"],
    ),
    input,
    noTheme,
    width,
  );
}

describe("renderEditor", () => {
  it("shows four zone tabs and active-zone badges", () => {
    const text = render(200).join("\n");
    expect(text).toContain("TL");
    expect(text).toContain("TR");
    expect(text).toContain("BL");
    expect(text).toContain("BR");
    expect(text).toContain("Model + Reasoning (TL 1)");
    expect(text).toContain("Run State (TR 1)");
    expect(text).toContain("Current Dir (BL 1)");
    expect(text).toContain("Git Branch (BR 1)");
  });

  it("keeps extension statuses in their fixed section and names zone navigation", () => {
    const text = render(200).join("\n");
    expect(text).toContain("Extension statuses (fixed Bottom Right)");
    expect(text).toContain("alpha");
    expect(text).toContain("Tab/Shift+Tab");
  });

  it("labels telemetry choices once", () => {
    const text = render(200).join("\n");
    for (const label of [
      "Cache Read Tokens",
      "Cache Write Tokens",
      "Cache Hit",
      "Session Cost",
      "Access Type",
    ]) {
      expect(text.match(new RegExp(label, "g"))).toHaveLength(1);
    }
  });

  it("renders every footer preview row without exceeding width", () => {
    const lines = render(20);
    expect(lines).toContain("/tmp/test");
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
  });
});
