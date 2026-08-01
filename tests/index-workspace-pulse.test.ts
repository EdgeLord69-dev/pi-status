import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";
import { buildSetFooterSpy, createBus, createContext, buildPiWithHandlers } from "./helpers.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  type ExecCb = (err: unknown, stdout: string, stderr: string) => void;
  return {
    ...actual,
    execFile: vi.fn(
      (_file: string, _args: readonly string[], _options: unknown, cb: ExecCb): EventEmitter => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        process.nextTick(() => cb(null, "", ""));
        return child;
      },
    ),
  };
});

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-status-wsp-wiring-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
  vi.mocked(execFile).mockReset();
});

const execFileMock = vi.mocked(execFile);

function repoOutput(stdout: string): EventEmitter {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function writeConfig(zones: unknown): void {
  // dynamically import to avoid circular hoist issues
  const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(
    join(agentDir, "extensions", "statusline.json"),
    JSON.stringify({ zones, extensionSegments: { hidden: [] } }),
    "utf8",
  );
}

function setupHarness() {
  const harness = buildPiWithHandlers();
  createExtension(harness.pi);
  return harness;
}

function withEnabledZone(zones: Record<string, readonly string[]>) {
  writeConfig({
    topLeft: zones.topLeft ?? [],
    topRight: zones.topRight ?? [],
    bottomLeft: zones.bottomLeft ?? [],
    bottomRight: zones.bottomRight ?? [],
  });
}

describe("workspace pulse wiring", () => {
  it("does not create a runtime or run git for RPC sessions", () => {
    const { pi, handlers } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      mode: "rpc",
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("does not run git when the segment is not in any zone", () => {
    withEnabledZone({ topLeft: ["model"], bottomLeft: [] });
    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("starts one inspection when workspace-pulse is enabled in a zone", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    execFileMock
      .mockImplementationOnce(((
        _file: string,
        _args: readonly string[],
        _options: unknown,
        cb: (err: unknown, stdout: string, stderr: string) => void,
      ) => {
        process.nextTick(() => cb(null, "/repo\n", ""));
      }) as never)
      .mockImplementationOnce(((
        _file: string,
        _args: readonly string[],
        _options: unknown,
        cb: (err: unknown, stdout: string, stderr: string) => void,
      ) => {
        process.nextTick(() =>
          cb(null, "# branch.oid abc\n# branch.head main\n# branch.ab +0 -0\n", ""),
        );
      }) as never);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it("does not restart the inspection when the segment moves between zones", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    execFileMock
      .mockImplementationOnce(((
        _file: string,
        _args: readonly string[],
        _options: unknown,
        cb: (err: unknown, stdout: string, stderr: string) => void,
      ) => {
        process.nextTick(() => cb(null, "/repo\n", ""));
      }) as never)
      .mockImplementationOnce(((
        _file: string,
        _args: readonly string[],
        _options: unknown,
        cb: (err: unknown, stdout: string, stderr: string) => void,
      ) => {
        process.nextTick(() => cb(null, "# branch.oid abc\n# branch.head main\n", ""));
      }) as never);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const callsAfterStart = execFileMock.mock.calls.length;

    writeConfig({
      topLeft: ["workspace-pulse"],
      topRight: [],
      bottomLeft: [],
      bottomRight: [],
    });
    for (const h of handlers.get("session_tree") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    expect(execFileMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("schedules a debounced refresh on tool_execution_end", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    execFileMock.mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      cb: (err: unknown, stdout: string, stderr: string) => void,
    ) => {
      process.nextTick(() => cb(null, "/repo\n", ""));
    }) as never);
    execFileMock.mockImplementationOnce(((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      cb: (err: unknown, stdout: string, stderr: string) => void,
    ) => {
      process.nextTick(() => cb(null, "# branch.oid abc\n# branch.head main\n", ""));
    }) as never);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const callsBeforeTool = execFileMock.mock.calls.length;

    for (const h of handlers.get("tool_execution_end") ?? []) {
      h({ toolCallId: "t1", isError: false }, ctx);
    }
    await new Promise((r) => setTimeout(r, 260));
    expect(execFileMock.mock.calls.length).toBeGreaterThan(callsBeforeTool);
  });

  it("refreshes immediately on turn_start", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    execFileMock.mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      cb: (err: unknown, stdout: string, stderr: string) => void,
    ) => {
      process.nextTick(() => cb(null, "/repo\n", ""));
    }) as never);
    execFileMock.mockImplementationOnce(((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      cb: (err: unknown, stdout: string, stderr: string) => void,
    ) => {
      process.nextTick(() => cb(null, "# branch.oid abc\n# branch.head main\n", ""));
    }) as never);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const callsBeforeTurn = execFileMock.mock.calls.length;

    for (const h of handlers.get("turn_start") ?? []) {
      h({ turnIndex: 0, timestamp: Date.now() }, ctx);
    }
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock.mock.calls.length).toBeGreaterThan(callsBeforeTurn);
  });

  it("disposes the runtime on session_shutdown", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    execFileMock.mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      cb: (err: unknown, stdout: string, stderr: string) => void,
    ) => {
      process.nextTick(() => cb(null, "/repo\n", ""));
    }) as never);
    execFileMock.mockImplementationOnce(((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      cb: (err: unknown, stdout: string, stderr: string) => void,
    ) => {
      process.nextTick(() => cb(null, "# branch.oid abc\n# branch.head main\n", ""));
    }) as never);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));

    for (const h of handlers.get("session_shutdown") ?? []) h({}, ctx);
    const callsAfterShutdown = execFileMock.mock.calls.length;

    for (const h of handlers.get("tool_execution_end") ?? []) {
      h({ toolCallId: "t1", isError: false }, ctx);
    }
    await new Promise((r) => setTimeout(r, 260));
    expect(execFileMock.mock.calls.length).toBe(callsAfterShutdown);
  });
});
