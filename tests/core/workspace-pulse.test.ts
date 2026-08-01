import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(actual.execFile),
  };
});

import {
  createWorkspacePulseRuntime,
  formatWorkspacePulse,
  parseGitStatusV2,
  WorkspacePulseRuntime,
  type WorkspaceInspection,
  type WorkspacePulseSnapshot,
} from "../../src/core/workspace-pulse.ts";

const execFileMock = vi.mocked(execFile);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function okChild(stdout: string) {
  const child = fakeChild();
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from(stdout, "utf8"));
    child.emit("close", 0, null);
  });
  return child;
}

function failChild(stderr: string, code: number) {
  const child = fakeChild();
  process.nextTick(() => {
    child.stderr.emit("data", Buffer.from(stderr, "utf8"));
    child.emit("close", code, null);
  });
  return child;
}

function spawnFail(message: string) {
  const child = fakeChild();
  const err = new Error(message);
  child.on("error", () => {});
  process.nextTick(() => child.emit("error", err));
  return child;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(() => queueMicrotask(resolve)));
}

function safeInspect(d: ReturnType<typeof deferred<WorkspaceInspection>>) {
  return (_dir: string, signal: AbortSignal): Promise<WorkspaceInspection> => {
    let onAbort: (() => void) | undefined;
    return new Promise<WorkspaceInspection>((res, rej) => {
      onAbort = () => rej(new Error("aborted"));
      signal.addEventListener("abort", onAbort);
      d.promise.then(
        (v) => {
          if (onAbort) signal.removeEventListener("abort", onAbort);
          res(v);
        },
        (e) => {
          if (onAbort) signal.removeEventListener("abort", onAbort);
          rej(e);
        },
      );
    });
  };
}

function cleanRepo(value: Partial<WorkspaceInspection> = {}): WorkspaceInspection {
  return {
    kind: "repository",
    root: "/repo",
    branch: "main",
    upstream: undefined,
    ahead: 0,
    behind: 0,
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
    status: "clean",
    ...value,
  };
}

afterEach(() => {
  execFileMock.mockReset();
  vi.useRealTimers();
});

describe("parseGitStatusV2", () => {
  it("parses a clean repository with branch and upstream", () => {
    const text = [
      "# branch.oid abc123",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
    ].join("\n");
    expect(parseGitStatusV2(text)).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
      status: "clean",
    });
  });

  it("accepts (initial) oid and reports zero ahead/behind when no branch.ab is present", () => {
    const text = ["# branch.oid (initial)", "# branch.head main"].join("\n");
    expect(parseGitStatusV2(text)).toEqual({
      branch: "main",
      upstream: undefined,
      ahead: 0,
      behind: 0,
      counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
      status: "clean",
    });
  });

  it("parses ahead/behind from branch.ab", () => {
    const text = [
      "# branch.oid abc",
      "# branch.head feature/x",
      "# branch.upstream origin/feature/x",
      "# branch.ab +7 -3",
    ].join("\n");
    expect(parseGitStatusV2(text)).toMatchObject({
      branch: "feature/x",
      upstream: "origin/feature/x",
      ahead: 7,
      behind: 3,
    });
  });

  it("maps (detached) to HEAD", () => {
    const text = ["# branch.oid abc", "# branch.head (detached)"].join("\n");
    expect(parseGitStatusV2(text).branch).toBe("HEAD");
  });

  it("counts staged, unstaged, untracked, conflicts and classifies status", () => {
    const text = [
      "# branch.oid abc",
      "# branch.head feature/pulse",
      "# branch.upstream origin/feature/pulse",
      "# branch.ab +2 -1",
      "1 M. N... 100644 100644 100644 aaa aaa src/staged.ts",
      "1 .M N... 100644 100644 100644 aaa aaa src/unstaged.ts",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts\told name.ts",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
      "? untracked.ts",
      "! ignored.ts",
    ].join("\n");
    expect(parseGitStatusV2(text)).toEqual({
      branch: "feature/pulse",
      upstream: "origin/feature/pulse",
      ahead: 2,
      behind: 1,
      counts: { staged: 2, unstaged: 1, untracked: 1, conflicts: 1 },
      status: "conflict",
    });
  });

  it("classifies dirty worktree without conflicts as changed", () => {
    const text = [
      "# branch.oid abc",
      "# branch.head main",
      "1 M. N... 100644 100644 100644 aaa aaa src/staged.ts",
      "? untracked.ts",
    ].join("\n");
    expect(parseGitStatusV2(text).status).toBe("changed");
  });

  it("ignores unknown # metadata and CRLF line endings", () => {
    const text = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.oid something-extra\r\n",
      "# branch.someOtherKey value",
      "? untracked.ts",
    ].join("\n");
    const result = parseGitStatusV2(text);
    expect(result.branch).toBe("main");
    expect(result.counts.untracked).toBe(1);
  });

  it("rejects when branch.oid is missing", () => {
    expect(() => parseGitStatusV2("# branch.head main")).toThrow(/branch\.oid/);
  });

  it("rejects when branch.head is missing", () => {
    expect(() => parseGitStatusV2("# branch.oid abc")).toThrow(/branch\.head/);
  });

  it("rejects malformed branch.ab values", () => {
    expect(() =>
      parseGitStatusV2(["# branch.oid abc", "# branch.head main", "# branch.ab ++1 -1"].join("\n")),
    ).toThrow(/branch\.ab/);
    expect(() =>
      parseGitStatusV2(["# branch.oid abc", "# branch.head main", "# branch.ab +1"].join("\n")),
    ).toThrow(/branch\.ab/);
  });

  it("rejects unknown data record codes", () => {
    expect(() =>
      parseGitStatusV2(["# branch.oid abc", "# branch.head main", "9 ?? N... x"].join("\n")),
    ).toThrow(/unknown record/);
  });
});

