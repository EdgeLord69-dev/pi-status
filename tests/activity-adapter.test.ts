import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import createExtension from "../src/index.ts";
import { buildPiWithHandlers, createContext } from "./helpers.ts";

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-status-activity-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(
    join(agentDir, "extensions", "statusline.json"),
    JSON.stringify({
      zones: {
        topLeft: ["turn-progress", "response-performance"],
        topRight: [],
        bottomLeft: [],
        bottomRight: [],
      },
      extensionSegments: { hidden: [] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    }),
    "utf8",
  );
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

function setup() {
  const { pi, handlers } = buildPiWithHandlers();
  createExtension(pi);
  return handlers;
}

function call<T>(
  handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>,
  name: string,
  event: T,
  ctx: ExtensionContext,
): void {
  for (const h of handlers.get(name) ?? []) h(event, ctx);
}

function newCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return createContext(overrides);
}

function attachFooter(
  handlers: ReturnType<typeof setup>,
  overrides: Partial<ExtensionContext> = {},
) {
  const requestRender = vi.fn();
  let footerFactory: ((...args: unknown[]) => { render: (width: number) => string[] }) | undefined;
  const ctx = newCtx({
    ...overrides,
    ui: {
      ...newCtx().ui,
      ...overrides.ui,
      setFooter: (x: unknown) => (footerFactory = x as never),
    },
  });
  for (const h of handlers.get("session_start") ?? []) h({}, ctx);
  const footer = footerFactory?.(
    { requestRender },
    { fg: (_c: string, t: string) => t },
    {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map(),
    },
  );
  return {
    ctx,
    requestRender,
    render(width: number): string {
      return (footer?.render(width) ?? []).join("\n");
    },
  };
}

