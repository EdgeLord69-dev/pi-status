import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiStatusConfig } from "../shared/types.ts";

export type RuntimeEvent =
  | { type: "session_start"; ctx: ExtensionContext }
  | { type: "session_tree"; ctx: ExtensionContext }
  | { type: "model_select"; ctx: ExtensionContext }
  | { type: "thinking_level_changed"; ctx: ExtensionContext; level: string }
  | { type: "session_shutdown" }
  | { type: "config_reload"; config: PiStatusConfig };

export interface RuntimeSnapshot {
  ctx: ExtensionContext | undefined;
  config: PiStatusConfig;
  thinkingLevel: string;
}

export interface RuntimeStateMachine {
  update(event: RuntimeEvent): void;
  snapshot(): RuntimeSnapshot;
  onInvalidate(cb: (() => void) | undefined): void;
  dispose(): void;
}

export function createRuntimeStateMachine(
  initialConfig: PiStatusConfig,
  initialThinkingLevel: string,
): RuntimeStateMachine {
  let ctx: ExtensionContext | undefined;
  let config = initialConfig;
  let thinkingLevel = initialThinkingLevel;
  let listener: (() => void) | undefined;

  function invalidate(): void {
    listener?.();
  }

  return {
    update(event: RuntimeEvent): void {
      switch (event.type) {
        case "session_start":
        case "session_tree":
        case "model_select":
          ctx = event.ctx;
          break;
        case "thinking_level_changed":
          ctx = event.ctx;
          thinkingLevel = event.level;
          break;
        case "session_shutdown":
          ctx = undefined;
          break;
        case "config_reload":
          config = event.config;
          break;
      }
      invalidate();
    },
    snapshot(): RuntimeSnapshot {
      return { ctx, config, thinkingLevel };
    },
    onInvalidate(cb: (() => void) | undefined): void {
      listener = cb;
    },
    dispose(): void {
      listener = undefined;
    },
  };
}