describe("WorkspacePulseRuntime — fixed-command inspector", () => {
  it("issues exactly two git execFile calls in the documented order with bounded options", async () => {
    execFileMock
      .mockImplementationOnce(((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
        cb(null, "/repo\n", "");
        return fakeChild();
      }) as never)
      .mockImplementationOnce(((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
        cb(null, ["# branch.oid abc", "# branch.head main", "# branch.ab +0 -0"].join("\n"), "");
        return fakeChild();
      }) as never);

    const runtime: WorkspacePulseRuntime = new WorkspacePulseRuntime({
      directory: "/work/sub",
      inspect: undefined,
    });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock).toHaveBeenCalledTimes(2);

    const [firstCmd, firstArgv, firstOptions] = execFileMock.mock.calls[0] ?? [];
    expect(firstCmd).toBe("git");
    expect(firstArgv).toEqual(["rev-parse", "--show-toplevel"]);
    expect(firstOptions).toMatchObject({
      cwd: "/work/sub",
      timeout: 2_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
      shell: false,
      env: expect.objectContaining({ GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", LANG: "C" }),
    });
    expect((firstOptions as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);

    const [, secondArgv, secondOptions] = execFileMock.mock.calls[1] ?? [];
    expect(secondArgv).toEqual(["status", "--porcelain=v2", "--branch", "--untracked-files=all"]);
    expect(secondOptions).toMatchObject({ cwd: "/repo", timeout: 2_000, maxBuffer: 256 * 1024 });
  });

  it("classifies root command exit 128 not-a-git-repository as not-repository", async () => {
    execFileMock.mockImplementationOnce(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
      const err = Object.assign(new Error("exit"), { code: 128, stderr: "fatal: not a git repository" });
      cb(err, "", "fatal: not a git repository");
      return failChild("fatal: not a git repository", 128);
    }) as never);
    const runtime = new WorkspacePulseRuntime({ directory: "/work" });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runtime.snapshot().status).toBe("not-repository");
  });

  it("classifies nonzero git exit as unavailable", async () => {
    execFileMock.mockImplementationOnce(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
      const err = Object.assign(new Error("exit"), { code: 1, stderr: "boom" });
      cb(err, "", "boom");
      return failChild("boom", 1);
    }) as never);
    const runtime = new WorkspacePulseRuntime({ directory: "/work" });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("classifies spawn failure as unavailable", async () => {
    execFileMock.mockImplementationOnce(((..._args: unknown[]) => spawnFail("ENOENT")) as never);
    const runtime = new WorkspacePulseRuntime({ directory: "/work" });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runtime.snapshot().status).toBe("unavailable");
  });
});

