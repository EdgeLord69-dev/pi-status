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
  parseNumstat,
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

function failChild(stderr: string, code: number) {
  const child = fakeChild();
  process.nextTick(() => {
    child.stderr.emit("data", Buffer.from(stderr, "utf8"));
    child.emit("close", code, null);
  });
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
    relativeCwd: "",
    branch: "main",
    upstream: undefined,
    ahead: 0,
    behind: 0,
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
    status: "clean",
    trackedFiles: 0,
    linesAdded: 0,
    linesRemoved: 0,
    binaryFiles: 0,
    submodules: 0,
    ...value,
  } as WorkspaceInspection;
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
      "",
    ].join("\0");
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
    const text = ["# branch.oid (initial)", "# branch.head main", ""].join("\0");
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
      "",
    ].join("\0");
    expect(parseGitStatusV2(text)).toMatchObject({
      branch: "feature/x",
      upstream: "origin/feature/x",
      ahead: 7,
      behind: 3,
    });
  });

  it("maps (detached) to HEAD", () => {
    const text = ["# branch.oid abc", "# branch.head (detached)", ""].join("\0");
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
      "2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts",
      "old name.ts",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
      "? untracked.ts",
      "! ignored.ts",
      "",
    ].join("\0");
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
      "",
    ].join("\0");
    expect(parseGitStatusV2(text).status).toBe("changed");
  });

  it("ignores unknown # metadata", () => {
    const text = [
      "# branch.oid abc",
      "# branch.head main",
      "# future.metadata something-extra",
      "# branch.someOtherKey value",
      "? untracked.ts",
      "",
    ].join("\0");
    const result = parseGitStatusV2(text);
    expect(result.branch).toBe("main");
    expect(result.counts.untracked).toBe(1);
  });

  it("rejects when branch.oid is missing", () => {
    expect(() => parseGitStatusV2(["# branch.head main", ""].join("\0"))).toThrow(/branch\.oid/);
  });

  it("rejects when branch.head is missing", () => {
    expect(() => parseGitStatusV2(["# branch.oid abc", ""].join("\0"))).toThrow(/branch\.head/);
  });

  it("rejects malformed branch.ab values", () => {
    expect(() =>
      parseGitStatusV2(
        ["# branch.oid abc", "# branch.head main", "# branch.ab ++1 -1", ""].join("\0"),
      ),
    ).toThrow(/branch\.ab/);
    expect(() =>
      parseGitStatusV2(["# branch.oid abc", "# branch.head main", "# branch.ab +1", ""].join("\0")),
    ).toThrow(/branch\.ab/);
    expect(() =>
      parseGitStatusV2(
        ["# branch.oid abc", "# branch.head main", `# branch.ab +${"9".repeat(100)} -0`, ""].join(
          "\0",
        ),
      ),
    ).toThrow(/branch\.ab/);
  });

  it("rejects unknown data record codes", () => {
    expect(() =>
      parseGitStatusV2(["# branch.oid abc", "# branch.head main", "9 ?? N... x", ""].join("\0")),
    ).toThrow(/unknown record/);
  });

  it.each([
    ["invalid OID", ["# branch.oid not-an-oid", "# branch.head main", ""]],
    ["empty upstream", ["# branch.oid abc", "# branch.head main", "# branch.upstream ", ""]],
    ["short ordinary record", ["# branch.oid abc", "# branch.head main", "1 M.", ""]],
    [
      "invalid XY flags",
      [
        "# branch.oid abc",
        "# branch.head main",
        "1 ZZ N... 100644 100644 100644 aaa aaa file.ts",
        "",
      ],
    ],
    [
      "invalid ordinary metadata",
      [
        "# branch.oid abc",
        "# branch.head main",
        "1 M. bad 100644 100644 100644 aaa aaa file.ts",
        "",
      ],
    ],
    ["short rename record", ["# branch.oid abc", "# branch.head main", "2 R.", ""]],
    [
      "rename score above 100",
      [
        "# branch.oid abc",
        "# branch.head main",
        "2 R. N... 100644 100644 100644 aaa bbb R101 file.ts",
        "old.ts",
        "",
      ],
    ],
    [
      "rename record without rename or copy status",
      [
        "# branch.oid abc",
        "# branch.head main",
        "2 M. N... 100644 100644 100644 aaa bbb R100 file.ts",
        "old.ts",
        "",
      ],
    ],
    [
      "rename without original path",
      [
        "# branch.oid abc",
        "# branch.head main",
        "2 R. N... 100644 100644 100644 aaa bbb R100 file.ts",
        "",
      ],
    ],
    ["short unmerged record", ["# branch.oid abc", "# branch.head main", "u UU", ""]],
    [
      "invalid unmerged metadata",
      [
        "# branch.oid abc",
        "# branch.head main",
        "u UU bad 100644 100644 100644 100644 aaa bbb ccc file.ts",
        "",
      ],
    ],
    ["empty untracked path", ["# branch.oid abc", "# branch.head main", "? ", ""]],
    ["empty ignored path", ["# branch.oid abc", "# branch.head main", "! ", ""]],
  ])("rejects malformed known data: %s", (_label, lines) => {
    expect(() => parseGitStatusV2(lines.join("\0"))).toThrow();
  });

  it("accepts NUL-delimited records with mixed stdout via -z", () => {
    const text = [
      "# branch.oid abc",
      "# branch.head main",
      "1 M. N... 100644 100644 100644 aaa aaa src/staged.ts",
      "2 R. N... 100644 100644 100644 aaa bbb R100 src/renamed.ts",
      "src/old.ts",
      "? newfile.ts",
      "",
    ].join("\0");
    expect(parseGitStatusV2(text)).toMatchObject({
      branch: "main",
      counts: { staged: 2, unstaged: 0, untracked: 1, conflicts: 0 },
      status: "changed",
    });
  });

  it("rejects incomplete NUL-terminated rename pairs", () => {
    const text = [
      "# branch.oid abc",
      "# branch.head main",
      "2 R. N... 100644 100644 100644 aaa bbb R100 src/renamed.ts",
      "",
    ].join("\0");
    expect(() => parseGitStatusV2(text)).toThrow(/rename|incomplete/);
  });

  it("rejects empty status records after splitting on NUL", () => {
    const text = ["# branch.oid abc", "", "# branch.head main", ""].join("\0");
    expect(() => parseGitStatusV2(text)).toThrow(/empty|malformed|nul/i);
  });
});

