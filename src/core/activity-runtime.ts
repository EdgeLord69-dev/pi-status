import type { LiveActivitySnapshot, ToolActivity } from "../shared/types.ts";

const RECENT_TOOL_LIMIT = 5;
const TICK_MS = 1_000;

function nonNegativeFinite(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function clampTurnIndex(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function clampElapsed(start: number | undefined, end: number, hadEnd?: number): number {
  if (start === undefined) return 0;
  const reference = hadEnd ?? end;
  return Math.max(0, reference - start);
}

function computeTps(
  outputTokens: number | undefined,
  startedAt: number | undefined,
  firstTokenAt: number | undefined,
  endedAt: number | undefined,
): number | undefined {
  if (
    outputTokens === undefined ||
    startedAt === undefined ||
    firstTokenAt === undefined ||
    endedAt === undefined
  ) {
    return undefined;
  }
  const elapsedMs = Math.max(0, endedAt - startedAt);
  if (elapsedMs <= 0) return undefined;
  return outputTokens / elapsedMs;
}

export interface ActivityRuntime {
  snapshot(): LiveActivitySnapshot;
  setOnChange(listener: (() => void) | undefined): void;
  startRun(at?: number): void;
  finishRun(at?: number): void;
  startTurn(turnIndex: number, at?: number): void;
  finishTurn(at?: number): void;
  startTool(callId: string, name: string, at?: number): void;
  finishTool(callId: string, failed?: boolean, at?: number): void;
  startResponse(at?: number): void;
  updateResponseEstimate(estimatedOutputTokens: number, at?: number): void;
  finishResponse(outputTokens?: number, at?: number): void;
  reset(): void;
}

export function createActivityRuntime(): ActivityRuntime {
  let runStart: number | undefined;
  let runEnd: number | undefined;
  let turnIndex: number | undefined;
  let turnStart: number | undefined;
  let turnEnd: number | undefined;
  const activeTools = new Map<string, ToolActivity>();
  const recentTools: ToolActivity[] = [];
  let responseStartedAt: number | undefined;
  let responseFirstTokenAt: number | undefined;
  let responseEndedAt: number | undefined;
  let responseOutputTokens: number | undefined;
  let responseTokenCountKind: "estimated" | "final" | undefined;
  let responseStatus: "idle" | "streaming" | "complete" = "idle";
  let listener: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastTick = 0;

  function isActive(): boolean {
    if (runStart !== undefined && runEnd === undefined) return true;
    if (turnStart !== undefined && turnEnd === undefined) return true;
    if (responseStatus === "streaming") return true;
    if (activeTools.size > 0) return true;
    return false;
  }

  function scheduleNextTick(): void {
    if (timer) return;
    if (!isActive() || !listener) return;
    timer = setTimeout(tick, TICK_MS);
  }

  function tick(): void {
    timer = undefined;
    if (!isActive() || !listener) return;
    listener();
    scheduleNextTick();
  }

  function restartTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!isActive() || !listener) return;
    scheduleNextTick();
  }

  function notify(): void {
    restartTimer();
    listener?.();
  }

  function startRun(at?: number): void {
    runStart = at ?? Date.now();
    runEnd = undefined;
    turnIndex = undefined;
    turnStart = undefined;
    turnEnd = undefined;
    activeTools.clear();
    recentTools.length = 0;
    responseStartedAt = undefined;
    responseFirstTokenAt = undefined;
    responseEndedAt = undefined;
    responseOutputTokens = undefined;
    responseTokenCountKind = undefined;
    responseStatus = "idle";
    notify();
  }

  function finishRun(at?: number): void {
    const end = at ?? Date.now();
    runEnd = end;
    if (turnStart !== undefined && turnEnd === undefined) {
      turnEnd = end;
    }
    if (responseStatus === "streaming") {
      responseEndedAt = end;
      responseStatus = "complete";
    }
    for (const tool of activeTools.values()) {
      tool.status = "failed";
      tool.endedAt = end;
      tool.durationMs = end - tool.startedAt;
      recentTools.unshift({ ...tool });
    }
    activeTools.clear();
    if (recentTools.length > RECENT_TOOL_LIMIT) {
      recentTools.length = RECENT_TOOL_LIMIT;
    }
    notify();
  }

  function startTurn(turnIndexArg: number, at?: number): void {
    const now = at ?? Date.now();
    if (runStart === undefined) {
      runStart = now;
    }
    const normalized = clampTurnIndex(turnIndexArg);
    if (turnIndex !== undefined && turnStart !== undefined && turnEnd === undefined) {
      if (normalized <= turnIndex + 1) {
        return;
      }
    }
    turnIndex = normalized;
    turnStart = now;
    turnEnd = undefined;
    notify();
  }

  function finishTurn(at?: number): void {
    if (turnStart === undefined) return;
    turnEnd = at ?? Date.now();
    notify();
  }

  function startTool(callId: string, name: string, at?: number): void {
    if (activeTools.has(callId)) return;
    activeTools.set(callId, {
      callId,
      name,
      status: "active",
      startedAt: at ?? Date.now(),
      durationMs: 0,
    });
    notify();
  }

  function finishTool(callId: string, failed?: boolean, at?: number): void {
    const tool = activeTools.get(callId);
    if (!tool) return;
    const end = at ?? Date.now();
    const completed: ToolActivity = {
      ...tool,
      status: failed ? "failed" : "complete",
      endedAt: end,
      durationMs: end - tool.startedAt,
    };
    activeTools.delete(callId);
    recentTools.unshift(completed);
    if (recentTools.length > RECENT_TOOL_LIMIT) {
      recentTools.length = RECENT_TOOL_LIMIT;
    }
    notify();
  }

  function startResponse(at?: number): void {
    responseStartedAt = at ?? Date.now();
    responseFirstTokenAt = undefined;
    responseEndedAt = undefined;
    responseOutputTokens = undefined;
    responseTokenCountKind = undefined;
    responseStatus = "streaming";
    notify();
  }

  function updateResponseEstimate(estimatedOutputTokens: number, at?: number): void {
    if (!Number.isFinite(estimatedOutputTokens)) return;
    if (responseStatus === "complete") return;
    if (responseStartedAt === undefined) return;
    const now = at ?? Date.now();
    if (responseFirstTokenAt === undefined && estimatedOutputTokens > 0) {
      responseFirstTokenAt = now;
    }
    if (responseTokenCountKind !== "final") {
      responseOutputTokens = estimatedOutputTokens;
      responseTokenCountKind = "estimated";
    }
    notify();
  }

  function finishResponse(outputTokens?: number, at?: number): void {
    if (responseStatus === "complete") return;
    if (responseStartedAt === undefined) return;
    const end = at ?? Date.now();
    responseEndedAt = end;
    const final = outputTokens !== undefined ? nonNegativeFinite(outputTokens) : undefined;
    if (final !== undefined) {
      responseOutputTokens = final;
      responseTokenCountKind = "final";
      if (responseFirstTokenAt === undefined && final > 0) {
        responseFirstTokenAt = end;
      }
    } else if (responseOutputTokens === undefined) {
      responseOutputTokens = 0;
    }
    responseStatus = "complete";
    notify();
  }

  function snapshot(): LiveActivitySnapshot {
    const now = Date.now();
    const runStatus =
      runStart === undefined ? "idle" : runEnd === undefined ? "active" : "complete";
    const turnStatus =
      turnStart === undefined ? "idle" : turnEnd === undefined ? "active" : "complete";
    const activeList = [...activeTools.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((tool): ToolActivity => {
        if (tool.status === "active") {
          return {
            ...tool,
            durationMs: Math.max(0, now - tool.startedAt),
          };
        }
        return { ...tool };
      });
    const recentList = recentTools.map((tool) => ({ ...tool }));
    const responseSnap: LiveActivitySnapshot["response"] = {
      status: responseStatus,
    };
    if (responseStartedAt !== undefined) responseSnap.startedAt = responseStartedAt;
    if (responseFirstTokenAt !== undefined) responseSnap.firstTokenAt = responseFirstTokenAt;
    if (responseEndedAt !== undefined) responseSnap.endedAt = responseEndedAt;
    if (responseStartedAt !== undefined && responseFirstTokenAt !== undefined) {
      responseSnap.ttftMs = Math.max(0, responseFirstTokenAt - responseStartedAt);
    }
    if (responseOutputTokens !== undefined) responseSnap.outputTokens = responseOutputTokens;
    if (responseTokenCountKind !== undefined) responseSnap.tokenCountKind = responseTokenCountKind;
    const tps = computeTps(
      responseOutputTokens,
      responseStartedAt,
      responseFirstTokenAt,
      responseEndedAt ?? (responseStatus === "complete" ? now : undefined),
    );
    if (tps !== undefined) responseSnap.tps = tps;
    return {
      run: {
        status: runStatus,
        ...(runStart !== undefined ? { startedAt: runStart } : {}),
        ...(runEnd !== undefined ? { endedAt: runEnd } : {}),
        durationMs: clampElapsed(runStart, now, runEnd),
      },
      turn: {
        status: turnStatus,
        number: turnIndex === undefined ? 0 : turnIndex + 1,
        ...(turnStart !== undefined ? { startedAt: turnStart } : {}),
        ...(turnEnd !== undefined ? { endedAt: turnEnd } : {}),
        durationMs: clampElapsed(turnStart, now, turnEnd),
      },
      activeTools: activeList,
      recentTools: recentList,
      response: responseSnap,
      updatedAt: now,
    };
  }

  function reset(): void {
    const wasActive = isActive();
    runStart = undefined;
    runEnd = undefined;
    turnIndex = undefined;
    turnStart = undefined;
    turnEnd = undefined;
    activeTools.clear();
    recentTools.length = 0;
    responseStartedAt = undefined;
    responseFirstTokenAt = undefined;
    responseEndedAt = undefined;
    responseOutputTokens = undefined;
    responseTokenCountKind = undefined;
    responseStatus = "idle";
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (wasActive) {
      listener?.();
    }
  }

  function setOnChange(cb: (() => void) | undefined): void {
    listener = cb;
    if (cb && isActive()) {
      restartTimer();
    } else if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  return {
    snapshot,
    setOnChange,
    startRun,
    finishRun,
    startTurn,
    finishTurn,
    startTool,
    finishTool,
    startResponse,
    updateResponseEstimate,
    finishResponse,
    reset,
  };
}