describe("WorkspacePulseRuntime — event-driven refresh", () => {
  function deferInspector(): {
    deferred: ReturnType<typeof deferred<WorkspaceInspection>>;
    inspect: (directory: string, signal: AbortSignal) => Promise<WorkspaceInspection>;
  } {
    const d = deferred<WorkspaceInspection>();
    return { deferred: d, inspect: safeInspect(d) };
  }

  it("starts unavailable and reaches a clean snapshot after start() refreshes once", async () => {
    const inspector = deferInspector();
    inspector.deferred.resolve(cleanRepo());
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: inspector.inspect,
    });
    const initial: WorkspacePulseSnapshot = runtime.snapshot();
    expect(initial.status).toBe("unavailable");
    expect(initial.counts).toEqual({ staged: 0, unstaged: 0, untracked: 0, conflicts: 0 });
    expect(inspector.deferred.promise).toBeDefined();

    runtime.start();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.snapshot().status).toBe("clean");
  });

  it("repeated start() does not duplicate refreshes", async () => {
    let calls = 0;
    const inspector = (() => {
      const d = deferred<WorkspaceInspection>();
      d.resolve(cleanRepo());
      calls++;
      return { deferred: d, inspect: () => d.promise };
    })();
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: inspector.inspect,
    });
    runtime.start();
    runtime.start();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(calls).toBe(1);
    runtime.dispose();
  });

  it("scheduleRefresh debounces repeated requests", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const d = deferred<WorkspaceInspection>();
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: () => {
        calls++;
        return d.promise;
      },
    });
    runtime.start();
    d.resolve(cleanRepo());
    await flushMicrotasks();
    calls = 0;

    runtime.scheduleRefresh();
    runtime.scheduleRefresh();
    runtime.scheduleRefresh();
    expect(calls).toBe(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(calls).toBe(1);
    runtime.dispose();
  });

  it("aborts the prior inspection when a newer refresh is scheduled", async () => {
    const d1 = deferred<WorkspaceInspection>();
    const d2 = deferred<WorkspaceInspection>();
    let calls = 0;
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: (_dir, signal) => {
        calls++;
        const current = calls === 1 ? d1 : d2;
        return new Promise<WorkspaceInspection>((res, rej) => {
          const onAbort = () => rej(new Error("aborted"));
          signal.addEventListener("abort", onAbort);
          current.promise.then(
            (value) => {
              signal.removeEventListener("abort", onAbort);
              res(value);
            },
            (e) => {
              signal.removeEventListener("abort", onAbort);
              rej(e);
            },
          );
        });
      },
    });
    runtime.start();
    runtime.scheduleRefresh();
    await new Promise((r) => setTimeout(r, 260));
    await flushMicrotasks();
    expect(calls).toBe(2);

    d1.resolve(
      cleanRepo({ branch: "stale", counts: { staged: 9, unstaged: 0, untracked: 0, conflicts: 0 } }),
    );
    d2.resolve(cleanRepo({ branch: "fresh" }));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.snapshot().branch).toBe("fresh");
    runtime.dispose();
  });
});

