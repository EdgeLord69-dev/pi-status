import { describe, expect, it, vi } from "vitest";
import { createBus } from "../helpers.ts";
import { createUsageRuntime } from "../../src/core/usage-runtime.ts";

function buildMockPi() {
  const bus = createBus();
  const pi = {
    events: bus,
  } as Parameters<typeof createUsageRuntime>[0];
  return { pi, bus };
}

describe("createUsageRuntime", () => {
  it("starts unavailable with no state", () => {
    const { pi } = buildMockPi();
    const runtime = createUsageRuntime(pi);

    expect(runtime.getAvailable()).toBe(false);
    expect(runtime.getState()).toBeUndefined();

    runtime.dispose();
  });

  it("emits a request event on creation", () => {
    const { pi, bus } = buildMockPi();
    const requests: unknown[] = [];
    bus.on("usage-core:request", (payload) => requests.push(payload));

    createUsageRuntime(pi);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveProperty("type", "current");
    expect(requests[0]).toHaveProperty("reply");
  });

  it("accepts state from the ready event", () => {
    const { pi, bus } = buildMockPi();
    const runtime = createUsageRuntime(pi);

    bus.emit("usage-core:ready", {
      state: { compatibility: { currentLiveProviderSnapshot: null } },
    });

    expect(runtime.getAvailable()).toBe(true);
    expect(runtime.getState()).toEqual({
      compatibility: { currentLiveProviderSnapshot: null },
    });

    runtime.dispose();
  });

  it("accepts state from the update-current event", () => {
    const { pi, bus } = buildMockPi();
    const runtime = createUsageRuntime(pi);

    bus.emit("usage-core:update-current", {
      state: {
        compatibility: {
          currentLiveProviderSnapshot: {
            providerId: "anthropic",
            windows: [{ key: "fiveHour", usedPercent: 40 }],
          },
        },
      },
    });

    expect(runtime.getAvailable()).toBe(true);
    expect(runtime.getState()?.compatibility.currentLiveProviderSnapshot).toEqual({
      providerId: "anthropic",
      windows: [{ key: "fiveHour", usedPercent: 40 }],
    });

    runtime.dispose();
  });

  it("accepts bare state without wrapper object", () => {
    const { pi, bus } = buildMockPi();
    const runtime = createUsageRuntime(pi);

    bus.emit("usage-core:ready", {
      compatibility: { currentLiveProviderSnapshot: null },
    });

    expect(runtime.getAvailable()).toBe(true);
    expect(runtime.getState()).toEqual({
      compatibility: { currentLiveProviderSnapshot: null },
    });

    runtime.dispose();
  });

  it("invokes onChange callback when state updates", () => {
    const { pi, bus } = buildMockPi();
    const runtime = createUsageRuntime(pi);
    const onChange = vi.fn();
    runtime.setOnChange(onChange);

    bus.emit("usage-core:update-current", {
      state: { compatibility: { currentLiveProviderSnapshot: null } },
    });

    expect(onChange).toHaveBeenCalledTimes(1);

    runtime.dispose();
  });

  it("ignores invalid payloads (null, non-object)", () => {
    const { pi, bus } = buildMockPi();
    const runtime = createUsageRuntime(pi);
    const onChange = vi.fn();
    runtime.setOnChange(onChange);

    bus.emit("usage-core:update-current", null);
    bus.emit("usage-core:update-current", "string");
    bus.emit("usage-core:update-current", 42);

    expect(runtime.getAvailable()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    runtime.dispose();
  });

  it("stops receiving events after dispose", () => {
    const { pi, bus } = buildMockPi();
    const runtime = createUsageRuntime(pi);
    const onChange = vi.fn();
    runtime.setOnChange(onChange);

    runtime.dispose();

    bus.emit("usage-core:update-current", {
      state: { compatibility: { currentLiveProviderSnapshot: null } },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(runtime.getAvailable()).toBe(false);
  });

  it("requestCurrent emits request and accepts reply", () => {
    const { pi, bus } = buildMockPi();
    const runtime = createUsageRuntime(pi);

    bus.on("usage-core:request", (payload) => {
      const req = payload as { reply: (data: unknown) => void };
      req.reply({
        state: { compatibility: { currentLiveProviderSnapshot: null } },
      });
    });

    runtime.requestCurrent();

    expect(runtime.getAvailable()).toBe(true);

    runtime.dispose();
  });

  it("force-refreshes at each minute boundary", async () => {
    const now = Date.parse("2026-06-14T10:00:30Z");
    vi.useFakeTimers({ now });
    try {
      const { pi, bus } = buildMockPi();
      const runtime = createUsageRuntime(pi);
      const requests: Array<{ reply: (payload: unknown) => void }> = [];
      bus.on("usage-core:request", (payload) => {
        const request = payload as { type?: string; reply: (payload: unknown) => void };
        if (request.type === "refresh") {
          requests.push(request);
          request.reply({ state: { compatibility: { currentLiveProviderSnapshot: null } } });
        }
      });
      runtime.setAutoRefreshEnabled(true);

      await vi.advanceTimersByTimeAsync(29_999);
      expect(requests).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(requests).toHaveLength(2);

      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not overlap refresh requests", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-06-14T10:00:00Z") });
    try {
      const { pi, bus } = buildMockPi();
      const runtime = createUsageRuntime(pi);
      const requests: Array<{ reply: (payload: unknown) => void }> = [];
      bus.on("usage-core:request", (payload) => {
        const request = payload as { type?: string; reply: (payload: unknown) => void };
        if (request.type === "refresh") requests.push(request);
      });
      runtime.setAutoRefreshEnabled(true);

      vi.advanceTimersByTime(60_000);
      vi.advanceTimersByTime(60_000);
      expect(requests).toHaveLength(1);
      requests[0]?.reply({ state: { compatibility: { currentLiveProviderSnapshot: null } } });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(requests).toHaveLength(2);

      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries when a refresh request is unanswered", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-06-14T10:00:00Z") });
    try {
      const { pi, bus } = buildMockPi();
      const runtime = createUsageRuntime(pi);
      const requests: unknown[] = [];
      bus.on("usage-core:request", (payload) => {
        if ((payload as { type?: string }).type === "refresh") requests.push(payload);
      });
      runtime.setAutoRefreshEnabled(true);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(50_000);
      expect(requests).toHaveLength(2);

      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops scheduled refreshes when disposed", () => {
    vi.useFakeTimers({ now: Date.parse("2026-06-14T10:00:00Z") });
    try {
      const { pi, bus } = buildMockPi();
      const runtime = createUsageRuntime(pi);
      const requests: unknown[] = [];
      bus.on("usage-core:request", (payload) => {
        if ((payload as { type?: string }).type === "refresh") requests.push(payload);
      });
      runtime.setAutoRefreshEnabled(true);
      runtime.dispose();
      vi.advanceTimersByTime(120_000);
      expect(requests).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears onChange on dispose", () => {
    const { pi } = buildMockPi();
    const runtime = createUsageRuntime(pi);
    const onChange = vi.fn();
    runtime.setOnChange(onChange);

    runtime.dispose();

    // Even if events somehow fire, onChange should be cleared
    expect(onChange).not.toHaveBeenCalled();
  });
});
