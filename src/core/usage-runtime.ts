import {
  USAGE_CORE_READY_EVENT,
  USAGE_CORE_REQUEST_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
} from "@pi-vault/pi-usage/events";
import type { UsageCoreState } from "@pi-vault/pi-usage/types";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MINUTE_MS = 60_000;
const REFRESH_REQUEST_TIMEOUT_MS = 10_000;

function isUsageCoreState(value: unknown): value is UsageCoreState {
  return Boolean(value && typeof value === "object");
}

export function createUsageRuntime(pi: ExtensionAPI) {
  let available = false;
  let state: UsageCoreState | undefined;
  let onChange: (() => void) | undefined;
  let autoRefreshEnabled = false;
  let autoRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshInFlight = false;

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

  const requestRefresh = (): Promise<void> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        reject(new Error("usage refresh timed out"));
      }, REFRESH_REQUEST_TIMEOUT_MS);
      timeout.unref?.();
      const settle = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      try {
        pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
          type: "refresh",
          reply(payload: unknown) {
            acceptPayload(payload);
            settle();
          },
        });
      } catch (error) {
        settle(error);
      }
    });

  const scheduleAutoRefresh = (): void => {
    if (!autoRefreshEnabled || autoRefreshTimer) return;
    const remainder = Date.now() % MINUTE_MS;
    const delay = remainder === 0 ? MINUTE_MS : MINUTE_MS - remainder;
    autoRefreshTimer = setTimeout(() => {
      autoRefreshTimer = undefined;
      if (!autoRefreshEnabled) return;
      scheduleAutoRefresh();
      if (refreshInFlight) return;
      refreshInFlight = true;
      void requestRefresh()
        .catch(() => undefined)
        .finally(() => {
          refreshInFlight = false;
        });
    }, delay);
    autoRefreshTimer.unref?.();
  };

  const setAutoRefreshEnabled = (enabled: boolean): void => {
    autoRefreshEnabled = enabled;
    if (!enabled) {
      if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
      autoRefreshTimer = undefined;
      return;
    }
    scheduleAutoRefresh();
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
    requestRefresh,
    setAutoRefreshEnabled,
    dispose(): void {
      setAutoRefreshEnabled(false);
      onChange = undefined;
      unsubscribeReady();
      unsubscribeUpdate();
    },
  };
}
