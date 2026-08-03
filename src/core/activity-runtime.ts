import nodePath from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { LiveActivitySnapshot, ToolActivity } from "../shared/types.ts";

const RECENT_TOOL_LIMIT = 5;
const MAX_SUMMARY_COLUMNS = 26;
const TICK_MS = 1_000;

function clampElapsed(start: number | undefined, end: number, hadEnd?: number): number {
  if (start === undefined) return 0;
  const reference = hadEnd ?? end;
  return Math.max(0, reference - start);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function sanitizeText(value: string): string {
  return (
    value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escape sequences.
      .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip untrusted control characters.
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function safeRelativePath(fromPath: string, toPath: string): string | undefined {
  const relativePath = nodePath.relative(fromPath, toPath);
  if (relativePath === "") return ".";
  if (
    nodePath.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${nodePath.sep}`)
  ) {
    return undefined;
  }
  return relativePath;
}

function shortenPath(pathValue: string, cwd: string): string {
  const safePath = sanitizeText(pathValue);
  if (safePath.length === 0) return "";

  const normalizedCwd = nodePath.resolve(sanitizeText(cwd));
  const normalizedPath = nodePath.isAbsolute(safePath)
    ? nodePath.normalize(safePath)
    : nodePath.resolve(normalizedCwd, safePath);
  const projectRelativePath = safeRelativePath(normalizedCwd, normalizedPath);
  if (projectRelativePath !== undefined) return projectRelativePath;

  const home = sanitizeText(process.env.HOME ?? "");
  if (home.length > 0) {
    const homeRelativePath = safeRelativePath(nodePath.resolve(home), normalizedPath);
    if (homeRelativePath !== undefined)
      return homeRelativePath === "." ? "~" : `~/${homeRelativePath}`;
  }
  return normalizedPath;
}

function truncateSummary(value: string, maxColumns: number): string {
  return sanitizeText(truncateToWidth(value, maxColumns, "…"));
}

function summarizePatternTool(args: Record<string, unknown>, cwd: string): string {
  const pattern = sanitizeText(getString(args, "pattern"));
  if (pattern.length === 0) return "";
  const targetPath = shortenPath(getString(args, "path"), cwd);
  if (targetPath.length === 0) return truncateSummary(pattern, MAX_SUMMARY_COLUMNS);
  const combined = `${pattern} in ${targetPath}`;
  return visibleWidth(combined) <= MAX_SUMMARY_COLUMNS
    ? combined
    : truncateSummary(pattern, MAX_SUMMARY_COLUMNS);
}

export function summarizeTool(name: string, args: unknown, cwd: string): string {
  if (!isRecord(args)) return "";
  switch (name) {
    case "bash":
      return truncateSummary(sanitizeText(getString(args, "command")), MAX_SUMMARY_COLUMNS);
    case "read":
    case "edit":
    case "write":
    case "ls":
      return truncateSummary(shortenPath(getString(args, "path"), cwd), MAX_SUMMARY_COLUMNS);
    case "grep":
    case "find":
      return summarizePatternTool(args, cwd);
    default:
      return "";
  }
}

export function createActivityRuntime() {
  let runStart: number | undefined;
  let runEnd: number | undefined;
  let turnIndex: number | undefined;
  let turnStart: number | undefined;
  let turnEnd: number | undefined;
  const activeTools = new Map<string, ToolActivity>();
  const recentTools: ToolActivity[] = [];
  let completedToolCount = 0;
  let failedToolCount = 0;
  let responseStartedAt: number | undefined;
  let responseFirstTokenAt: number | undefined;
  let responseEndedAt: number | undefined;
  let responseOutputTokens: number | undefined;
  let responseTokenCountKind: "estimated" | "final" | undefined;
  let responseStatus: "idle" | "streaming" | "complete" = "idle";
  let listener: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

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
    completedToolCount = 0;
    failedToolCount = 0;
    responseStartedAt = undefined;
    responseFirstTokenAt = undefined;
    responseEndedAt = undefined;
    responseOutputTokens = undefined;
    responseTokenCountKind = undefined;
    responseStatus = "idle";
    notify();
  }

  function finishRun(at?: number): void {
    if (!isActive()) return;
    const end = at ?? Date.now();
    if (runStart !== undefined) runEnd = end;
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
      tool.durationMs = Math.max(0, end - tool.startedAt);
      recentTools.unshift({ ...tool });
      failedToolCount += 1;
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
    const normalized = Number.isFinite(turnIndexArg) ? Math.max(0, Math.trunc(turnIndexArg)) : 0;
    if (turnIndex !== undefined && normalized <= turnIndex) return;
    turnIndex = normalized;
    turnStart = now;
    turnEnd = undefined;
    notify();
  }

  function finishTurn(at?: number): void {
    if (turnStart === undefined || turnEnd !== undefined) return;
    turnEnd = at ?? Date.now();
    notify();
  }

  function startTool(callId: string, name: string, args: unknown, cwd: string, at?: number): void {
    if (activeTools.has(callId)) return;
    activeTools.set(callId, {
      callId,
      name,
      summary: summarizeTool(name, args, cwd),
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
      durationMs: Math.max(0, end - tool.startedAt),
    };
    activeTools.delete(callId);
    if (failed) failedToolCount += 1;
    else completedToolCount += 1;
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
    if (!Number.isFinite(estimatedOutputTokens) || estimatedOutputTokens <= 0) return;
    if (responseStatus === "complete") return;
    if (responseStartedAt === undefined) return;
    const now = at ?? Date.now();
    if (responseFirstTokenAt === undefined) responseFirstTokenAt = now;
    responseOutputTokens = estimatedOutputTokens;
    responseTokenCountKind = "estimated";
    notify();
  }

  function finishResponse(outputTokens?: number, at?: number): void {
    if (responseStatus === "complete") return;
    if (responseStartedAt === undefined) return;
    const end = at ?? Date.now();
    responseEndedAt = end;
    const final =
      outputTokens !== undefined && Number.isFinite(outputTokens) && outputTokens >= 0
        ? outputTokens
        : undefined;
    if (final !== undefined) {
      responseOutputTokens = final;
      responseTokenCountKind = "final";
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
      .sort((a, b) => a.startedAt - b.startedAt || a.callId.localeCompare(b.callId))
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
    const tpsElapsedMs =
      responseFirstTokenAt === undefined
        ? 0
        : Math.max(0, (responseEndedAt ?? now) - responseFirstTokenAt);
    if (responseOutputTokens !== undefined && tpsElapsedMs > 0) {
      responseSnap.tps = responseOutputTokens / (tpsElapsedMs / 1_000);
    }
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
      completedToolCount,
      failedToolCount,
      response: responseSnap,
      updatedAt: now,
    };
  }

  function reset(): void {
    const hadState =
      runStart !== undefined ||
      turnStart !== undefined ||
      activeTools.size > 0 ||
      recentTools.length > 0 ||
      completedToolCount > 0 ||
      failedToolCount > 0 ||
      responseStatus !== "idle";
    runStart = undefined;
    runEnd = undefined;
    turnIndex = undefined;
    turnStart = undefined;
    turnEnd = undefined;
    activeTools.clear();
    recentTools.length = 0;
    completedToolCount = 0;
    failedToolCount = 0;
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
    if (hadState) {
      listener?.();
    }
  }

  function setOnChange(cb: (() => void) | undefined): void {
    listener = cb;
    restartTimer();
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
