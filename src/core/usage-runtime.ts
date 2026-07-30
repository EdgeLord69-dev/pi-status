import {
  USAGE_CORE_READY_EVENT,
  USAGE_CORE_REQUEST_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
} from "@pi-vault/pi-usage/events";
import type { UsageCoreState } from "@pi-vault/pi-usage/types";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isUsageCoreState(value: unknown): value is UsageCoreState {
  return Boolean(value && typeof value === "object");
}

export function createUsageRuntime(pi: ExtensionAPI) {
  let available = false;
  let state: UsageCoreState | undefined;
  let onChange: (() => void) | undefined;

  const acceptPayload = (payload: unknown): void => {
    if (!payload || typeof payload !== "object") return;
    const maybe = payload as { state?: unknown };
    const next = maybe.state ?? payload;
    if (!isUsageCoreState(next)) return;
    state = next;
    available = true;
    onChange?.();
  };

  const requestCurrent = (): void => {
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
      type: "current",
      reply(payload: unknown) {
        acceptPayload(payload);
      },
    });
  };

  const unsubscribeReady = pi.events.on(USAGE_CORE_READY_EVENT, acceptPayload);
  const unsubscribeUpdate = pi.events.on(USAGE_CORE_UPDATE_CURRENT_EVENT, acceptPayload);

  requestCurrent();

  return {
    getAvailable(): boolean {
      return available;
    },
    getState(): UsageCoreState | undefined {
      return state;
    },
    setOnChange(listener: (() => void) | undefined): void {
      onChange = listener;
    },
    requestCurrent,
    dispose(): void {
      onChange = undefined;
      unsubscribeReady();
      unsubscribeUpdate();
    },
  };
}
