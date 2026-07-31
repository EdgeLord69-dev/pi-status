import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityRuntime } from "../../src/core/activity-runtime.ts";

describe("createActivityRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setClock(ms: number): void {
    vi.setSystemTime(new Date(ms));
  }

  it("starts in an idle snapshot with no active values", () => {
    const runtime = createActivityRuntime();
    const snap = runtime.snapshot();
    expect(snap.run).toEqual({ status: "idle", durationMs: 0 });
    expect(snap.turn).toEqual({ status: "idle", number: 0, durationMs: 0 });
    expect(snap.activeTools).toEqual([]);
    expect(snap.recentTools).toEqual([]);
    expect(snap.response).toEqual({ status: "idle" });
    expect(snap.updatedAt).toBe(0);
  });

  it("exposes one-based turn numbering from the authoritative turn_start index", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTurn(2, 1100);
    expect(runtime.snapshot().turn).toEqual({
      status: "active",
      number: 3,
      startedAt: 1100,
      durationMs: 0,
    });
  });

  it("ignores a duplicate turn_start while a turn is already active", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTurn(0, 1100);
    setClock(1500);
    runtime.startTurn(1, 1500);
    expect(runtime.snapshot().turn).toEqual({
      status: "active",
      number: 1,
      startedAt: 1100,
      durationMs: 400,
    });
  });

  it("replaces the active turn when a later authoritative index arrives", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTurn(0, 1100);
    setClock(1500);
    runtime.startTurn(4, 1500);
    expect(runtime.snapshot().turn).toEqual({
      status: "active",
      number: 5,
      startedAt: 1500,
      durationMs: 0,
    });
  });

  it("ignores a turn_start that supersedes with an earlier or equal index", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTurn(4, 1100);
    setClock(1500);
    runtime.startTurn(2, 1500);
    expect(runtime.snapshot().turn).toEqual({
      status: "active",
      number: 5,
      startedAt: 1100,
      durationMs: 400,
    });
  });

  it("clamps a non-finite or negative turn index to zero", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTurn(Number.NaN, 1100);
    expect(runtime.snapshot().turn.number).toBe(1);
    runtime.startTurn(-10, 1200);
    expect(runtime.snapshot().turn.number).toBe(1);
  });

  it("falls back to starting a run when turn_start arrives without one", () => {
    const runtime = createActivityRuntime();
    runtime.startTurn(0, 1000);
    const snap = runtime.snapshot();
    expect(snap.run.status).toBe("active");
    expect(snap.run.startedAt).toBe(1000);
    expect(snap.turn.status).toBe("active");
    expect(snap.turn.number).toBe(1);
  });

  it("tracks run and turn durations from explicit timestamps", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTurn(0, 1100);
    setClock(1200);
    expect(runtime.snapshot().run.durationMs).toBe(200);
    expect(runtime.snapshot().turn.durationMs).toBe(100);
  });

  it("clamps elapsed time to zero when an end timestamp is before its start", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(2000);
    runtime.startTurn(0, 1900);
    const snap = runtime.snapshot();
    expect(snap.run.durationMs).toBe(0);
    expect(snap.turn.durationMs).toBe(0);
  });

  it("tracks overlapping tools and ignores unknown completions", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTool("a", "read", 1100);
    runtime.startTool("b", "write", 1200);
    runtime.finishTool("a", false, 1500);
    runtime.finishTool("missing", false, 1600);
    const snap = runtime.snapshot();
    expect(snap.activeTools.map((t) => t.name)).toEqual(["write"]);
    expect(snap.recentTools.map((t) => t.name)).toEqual(["read"]);
    expect(snap.recentTools[0]?.durationMs).toBe(400);
  });

  it("ignores duplicate active tool call IDs", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTool("a", "read", 1100);
    runtime.startTool("a", "read", 1200);
    expect(runtime.snapshot().activeTools).toHaveLength(1);
  });

  it("marks settled tools as failed when finishTool is told so", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTool("a", "read", 1100);
    runtime.finishTool("a", true, 1500);
    expect(runtime.snapshot().recentTools[0]?.status).toBe("failed");
  });

  it("keeps only the most recent five completed tools in newest-first order", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    for (let i = 0; i < 7; i++) {
      runtime.startTool(`c${i}`, "read", 1100 + i * 10);
      runtime.finishTool(`c${i}`, false, 1100 + i * 10 + 5);
    }
    const snap = runtime.snapshot();
    expect(snap.recentTools).toHaveLength(5);
    expect(snap.recentTools.map((t) => t.callId)).toEqual(["c6", "c5", "c4", "c3", "c2"]);
  });

  it("records TTFT on the first positive full-message estimate", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startResponse(1100);
    runtime.updateResponseEstimate(0, 1200);
    runtime.updateResponseEstimate(50, 1300);
    const snap = runtime.snapshot();
    expect(snap.response.status).toBe("streaming");
    expect(snap.response.firstTokenAt).toBe(1300);
    expect(snap.response.ttftMs).toBe(200);
    expect(snap.response.outputTokens).toBe(50);
    expect(snap.response.tokenCountKind).toBe("estimated");
  });

  it("keeps TTFT unset when the streaming estimate never produces a positive value", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startResponse(1100);
    runtime.updateResponseEstimate(0, 1200);
    runtime.finishResponse(0, 1500);
    const snap = runtime.snapshot();
    expect(snap.response.status).toBe("complete");
    expect(snap.response.firstTokenAt).toBeUndefined();
    expect(snap.response.ttftMs).toBeUndefined();
    expect(snap.response.tps).toBeUndefined();
  });

  it("ignores non-finite token estimates", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startResponse(1100);
    runtime.updateResponseEstimate(Number.NaN, 1200);
    runtime.updateResponseEstimate(Number.POSITIVE_INFINITY, 1300);
    runtime.finishResponse(40, 1400);
    const snap = runtime.snapshot();
    expect(snap.response.status).toBe("complete");
    expect(snap.response.firstTokenAt).toBe(1400);
    expect(snap.response.ttftMs).toBe(300);
    expect(snap.response.outputTokens).toBe(40);
    expect(snap.response.tokenCountKind).toBe("final");
  });

  it("uses official output usage when final, otherwise keeps the estimate as estimated", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startResponse(1100);
    runtime.updateResponseEstimate(120, 1500);
    runtime.finishResponse(200, 2000);
    const snap = runtime.snapshot();
    expect(snap.response.status).toBe("complete");
    expect(snap.response.outputTokens).toBe(200);
    expect(snap.response.tokenCountKind).toBe("final");
    expect(snap.response.tps).toBeCloseTo(200 / 900, 5);
  });

  it("keeps the final output usage once zero or negative", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startResponse(1100);
    runtime.updateResponseEstimate(120, 1500);
    runtime.finishResponse(0, 2000);
    const snap = runtime.snapshot();
    expect(snap.response.outputTokens).toBe(0);
    expect(snap.response.tokenCountKind).toBe("final");
  });

  it("falls back to the latest estimate when no final usage is provided", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startResponse(1100);
    runtime.updateResponseEstimate(80, 1400);
    runtime.finishResponse(undefined, 1800);
    const snap = runtime.snapshot();
    expect(snap.response.status).toBe("complete");
    expect(snap.response.outputTokens).toBe(80);
    expect(snap.response.tokenCountKind).toBe("estimated");
    expect(snap.response.tps).toBeCloseTo(80 / 700, 5);
  });

  it("ignores a non-finite final usage value", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startResponse(1100);
    runtime.updateResponseEstimate(80, 1400);
    runtime.finishResponse(Number.NaN, 1800);
    const snap = runtime.snapshot();
    expect(snap.response.outputTokens).toBe(80);
    expect(snap.response.tokenCountKind).toBe("estimated");
  });

  it("startResponse clears the previous response", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startResponse(1100);
    runtime.updateResponseEstimate(50, 1300);
    runtime.startResponse(2000);
    const response = runtime.snapshot().response;
    expect(response.status).toBe("streaming");
    expect(response.startedAt).toBe(2000);
    expect(response).not.toHaveProperty("firstTokenAt");
    expect(response).not.toHaveProperty("outputTokens");
    expect(response).not.toHaveProperty("tokenCountKind");
  });

  it("returns fresh array and tool records on every snapshot", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTool("a", "read", 1100);
    const first = runtime.snapshot();
    first.activeTools.length = 0;
    first.recentTools.push({} as never);
    const second = runtime.snapshot();
    expect(second.activeTools).toHaveLength(1);
    expect(second.recentTools).toHaveLength(0);
    second.activeTools[0]!.durationMs = 999;
    expect(runtime.snapshot().activeTools[0]?.durationMs).not.toBe(999);
  });

  it("keeps completed tool durations immutable across snapshots", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTool("a", "read", 1100);
    runtime.finishTool("a", false, 1500);
    const snap = runtime.snapshot();
    expect(snap.recentTools[0]?.durationMs).toBe(400);
    setClock(2500);
    expect(runtime.snapshot().recentTools[0]?.durationMs).toBe(400);
  });

  it("finishRun completes the run and active turn without inventing failure states", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTurn(0, 1100);
    runtime.finishRun(2000);
    const snap = runtime.snapshot();
    expect(snap.run).toEqual({
      status: "complete",
      startedAt: 1000,
      endedAt: 2000,
      durationMs: 1000,
    });
    expect(snap.turn).toEqual({
      status: "complete",
      number: 1,
      startedAt: 1100,
      endedAt: 2000,
      durationMs: 900,
    });
    expect(snap.run.status).toBe("complete");
  });

  it("finishRun moves any leftover active tools to recent as failed", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTool("a", "read", 1100);
    runtime.startTool("b", "write", 1200);
    runtime.finishRun(2000);
    const snap = runtime.snapshot();
    expect(snap.activeTools).toEqual([]);
    expect(snap.recentTools.map((t) => [t.callId, t.status])).toEqual([
      ["b", "failed"],
      ["a", "failed"],
    ]);
  });

  it("finishRun preserves available response metrics when the response was still streaming", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startResponse(1100);
    runtime.updateResponseEstimate(80, 1400);
    runtime.finishRun(2000);
    const snap = runtime.snapshot();
    expect(snap.response.status).toBe("complete");
    expect(snap.response.outputTokens).toBe(80);
    expect(snap.response.tokenCountKind).toBe("estimated");
    expect(snap.response.tps).toBeCloseTo(80 / 900, 5);
  });

  it("finishRun is idempotent and does not move already-settled tools", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTool("a", "read", 1100);
    runtime.finishTool("a", false, 1500);
    runtime.finishRun(2000);
    runtime.finishRun(3000);
    const snap = runtime.snapshot();
    expect(snap.recentTools).toHaveLength(1);
    expect(snap.recentTools[0]?.status).toBe("complete");
  });

  it("reset returns an idle snapshot, clears the timer, and notifies on real change", () => {
    const runtime = createActivityRuntime();
    const listener = vi.fn();
    runtime.setOnChange(listener);
    runtime.startRun(1000);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.reset();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(runtime.snapshot().run.status).toBe("idle");
    vi.advanceTimersByTime(5_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reset does not notify when there was no active state", () => {
    const runtime = createActivityRuntime();
    const listener = vi.fn();
    runtime.setOnChange(listener);
    runtime.reset();
    expect(listener).not.toHaveBeenCalled();
  });

  it("remains reusable after reset", () => {
    const runtime = createActivityRuntime();
    runtime.startRun(1000);
    runtime.startTurn(0, 1100);
    runtime.reset();
    runtime.startRun(2000);
    runtime.startTurn(2, 2100);
    const snap = runtime.snapshot();
    expect(snap.run).toMatchObject({ status: "active", startedAt: 2000 });
    expect(snap.turn).toEqual({
      status: "active",
      number: 3,
      startedAt: 2100,
      durationMs: 0,
    });
  });

  it("starts the interval only when activity is active and stops it on settlement", () => {
    const runtime = createActivityRuntime();
    const listener = vi.fn();
    runtime.setOnChange(listener);
    vi.advanceTimersByTime(2_000);
    expect(listener).not.toHaveBeenCalled();

    runtime.startRun(1000);
    listener.mockClear();
    vi.advanceTimersByTime(1_000);
    expect(listener).toHaveBeenCalledTimes(1);

    runtime.finishRun(2000);
    listener.mockClear();
    vi.advanceTimersByTime(5_000);
    expect(listener).toHaveBeenCalledTimes(0);
  });

  it("fires onChange while a response is streaming", () => {
    const runtime = createActivityRuntime();
    const listener = vi.fn();
    runtime.setOnChange(listener);
    runtime.startRun(1000);
    runtime.startResponse(1100);
    listener.mockClear();
    vi.advanceTimersByTime(2_000);
    expect(listener).toHaveBeenCalledTimes(2);
    runtime.finishResponse(10, 2100);
    runtime.finishRun(3000);
    listener.mockClear();
    vi.advanceTimersByTime(5_000);
    expect(listener).toHaveBeenCalledTimes(0);
  });

  it("setOnChange(undefined) clears the listener", () => {
    const runtime = createActivityRuntime();
    const listener = vi.fn();
    runtime.setOnChange(listener);
    runtime.setOnChange(undefined);
    runtime.startRun(1000);
    expect(listener).not.toHaveBeenCalled();
  });
});
