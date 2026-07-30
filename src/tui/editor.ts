import { Key, matchesKey, type Component } from "@earendil-works/pi-tui";
import type { PiStatusConfig } from "../shared/types.ts";
import type { FooterRenderInput } from "./render.ts";
import type { StatusLineTheme } from "./theme.ts";
import {
  type EditorAction,
  collectHiddenStatuses,
  editorReducer,
  initEditorState,
} from "./editor-state.ts";
import { renderEditor } from "./editor-render.ts";

export { collectHiddenStatuses };

export function createStatusLineEditor(options: {
  config: PiStatusConfig;
  discoveredStatuses: string[];
  previewInput: Omit<FooterRenderInput, "zones" | "extensionSegments">;
  theme: StatusLineTheme;
  done: (result: PiStatusConfig | null) => void;
  requestRender: () => void;
  usageAvailable?: boolean;
}): Component {
  let state = initEditorState(options.config, options.discoveredStatuses, options.usageAvailable);

  function dispatch(action: EditorAction): void {
    const result = editorReducer(state, action);
    if (result.type === "done") {
      options.done(result.config);
    } else if (result.state !== state) {
      state = result.state;
      options.requestRender();
    }
  }

  return {
    invalidate(): void {},
    handleInput(data: string): void {
      if (matchesKey(data, Key.escape)) return void dispatch({ type: "cancel" });
      if (matchesKey(data, Key.enter)) return void dispatch({ type: "save" });
      if (matchesKey(data, "shift+tab")) return void dispatch({ type: "previous_zone" });
      if (matchesKey(data, Key.tab)) return void dispatch({ type: "next_zone" });
      if (matchesKey(data, Key.up)) return void dispatch({ type: "move_up" });
      if (matchesKey(data, Key.down)) return void dispatch({ type: "move_down" });
      if (matchesKey(data, Key.space)) return void dispatch({ type: "toggle" });
      if (matchesKey(data, Key.left)) return void dispatch({ type: "reorder_left" });
      if (matchesKey(data, Key.right)) return void dispatch({ type: "reorder_right" });
      if (matchesKey(data, Key.backspace)) return void dispatch({ type: "backspace" });
      if (/^[\x21-\x7E]$/.test(data)) return void dispatch({ type: "type_char", char: data });
    },
    render(width: number): string[] {
      return renderEditor(state, options.previewInput, options.theme, width);
    },
  };
}
