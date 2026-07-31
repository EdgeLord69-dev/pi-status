import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
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
    }),
    "utf8",
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

function setup() {
  const { pi, handlers } = buildPiWithHandlers();
  createExtension(pi);
  return { pi, handlers };
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
  pi: ReturnType<typeof setup>["pi"],
  handlers: ReturnType<typeof setup>["handlers"],
  configPath?: string,
) {
  const requestRender = vi.fn();
  let footerFactory:
    | ((...args: unknown[]) => { render: (width: number) => string[]; dispose?: () => void })
    | undefined;
  const ctx = newCtx({
    ui: {
      ...newCtx().ui,
      setFooter: (x: unknown) => (footerFactory = x as never),
    },
  });
  for (const h of handlers.get("session_start") ?? []) h({}, ctx);
  return {
    ctx,
    footerFactory,
    requestRender,
    render(width: number): string {
      return (
        footerFactory?.({ requestRender }, { fg: (_c: string, t: string) => t }, {
          getGitBranch: () => null,
          getExtensionStatuses: () => new Map(),
        })?.render(width) ?? []
      ).join("\n");
    },
    pi,
    handlers,
  };
}

describe("activity event wiring", () => {
  it("renders the one-based turn number from the authoritative turn_start index", () => {
    const { pi, handlers } = setup();
    const session = attachFooter(pi, handlers);
    call(handlers, "agent_start", {}, session.ctx);
    call(handlers, "turn_start", { turnIndex: 0, timestamp: 1000 }, session.ctx);
    const initial = session.render(120);
    expect(initial).toContain("turn 1");

    call(handlers, "turn_start", { turnIndex: 4, timestamp: 2000 }, session.ctx);
    const updated = session.render(120);
    expect(updated).toContain("turn 5");
  });

  it("ignores activity events from non-TUI sessions", () => {
    const { pi, handlers } = setup();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    createExtension(pi);
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
    call(handlers, "message_update", { message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "hi" } }, ctx);
    call(handlers, "message_end", { message: { role: "assistant", usage: { output: 10 } } }, ctx);
    call(handlers, "tool_execution_start", { toolCallId: "a", toolName: "read", args: {} }, ctx);
    call(handlers, "tool_execution_end", { toolCallId: "a", toolName: "read", result: {}, isError: false }, ctx);
    call(handlers, "turn_end", { turnIndex: 0, message: { role: "assistant" }, toolResults: [] }, ctx);
    call(handlers, "agent_settled", {}, ctx);
    expect(footerFactory).toBeUndefined();
  });

  it("ignores stale activity events from a previous session manager", () => {
    const { pi, handlers } = setup();
    createExtension(pi);
    const ctxA = newCtx();
    const ctxB = newCtx();
    for (const h of handlers.get("session_start") ?? []) {
      h({}, ctxA);
      h({}, ctxB);
    }
    call(handlers, "agent_start", {}, ctxA);
    call(handlers, "turn_start", { turnIndex: 0, timestamp: 1000 }, ctxA);
    expect(() =>
      call(handlers, "tool_execution_start", { toolCallId: "a", toolName: "read", args: {} }, ctxA),
    ).not.toThrow();
  });

  it("wires footer re-render to the activity runtime", () => {
    const { pi, handlers } = setup();
    const session = attachFooter(pi, handlers);
    session.render(120);
    expect(session.requestRender).not.toHaveBeenCalled();
    call(handlers, "agent_start", {}, session.ctx);
    expect(session.requestRender).toHaveBeenCalled();
  });

  it("resets the activity runtime on session replacement and on shutdown", () => {
    const { pi, handlers } = setup();
    const session = attachFooter(pi, handlers);
    call(handlers, "agent_start", {}, session.ctx);
    call(handlers, "turn_start", { turnIndex: 0, timestamp: 1000 }, session.ctx);
    expect(session.render(120)).toContain("turn 1");

    for (const h of handlers.get("session_shutdown") ?? []) h({}, session.ctx);
    const ctx2 = newCtx();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx2);
    expect(session.render(120)).not.toContain("turn 1");
  });
});
