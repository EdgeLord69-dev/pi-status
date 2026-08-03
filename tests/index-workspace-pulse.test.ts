import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";
import { buildSetFooterSpy, createContext, buildPiWithHandlers } from "./helpers.ts";

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

function fakeChild(): EventEmitter {
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
    fourCommandMock((options) => options.cwd);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock).toHaveBeenCalledTimes(4);
  });

  it("creates a fresh runtime for a replacement session cwd", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    const nextInspection = fourCommandMock((options) => options.cwd);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const first = createContext({ cwd: "/repo/one" });
    const second = createContext({ cwd: "/repo/two" });

    for (const h of handlers.get("session_start") ?? []) h({}, first);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    nextInspection();
    for (const h of handlers.get("session_start") ?? []) h({}, second);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const rootCwds = execFileMock.mock.calls
      .filter(([, args]) => {
        const argv = args as readonly string[];
        return argv[0] === "rev-parse" && argv[1] === "--show-toplevel";
      })
      .map(([, , options]) => (options as { cwd: string }).cwd);
    expect(rootCwds).toEqual(["/repo/one", "/repo/two"]);
  });

  it("does not restart the inspection when the segment moves between zones", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    fourCommandMock(() => "/repo");

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

  it("stops lifecycle refreshes when workspace-pulse is removed", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    fourCommandMock((options) => options.cwd);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    withEnabledZone({ bottomLeft: ["model"] });
    for (const h of handlers.get("session_tree") ?? []) h({}, ctx);
    const callsAfterRemoval = execFileMock.mock.calls.length;

    for (const h of handlers.get("turn_start") ?? []) {
      h({ turnIndex: 0, timestamp: Date.now() }, ctx);
    }
    for (const h of handlers.get("tool_execution_end") ?? []) {
      h({ toolCallId: "t1", isError: false }, ctx);
    }
    await new Promise((r) => setTimeout(r, 260));
    expect(execFileMock).toHaveBeenCalledTimes(callsAfterRemoval);
  });

  it("schedules a debounced refresh on tool_execution_end", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    const refreshableMock = fourCommandMock(() => "/repo");

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const callsBeforeTool = execFileMock.mock.calls.length;
    refreshableMock();

    for (const h of handlers.get("tool_execution_end") ?? []) {
      h({ toolCallId: "t1", isError: false }, ctx);
    }
    await new Promise((r) => setTimeout(r, 260));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock.mock.calls.length).toBe(callsBeforeTool + 4);
  });

  it("refreshes immediately on turn_start", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    const nextInspection = fourCommandMock(() => "/repo");

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const callsBeforeTurn = execFileMock.mock.calls.length;
    nextInspection();

    for (const h of handlers.get("turn_start") ?? []) {
      h({ turnIndex: 0, timestamp: Date.now() }, ctx);
    }
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock.mock.calls.length).toBe(callsBeforeTurn + 4);
  });

  it("disposes the runtime on session_shutdown", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    fourCommandMock(() => "/repo");

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

function fourCommandMock(resolveRoot: (options: { cwd: string }) => string): () => void {
  const expand = () => {
    for (let i = 0; i < 4; i += 1) {
      execFileMock.mockImplementationOnce(((
        _file: string,
        args: readonly string[],
        options: unknown,
        cb: (err: unknown, stdout: string, stderr: string) => void,
      ) => {
        const argv = args as readonly string[];
        const opts = options as { cwd: string };
        let stdout = "";
        if (argv[0] === "rev-parse" && argv[1] === "--show-toplevel") {
          stdout = `${resolveRoot(opts)}\n`;
        } else if (argv[0] === "status") {
          stdout = ["# branch.oid abc", "# branch.head main", "# branch.ab +0 -0", ""].join("\0");
        } else if (argv[0] === "diff") {
          stdout = "";
        } else {
          stdout = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n";
        }
        cb(null, stdout, "");
        return fakeChild();
      }) as never);
    }
  };
  expand();
  return expand;
}