describe("activity event wiring", () => {
  it("renders the one-based turn number from the authoritative turn_start index", () => {
    const handlers = setup();
    const session = attachFooter(handlers);
    call(handlers, "agent_start", {}, session.ctx);
    call(handlers, "turn_start", { turnIndex: 0, timestamp: 1000 }, session.ctx);
    const initial = session.render(120);
    expect(initial).toContain("Turn 1");

    call(handlers, "turn_start", { turnIndex: 1, timestamp: 2000 }, session.ctx);
    const updated = session.render(120);
    expect(updated).toContain("Turn 2");
  });

  it("ignores activity events from non-TUI sessions", () => {
    const handlers = setup();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const ctx = newCtx({
      mode: "rpc",
      ui: {
        ...newCtx().ui,
        setFooter: (x: unknown) => (footerFactory = x as never),
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(footerFactory).toBeUndefined();
    call(handlers, "agent_start", {}, ctx);
    call(handlers, "turn_start", { turnIndex: 0, timestamp: 1000 }, ctx);
    call(handlers, "before_provider_request", { payload: {} }, ctx);
    call(
      handlers,
      "message_update",
      {
        message: { role: "assistant" },
        assistantMessageEvent: { type: "text_delta", delta: "hi" },
      },
      ctx,
    );
    call(handlers, "message_end", { message: { role: "assistant", usage: { output: 10 } } }, ctx);
    call(handlers, "tool_execution_start", { toolCallId: "a", toolName: "read", args: {} }, ctx);
    call(
      handlers,
      "tool_execution_end",
      { toolCallId: "a", toolName: "read", result: {}, isError: false },
      ctx,
    );
    call(
      handlers,
      "turn_end",
      { turnIndex: 0, message: { role: "assistant" }, toolResults: [] },
      ctx,
    );
    call(handlers, "agent_settled", {}, ctx);
    expect(footerFactory).toBeUndefined();
  });

  it("ignores stale activity events from a previous session manager", () => {
    const handlers = setup();
    const ctxA = newCtx();
    for (const h of handlers.get("session_start") ?? []) h({}, ctxA);
    const current = attachFooter(handlers);
    call(handlers, "agent_start", {}, current.ctx);
    call(handlers, "turn_start", { turnIndex: 0, timestamp: 1000 }, current.ctx);
    const before = current.render(120);
    call(handlers, "agent_start", {}, ctxA);
    call(handlers, "turn_start", { turnIndex: 4, timestamp: 2000 }, ctxA);
    call(handlers, "tool_execution_start", { toolCallId: "a", toolName: "read", args: {} }, ctxA);
    expect(current.render(120)).toBe(before);
  });

  it("ignores stale shutdowns without clearing the current footer", () => {
    const handlers = setup();
    const ctxA = newCtx();
    for (const h of handlers.get("session_start") ?? []) h({}, ctxA);
    const current = attachFooter(handlers);
    call(handlers, "agent_start", {}, current.ctx);
    call(handlers, "turn_start", { turnIndex: 0, timestamp: 1000 }, current.ctx);

    call(handlers, "session_shutdown", {}, ctxA);

    expect(current.render(120)).toContain("Turn 1");
  });

  it("keeps the run active until agent_settled reports an idle context", () => {
    let idle = false;
    const handlers = setup();
    const session = attachFooter(handlers, { isIdle: () => idle });
    call(handlers, "agent_start", {}, session.ctx);
    const activeRenderCount = session.requestRender.mock.calls.length;
    call(handlers, "agent_settled", {}, session.ctx);
    expect(session.requestRender).toHaveBeenCalledTimes(activeRenderCount);

    idle = true;
    call(handlers, "agent_settled", {}, session.ctx);
    expect(session.requestRender).toHaveBeenCalledTimes(activeRenderCount + 1);
  });

  it("wires footer re-render to the activity runtime", () => {
    const handlers = setup();
    const session = attachFooter(handlers);
    session.render(120);
    expect(session.requestRender).not.toHaveBeenCalled();
    call(handlers, "agent_start", {}, session.ctx);
    expect(session.requestRender).toHaveBeenCalled();
  });

  it("renders response and tool activity from Pi events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const handlers = setup();
    const session = attachFooter(handlers);
    call(handlers, "agent_start", {}, session.ctx);
    call(handlers, "turn_start", { turnIndex: 0, timestamp: 1000 }, session.ctx);

    vi.setSystemTime(1100);
    call(handlers, "before_provider_request", { payload: {} }, session.ctx);
    vi.setSystemTime(1300);
    call(
      handlers,
      "message_update",
      {
        message: { role: "assistant", content: [{ type: "thinking", thinking: "abcdefgh" }] },
      },
      session.ctx,
    );
    expect(session.render(200)).toContain("TTFT 200ms");

    vi.setSystemTime(2300);
    expect(session.render(200)).toContain("~2.0 tok/s");
    call(
      handlers,
      "tool_execution_start",
      { toolCallId: "a", toolName: "read", args: {} },
      session.ctx,
    );
    expect(session.render(200)).toContain("read");
    vi.setSystemTime(2600);
    call(
      handlers,
      "tool_execution_end",
      { toolCallId: "a", toolName: "read", result: {}, isError: false },
      session.ctx,
    );
    expect(session.render(200)).toContain("read <1s");

    vi.setSystemTime(3300);
    call(
      handlers,
      "message_end",
      { message: { role: "assistant", content: [], usage: { output: 4 } } },
      session.ctx,
    );
    expect(session.render(200)).toContain("2.0 tok/s");
    expect(session.render(200)).not.toContain("~2.0 tok/s");
  });

  it("resets the activity runtime on session replacement and on shutdown", () => {
    const handlers = setup();
    const session = attachFooter(handlers);
    call(handlers, "agent_start", {}, session.ctx);
    call(handlers, "turn_start", { turnIndex: 0, timestamp: 1000 }, session.ctx);
    expect(session.render(120)).toContain("Turn 1");

    for (const h of handlers.get("session_shutdown") ?? []) h({}, session.ctx);
    const ctx2 = newCtx();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx2);
    expect(session.render(120)).not.toContain("Turn 1");
  });
});