describe("WorkspacePulseRuntime — failure and stale states", () => {
  function deferInspector(): {
    deferred: ReturnType<typeof deferred<WorkspaceInspection>>;
    inspect: (directory: string, signal: AbortSignal) => Promise<WorkspaceInspection>;
  } {
    const d = deferred<WorkspaceInspection>();
    return { deferred: d, inspect: safeInspect(d) };
  }

  it("publishes unavailable on initial failure", async () => {
    const inspector = deferInspector();
    inspector.deferred.reject(new Error("boom"));
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: inspector.inspect,
    });
    runtime.start();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.snapshot().status).toBe("unavailable");
    runtime.dispose();
  });

  it("promotes subsequent failures to stale while preserving repository details", async () => {
    let calls = 0;
    const d1 = deferred<WorkspaceInspection>();
    const d2 = deferred<WorkspaceInspection>();
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: (_dir, signal) => {
        calls++;
        const current = calls === 1 ? d1 : d2;
        return new Promise<WorkspaceInspection>((res, rej) => {
          signal.addEventListener("abort", () => rej(new Error("aborted")));
          current.promise.then((v) => res(v), (e) => rej(e));
        });
      },
    });
    runtime.start();
    d1.resolve(
      Object.assign(cleanRepo(), {
        branch: "feature/x",
        counts: { staged: 1, unstaged: 2, untracked: 3, conflicts: 0 },
        status: "changed",
      }) as WorkspaceInspection,
    );
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.snapshot().status).toBe("changed");

    runtime.scheduleRefresh();
    await new Promise((r) => setTimeout(r, 260));
    d2.reject(new Error("later boom"));
    await flushMicrotasks();
    await flushMicrotasks();
    const snap = runtime.snapshot();
    expect(snap.status).toBe("stale");
    expect(snap.branch).toBe("feature/x");
    expect(snap.counts).toEqual({ staged: 1, unstaged: 2, untracked: 3, conflicts: 0 });
    expect(typeof snap.staleSince).toBe("number");
    expect(typeof snap.checkedAt).toBe("number");
    runtime.dispose();
  });

  it("preserves the original staleSince across repeated failures", async () => {
    let calls = 0;
    const deferreds = [deferred<WorkspaceInspection>(), deferred<WorkspaceInspection>(), deferred<WorkspaceInspection>()];
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: (_dir, signal) => {
        const idx = calls++;
        const current = deferreds[idx];
        return new Promise<WorkspaceInspection>((res, rej) => {
          const onAbort = () => rej(new Error("aborted"));
          signal.addEventListener("abort", onAbort);
          current.promise.then(
            (v) => {
              signal.removeEventListener("abort", onAbort);
              res(v);
            },
            (e) => {
              signal.removeEventListener("abort", onAbort);
              rej(e);
            },
          );
        });
      },
    });
    runtime.start();
    deferreds[0].resolve(cleanRepo());
    await flushMicrotasks();
    await flushMicrotasks();

    runtime.scheduleRefresh();
    await new Promise((r) => setTimeout(r, 260));
    deferreds[1].reject(new Error("first"));
    await flushMicrotasks();
    await flushMicrotasks();
    const firstStaleSince = runtime.snapshot().staleSince;

    runtime.scheduleRefresh();
    await new Promise((r) => setTimeout(r, 260));
    deferreds[2].reject(new Error("second"));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.snapshot().staleSince).toBe(firstStaleSince);
    runtime.dispose();
  });

  it("clears stale fields after a successful refresh", async () => {
    let calls = 0;
    const deferreds = [
      deferred<WorkspaceInspection>(),
      deferred<WorkspaceInspection>(),
      deferred<WorkspaceInspection>(),
    ];
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: (_dir, signal) => {
        const current = deferreds[calls++];
        return new Promise<WorkspaceInspection>((res, rej) => {
          const onAbort = () => rej(new Error("aborted"));
          signal.addEventListener("abort", onAbort);
          current.promise.then(
            (v) => {
              signal.removeEventListener("abort", onAbort);
              res(v);
            },
            (e) => {
              signal.removeEventListener("abort", onAbort);
              rej(e);
            },
          );
        });
      },
    });
    runtime.start();
    deferreds[0].resolve(cleanRepo());
    await flushMicrotasks();
    await flushMicrotasks();

    runtime.scheduleRefresh();
    await new Promise((r) => setTimeout(r, 260));
    deferreds[1].reject(new Error("boom"));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.snapshot().status).toBe("stale");

    runtime.scheduleRefresh();
    await new Promise((r) => setTimeout(r, 260));
    deferreds[2].resolve(cleanRepo({ branch: "recovered" }));
    await flushMicrotasks();
    await flushMicrotasks();
    const snap = runtime.snapshot();
    expect(snap.status).toBe("clean");
    expect(snap.staleSince).toBeUndefined();
    runtime.dispose();
  });

  it("not-repository is terminal with a fresh checkedAt and no stale retention", async () => {
    const inspector = (): WorkspaceInspection => ({ kind: "not-repository" });
    const runtime = createWorkspacePulseRuntime({
      directory: "/work",
      inspect: inspector as never,
    });
    runtime.start();
    await flushMicrotasks();
    await flushMicrotasks();
    const snap = runtime.snapshot();
    expect(snap.status).toBe("not-repository");
    expect(snap.staleSince).toBeUndefined();
    expect(typeof snap.checkedAt).toBe("number");
    runtime.dispose();
  });
});