describe("parseNumstat", () => {
  it("uses the destination path from a NUL-delimited rename record", () => {
    const text = ["5\t2\t", "src/old.ts", "src/new.ts", ""].join("\0");

    expect(parseNumstat(text, new Set())).toEqual({
      linesAdded: 5,
      linesRemoved: 2,
      binaryFiles: 0,
    });
  });

  it("rejects malformed records instead of silently dropping them", () => {
    expect(() => parseNumstat("not-numstat\0", new Set())).toThrow(/malformed/);
  });

  it("rejects aggregate totals above the safe-integer range", () => {
    const text = [`${Number.MAX_SAFE_INTEGER}\t0\tfirst.ts`, "1\t0\tsecond.ts", ""].join("\0");

    expect(() => parseNumstat(text, new Set())).toThrow(/range/);
  });
});

interface MockResponse {
  argv?: readonly string[];
  stdout?: string;
  error?: Error & { code?: number | string; stderr?: string; killed?: boolean };
}

function statusFixture(records: readonly string[]): string {
  const withTrailingNul = [...records, ""];
  return withTrailingNul.join("\0");
}

function pushMock(responses: readonly MockResponse[]): void {
  for (const response of responses) {
    execFileMock.mockImplementationOnce(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
      if (response.error) {
        const err = response.error;
        const stderr = err.stderr ?? "";
        cb(err, "", stderr);
        if (typeof err.code === "number") {
          return failChild(stderr, err.code);
        }
        return fakeChild();
      }
      cb(null, response.stdout ?? "", "");
      return fakeChild();
    }) as never);
  }
}

