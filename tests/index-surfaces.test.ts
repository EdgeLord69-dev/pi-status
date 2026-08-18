import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, buildPiWithHandlers } from "./helpers.ts";

let agentDir: string;
let start: ReturnType<typeof vi.fn>;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-status-surfaces-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  start = vi.fn();

  const runtime = {
    start,
    stop: vi.fn(),
    dispose: vi.fn(),
    setOnChange: vi.fn(),
    scheduleRefresh: vi.fn(),
    refresh: vi.fn(),
    snapshot: () => ({
      status: "unavailable" as const,
      directory: "/work",
      ahead: 0,
      behind: 0,
      counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
      trackedFiles: 0,
      linesAdded: 0,
      linesRemoved: 0,
      binaryFiles: 0,
      submodules: 0,
    }),
  };

  vi.doMock("../src/core/workspace-pulse.ts", async () => {
    const actual = await vi.importActual<typeof import("../src/core/workspace-pulse.ts")>(
      "../src/core/workspace-pulse.ts",
    );
    return {
      ...actual,
      createWorkspacePulseRuntime: vi.fn(() => runtime),
    };
  });
});

afterEach(() => {
  vi.doUnmock("../src/core/workspace-pulse.ts");
  vi.resetModules();
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

function writeConfig(values: {
  statusbarEnabled: boolean;
  sidebarEnabled: boolean;
  zones: Record<string, string[]>;
}): void {
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(
    join(agentDir, "extensions", "statusline.json"),
    JSON.stringify({ ...values, extensionSegments: { hidden: [] } }),
    "utf8",
  );
}

describe("workspace pulse surface gating", () => {
  it("does not start workspace pulse when both surfaces are disabled", async () => {
    writeConfig({
      statusbarEnabled: false,
      sidebarEnabled: false,
      zones: {
        topLeft: ["workspace-pulse"],
        topRight: [],
        bottomLeft: [],
        bottomRight: [],
      },
    });

    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers } = buildPiWithHandlers();
    const custom = vi.fn(async () => null);
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, custom: custom as never },
    });

    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

    expect(start).not.toHaveBeenCalled();
  });

  it("starts workspace pulse for a shown, supported demanding Sidebar", async () => {
    writeConfig({
      statusbarEnabled: false,
      sidebarEnabled: true,
      zones: {
        topLeft: ["model"],
        topRight: [],
        bottomLeft: [],
        bottomRight: [],
      },
    });

    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers } = buildPiWithHandlers();
    const tui = {
      terminal: { columns: 120, rows: 30 },
      requestRender: vi.fn(),
      render: vi.fn((width: number) => [`main:${width}`]),
    };
    const handle = {
      hide: vi.fn(),
      setHidden: vi.fn(),
      isHidden: vi.fn(() => false),
      focus: vi.fn(),
      unfocus: vi.fn(),
      isFocused: vi.fn(() => false),
    };
    const custom = vi.fn(
      async (
        factory: (...args: unknown[]) => unknown,
        options?: { onHandle?: (value: unknown) => void },
      ) => {
        factory(tui, null, {}, () => {});
        options?.onHandle?.(handle);
        return null;
      },
    );
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, custom: custom as never },
    });

    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

    expect(start).toHaveBeenCalledOnce();
  });
});