describe("WorkspacePulseRuntime — lifecycle", () => {
  it("stop cancels debounce timer, aborts active signal, increments generation, is idempotent", async () => {
    const d1 = deferred<WorkspaceInspection>();
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: (_dir, signal) => {
        let onAbort: (() => void) | undefined;
        return new Promise<WorkspaceInspection>((res, rej) => {
          onAbort = () => rej(new Error("aborted"));
          signal.addEventListener("abort", onAbort);
          d1.promise.then(
            (v) => {
              if (onAbort) signal.removeEventListener("abort", onAbort);
              res(v);
            },
            (e) => {
              if (onAbort) signal.removeEventListener("abort", onAbort);
              rej(e);
            },
          );
        });
      },
    });
    runtime.start();
    runtime.scheduleRefresh();
    runtime.stop();
    await flushMicrotasks();
    const after = runtime.snapshot();
    expect(after.status).toBe("unavailable");
    d1.resolve(
      Object.assign(cleanRepo(), {
        branch: "should-not-publish",
      }) as WorkspaceInspection,
    );
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.snapshot().branch).toBeUndefined();
    expect(runtime.snapshot().status).toBe("unavailable");

    runtime.stop();
    runtime.stop();
    runtime.dispose();
  });

  it("dispose clears the change listener and blocks later start/refresh/scheduleRefresh", async () => {
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: () => Promise.resolve(cleanRepo()),
    });
    const listener = vi.fn();
    runtime.setOnChange(listener);
    runtime.dispose();
    runtime.start();
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();
    await runtime.refresh();
    expect(listener).not.toHaveBeenCalled();
    runtime.scheduleRefresh();
    await new Promise((r) => setTimeout(r, 260));
    expect(listener).not.toHaveBeenCalled();
  });

  it("invokes the onChange listener once per published snapshot", async () => {
    const d = deferred<WorkspaceInspection>();
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: () => d.promise,
    });
    const listener = vi.fn();
    runtime.setOnChange(listener);
    runtime.start();
    d.resolve(cleanRepo());
    await flushMicrotasks();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });
});

describe("formatWorkspacePulse", () => {
  const base = {
    directory: "/Users/test/project",
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
    ahead: 0,
    behind: 0,
  } as const;

  it("renders the clean check + branch for a clean repository", () => {
    expect(
      formatWorkspacePulse({
        ...base,
        status: "clean",
        root: "/repo",
        branch: "main",
        upstream: "origin/main",
        checkedAt: 1,
      }),
    ).toBe("Git ✓ main");
  });

  it("renders HEAD when branch is detached", () => {
    expect(
      formatWorkspacePulse({
        ...base,
        status: "clean",
        root: "/repo",
        branch: "HEAD",
        checkedAt: 1,
      }),
    ).toBe("Git ✓ HEAD");
  });

  it("renders Git — when branch is missing on clean", () => {
    expect(
      formatWorkspacePulse({
        ...base,
        status: "clean",
        root: "/repo",
        checkedAt: 1,
      }),
    ).toBe("Git ✓ —");
  });

  it("renders conflict, staged, unstaged, untracked, ahead, behind tokens in order", () => {
    expect(
      formatWorkspacePulse({
        ...base,
        status: "conflict",
        root: "/repo",
        branch: "feature/x",
        upstream: "origin/feature/x",
        counts: { staged: 2, unstaged: 3, untracked: 4, conflicts: 1 },
        ahead: 5,
        behind: 6,
        checkedAt: 1,
      }),
    ).toBe("Git !1 feature/x +2 ~3 ?4 ↑5 ↓6");
  });

  it("omits tokens when the underlying counts are zero", () => {
    expect(
      formatWorkspacePulse({
        ...base,
        status: "changed",
        root: "/repo",
        branch: "feature/y",
        counts: { staged: 1, unstaged: 0, untracked: 0, conflicts: 0 },
        ahead: 0,
        behind: 0,
        checkedAt: 1,
      }),
    ).toBe("Git feature/y +1");
  });

  it("renders Git ? for unavailable without a branch", () => {
    expect(
      formatWorkspacePulse({ ...base, status: "unavailable", checkedAt: 1 }),
    ).toBe("Git ?");
  });

  it("renders not-repository as Git —", () => {
    expect(
      formatWorkspacePulse({ ...base, status: "not-repository", checkedAt: 1 }),
    ).toBe("Git —");
  });

  it("preserves prior snapshot and adds stale marker for stale state", () => {
    expect(
      formatWorkspacePulse({
        ...base,
        status: "stale",
        root: "/repo",
        branch: "feature/z",
        counts: { staged: 1, unstaged: 0, untracked: 0, conflicts: 0 },
        ahead: 0,
        behind: 0,
        checkedAt: 1,
        staleSince: 100,
      }),
    ).toBe("Git ◌ feature/z +1");
  });

  it("never includes raw error text or file paths", () => {
    const out = formatWorkspacePulse({
      ...base,
      status: "conflict",
      root: "/repo",
      branch: "feature/x",
      counts: { staged: 1, unstaged: 1, untracked: 1, conflicts: 1 },
      ahead: 1,
      behind: 1,
      checkedAt: 1,
    });
    expect(out).not.toMatch(/ENOENT|fatal/);
    expect(out).not.toMatch(/\b(?!feature\/x\b)[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/);
  });
});