function expectOptionShape(options: unknown): void {
  expect(options).toMatchObject({
    timeout: 2_000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
    shell: false,
    env: expect.objectContaining({ GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", LANG: "C" }),
  });
  expect((options as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
}

function repoCallArgs(): {
  cmd: string;
  argv: readonly string[];
  cwd: string;
  options: unknown;
  signal: AbortSignal;
}[] {
  return execFileMock.mock.calls.map((call) => {
    const [cmd, argv, options] = call as unknown as [
      string,
      readonly string[],
      { cwd: string; signal: AbortSignal },
    ];
    return { cmd, argv, cwd: options.cwd, options, signal: options.signal };
  });
}

describe("WorkspacePulseRuntime — fixed-command inspector", () => {
  it("issues exactly four git execFile calls in the documented order with bounded options", async () => {
    pushMock([
      { argv: ["rev-parse", "--show-toplevel"], stdout: "/repo with trailing space \n" },
      {
        argv: ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
        stdout: "# branch.oid abc\0# branch.head main\0# branch.ab +0 -0\0",
      },
      {
        argv: ["rev-parse", "--verify", "HEAD^{tree}"],
        stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n",
      },
      {
        argv: [
          "diff",
          "--numstat",
          "-z",
          "--find-renames",
          "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          "--",
        ],
        stdout: "",
      },
    ]);

    const runtime: WorkspacePulseRuntime = new WorkspacePulseRuntime({
      directory: "/work/sub",
      inspect: undefined,
    });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock).toHaveBeenCalledTimes(4);

    const calls = repoCallArgs();
    expect(calls.map((c) => c.cmd)).toEqual(["git", "git", "git", "git"]);
    expect(calls.map((c) => c.argv)).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
      ["rev-parse", "--verify", "HEAD^{tree}"],
      [
        "diff",
        "--numstat",
        "-z",
        "--find-renames",
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        "--",
      ],
    ]);

    const sharedSignal = calls[0]?.signal;
    expect(sharedSignal).toBeInstanceOf(AbortSignal);
    for (const call of calls) {
      expectOptionShape(call.options);
      expect(call.signal).toBe(sharedSignal);
    }
    expect(calls[0]?.cwd).toBe("/work/sub");
    expect(calls[1]?.cwd).toBe("/repo with trailing space ");
    expect(calls[2]?.cwd).toBe("/repo with trailing space ");
    expect(calls[3]?.cwd).toBe("/repo with trailing space ");
  });

  it("classifies root command exit 128 not-a-git-repository as not-repository", async () => {
    execFileMock.mockImplementationOnce(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
      const err = Object.assign(new Error("exit"), {
        code: 128,
        stderr: "fatal: not a git repository",
      });
      cb(err, "", "fatal: not a git repository");
      return failChild("fatal: not a git repository", 128);
    }) as never);
    const runtime = new WorkspacePulseRuntime({ directory: "/work" });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runtime.snapshot().status).toBe("not-repository");
  });

  it("treats status exit 128 as a failed inspection, not a root classification", async () => {
    pushMock([
      { argv: ["rev-parse", "--show-toplevel"], stdout: "/repo\n" },
      {
        error: Object.assign(new Error("exit"), {
          code: 128,
          stderr: "fatal: not a git repository",
        }),
      },
    ]);

    const runtime = new WorkspacePulseRuntime({ directory: "/work" });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("classifies nonzero git exit as unavailable", async () => {
    pushMock([{ error: Object.assign(new Error("exit"), { code: 1, stderr: "boom" }) }]);
    const runtime = new WorkspacePulseRuntime({ directory: "/work" });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it.each([
    ["spawn failure", Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" })],
    ["timeout", Object.assign(new Error("git timed out"), { killed: true, signal: "SIGTERM" })],
    [
      "max-buffer failure",
      Object.assign(new RangeError("stdout maxBuffer length exceeded"), {
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      }),
    ],
  ])("classifies %s as unavailable", async (_label, error) => {
    pushMock([{ error }]);
    const runtime = new WorkspacePulseRuntime({ directory: "/work" });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runtime.snapshot().status).toBe("unavailable");
    expect(runtime.snapshot().checkedAt).toEqual(expect.any(Number));
  });
});

describe("WorkspacePulseRuntime — NUL-safe inspection and rich metrics", () => {
  async function startWith(responses: readonly MockResponse[], directory = "/work") {
    execFileMock.mockReset();
    pushMock(responses);
    const runtime = new WorkspacePulseRuntime({ directory, inspect: undefined });
    runtime.start();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    return runtime;
  }

  it("publishes rich aggregates from a NUL-delimited fixture", async () => {
    const runtime = await startWith(
      [
        { stdout: "/work/repo\n" },
        {
          stdout: statusFixture([
            "# branch.oid abcdefabcdefabcdefabcdefabcdefabcdefabcd",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 M. N... 100644 100644 100644 aaa aaa src/staged.ts",
            "1 .M N... 100644 100644 100644 aaa aaa src/unstaged.ts",
            "1 M. N... 100644 100644 100644 aaa aaa src/extra.ts",
            "1 .M N... 100644 100644 100644 aaa aaa src/another.ts",
            "2 R. N... 100644 100644 100644 aaa bbb R100 src/renamed.ts",
            "src/old.ts",
            "1 .M SC.. 160000 160000 160000 aaa aaa vendor/sub",
            "? newfile.ts",
            "! ignored.ts",
          ]),
        },
        { stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n" },
        {
          stdout: [
            "3\t1\tsrc/staged.ts",
            "5\t2\tsrc/unstaged.ts",
            "1\t0\tsrc/extra.ts",
            "3\t0\tsrc/another.ts",
            "0\t0\t",
            "src/old.ts",
            "src/renamed.ts",
            "-\t-\tassets/img.bin",
            "",
          ].join("\0"),
        },
      ],
      "/work/repo/packages/app",
    );

    expect(runtime.snapshot()).toMatchObject({
      status: "changed",
      root: "/work/repo",
      relativeCwd: "packages/app",
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      trackedFiles: 6,
      linesAdded: 12,
      linesRemoved: 3,
      binaryFiles: 1,
      submodules: 1,
      counts: { staged: 3, unstaged: 3, untracked: 1, conflicts: 0 },
    });
  });

  it("normalizes the repository-relative cwd", async () => {
    const runtime = await startWith(
      [
        { stdout: "/work/repo\n" },
        { stdout: "# branch.oid abc\0# branch.head main\0" },
        { stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n" },
        { stdout: "" },
      ],
      "/work/repo/packages/../app",
    );

    expect(runtime.snapshot().relativeCwd).toBe("app");
  });

  it("falls back to the empty tree when HEAD^{tree} fails and the repo is unborn", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      { stdout: "# branch.oid (initial)\0# branch.head main\0" },
      {
        error: Object.assign(new Error("exit"), { code: 128, stderr: "fatal: not a tree object" }),
      },
      { stdout: "" },
    ]);

    const diffArgs = execFileMock.mock.calls[3]?.[1] as readonly string[];
    const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    expect(diffArgs).toContain(EMPTY_TREE);
    expect(diffArgs).not.toContain("undefined");
    expect(runtime.snapshot().branch).toBe("main");
  });

  it("does not treat a timed-out HEAD lookup as an unborn Git exit", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      { stdout: "# branch.oid (initial)\0# branch.head main\0" },
      { error: Object.assign(new Error("git timed out"), { killed: true, signal: "SIGTERM" }) },
      { stdout: "" },
    ]);

    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("rejects an empty tree baseline before running diff", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      { stdout: "# branch.oid abc\0# branch.head main\0" },
      { stdout: "\n" },
      { stdout: "" },
    ]);

    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("publishes unavailable when status records are malformed mid-stream (renames)", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      { stdout: "# branch.oid abc\u0000# branch.head main\u00002 R.\u0000" },
    ]);
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("publishes unavailable on unknown data record codes", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      { stdout: "# branch.oid abc\u0000# branch.head main\u00009 ?? N... x\u0000" },
    ]);
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("publishes unavailable on malformed numstat entries", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      {
        stdout:
          "# branch.oid abc\0# branch.head main\0" +
          "1 M. N... 100644 100644 100644 aaa aaa src/staged.ts\0",
      },
      { stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n" },
      { stdout: "notnumstat\tsrc/staged.ts\0" },
    ]);
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("excludes submodule paths from line and binary aggregates", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      {
        stdout: [
          "# branch.oid abc",
          "# branch.head main",
          "1 .M SC.. 160000 160000 160000 aaa aaa vendor/sub",
          "? newfile.ts",
          "",
        ].join("\0"),
      },
      { stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n" },
      {
        stdout: ["5\t2\tvendor/sub", "-\t-\tassets/img.bin", ""].join("\0"),
      },
    ]);

    expect(runtime.snapshot()).toMatchObject({
      submodules: 1,
      linesAdded: 0,
      linesRemoved: 0,
      binaryFiles: 1,
      trackedFiles: 1,
    });
  });

  it("publishes unavailable when a rename record is missing its trailing path", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      {
        stdout: [
          "# branch.oid abc",
          "# branch.head main",
          "2 R. N... 100644 100644 100644 aaa bbb R100 src/renamed.ts",
          "",
        ].join("\0"),
      },
      { stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n" },
      { stdout: "1\t1\tsrc/renamed.ts" },
    ]);
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("publishes unavailable on status output that is not NUL-terminated", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      { stdout: "# branch.oid abc\n# branch.head main\n" },
      { stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n" },
      { stdout: "" },
    ]);
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("publishes unavailable when HEAD^{tree} fails on a non-unborn repo", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      { stdout: "# branch.oid abc\0# branch.head main\0" },
      { error: Object.assign(new Error("exit"), { code: 128, stderr: "boom" }) },
    ]);
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("publishes unavailable when the diff command fails outside the unborn case", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      { stdout: "# branch.oid abc\0# branch.head main\0" },
      { stdout: "" },
      { error: Object.assign(new Error("exit"), { code: 1, stderr: "diff boom" }) },
    ]);
    expect(runtime.snapshot().status).toBe("unavailable");
  });

  it("preserves rich fields across stale retention", async () => {
    const runtime = await startWith([
      { stdout: "/work/repo\n" },
      {
        stdout: [
          "# branch.oid abc",
          "# branch.head main",
          "1 M. N... 100644 100644 100644 aaa aaa src/staged.ts",
          "? newfile.ts",
          "",
        ].join("\0"),
      },
      { stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n" },
      { stdout: "3\t1\tsrc/staged.ts\0" },
    ]);

    expect(runtime.snapshot()).toMatchObject({
      status: "changed",
      trackedFiles: 1,
      linesAdded: 3,
      linesRemoved: 1,
      binaryFiles: 0,
      submodules: 0,
    });

    pushMock([{ error: new Error("later boom") }]);
    await runtime.refresh();
    expect(runtime.snapshot()).toMatchObject({
      status: "stale",
      trackedFiles: 1,
      linesAdded: 3,
      linesRemoved: 1,
    });
  });

  it("enforces the 256 KiB buffer cap on every call", async () => {
    await startWith([
      { stdout: "/work/repo\n" },
      { stdout: "# branch.oid abc\0# branch.head main\0" },
      { stdout: "deadbeef\n" },
      {
        error: Object.assign(new RangeError("stdout maxBuffer length exceeded"), {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        }),
      },
    ]);
    const calls = execFileMock.mock.calls;
    for (const call of calls) {
      const [, , options] = call as unknown as [string, readonly string[], { maxBuffer: number }];
      expect(options.maxBuffer).toBe(256 * 1024);
    }
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
    const d = deferred<WorkspaceInspection>();
    d.resolve(cleanRepo());
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: () => {
        calls++;
        return d.promise;
      },
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
      cleanRepo({
        branch: "stale",
        counts: { staged: 9, unstaged: 0, untracked: 0, conflicts: 0 },
      }),
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
          current.promise.then(
            (v) => res(v),
            (e) => rej(e),
          );
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
    const deferreds = [
      deferred<WorkspaceInspection>(),
      deferred<WorkspaceInspection>(),
      deferred<WorkspaceInspection>(),
    ];
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
  it("stop cancels pending work, retains the last snapshot, and is idempotent", async () => {
    const d1 = deferred<WorkspaceInspection>();
    let calls = 0;
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: (_dir, signal) => {
        calls++;
        if (calls === 1) return Promise.resolve(cleanRepo());
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
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.snapshot().status).toBe("clean");

    void runtime.refresh();
    runtime.scheduleRefresh();
    runtime.stop();
    await flushMicrotasks();
    const after = runtime.snapshot();
    expect(after.status).toBe("clean");
    expect(after.branch).toBe("main");
    d1.resolve(
      Object.assign(cleanRepo(), {
        branch: "should-not-publish",
      }) as WorkspaceInspection,
    );
    await flushMicrotasks();
    await flushMicrotasks();
    expect(runtime.snapshot().branch).toBe("main");
    expect(runtime.snapshot().status).toBe("clean");

    runtime.stop();
    runtime.stop();
    runtime.dispose();
  });

  it("dispose clears the change listener and blocks later start/refresh/scheduleRefresh", async () => {
    const pending = deferred<WorkspaceInspection>();
    const runtime = createWorkspacePulseRuntime({
      directory: "/repo",
      inspect: () => pending.promise,
    });
    const listener = vi.fn();
    runtime.setOnChange(listener);
    runtime.start();
    await flushMicrotasks();
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
    trackedFiles: 0,
    linesAdded: 0,
    linesRemoved: 0,
    binaryFiles: 0,
    submodules: 0,
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
    expect(formatWorkspacePulse({ ...base, status: "unavailable", checkedAt: 1 })).toBe("Git ?");
  });

  it("renders not-repository as Git —", () => {
    expect(formatWorkspacePulse({ ...base, status: "not-repository", checkedAt: 1 })).toBe("Git —");
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
