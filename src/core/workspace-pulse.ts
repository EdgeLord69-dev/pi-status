import { execFile as nodeExecFile, type ExecException } from "node:child_process";
import type { Readable } from "node:stream";

export type WorkspacePulseStatus =
  | "clean"
  | "changed"
  | "conflict"
  | "not-repository"
  | "unavailable"
  | "stale";

export interface WorkspacePulseCounts {
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
  readonly conflicts: number;
}

export interface WorkspacePulseSnapshot {
  readonly status: WorkspacePulseStatus;
  readonly directory: string;
  readonly root?: string;
  readonly branch?: string;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly counts: WorkspacePulseCounts;
  readonly checkedAt?: number;
  readonly staleSince?: number;
}

export interface WorkspacePulseRuntimeOptions {
  directory: string;
  inspect?: (directory: string, signal: AbortSignal) => Promise<WorkspaceInspection>;
}

export type WorkspaceInspection =
  | {
      kind: "repository";
      root: string;
      branch?: string;
      upstream?: string;
      ahead: number;
      behind: number;
      counts: WorkspacePulseCounts;
      status: "clean" | "changed" | "conflict";
    }
  | { kind: "not-repository" };

interface ParsedStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  counts: WorkspacePulseCounts;
  status: "clean" | "changed" | "conflict";
}

const ZERO_COUNTS: WorkspacePulseCounts = { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 };
const XY_PATTERN = /^[.MTADRCU]{2}$/;
const SUBMODULE_PATTERN = /^(?:N\.\.\.|S[C.][M.][U.])$/;
const MODE_PATTERN = /^[0-7]{6}$/;
const OID_PATTERN = /^[0-9a-f]+$/;

export function parseGitStatusV2(text: string): ParsedStatus {
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 };
  let branch: string | undefined;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  let sawOid = false;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith("# ")) {
      const header = line.slice(2);
      const spaceIndex = header.indexOf(" ");
      const key = spaceIndex === -1 ? header : header.slice(0, spaceIndex);
      const value = spaceIndex === -1 ? "" : header.slice(spaceIndex + 1);
      if (key === "branch.oid") {
        if (!/^(?:\(initial\)|[0-9a-f]+)$/.test(value)) {
          throw new Error("malformed branch.oid");
        }
        sawOid = true;
        continue;
      }
      if (key === "branch.head") {
        if (value.length === 0) throw new Error("malformed branch.head");
        branch = value === "(detached)" ? "HEAD" : value;
        continue;
      }
      if (key === "branch.upstream") {
        if (value.length === 0) throw new Error("malformed branch.upstream");
        upstream = value;
        continue;
      }
      if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (!match) throw new Error("malformed branch.ab");
        const nextAhead = Number(match[1]);
        const nextBehind = Number(match[2]);
        if (!Number.isSafeInteger(nextAhead) || !Number.isSafeInteger(nextBehind)) {
          throw new Error("malformed branch.ab");
        }
        ahead = nextAhead;
        behind = nextBehind;
        continue;
      }
      continue;
    }

    const recordType = line[0];
    if (recordType === "?") {
      if (line[1] !== " " || line.length < 3) throw new Error("malformed untracked record");
      counts.untracked += 1;
      continue;
    }
    if (recordType === "!") {
      if (line[1] !== " " || line.length < 3) throw new Error("malformed ignored record");
      continue;
    }
    if (recordType === "u") {
      const fields = line.split(" ");
      if (
        fields.length < 11 ||
        fields.slice(0, 11).some((field) => field.length === 0) ||
        !XY_PATTERN.test(fields[1] ?? "") ||
        !SUBMODULE_PATTERN.test(fields[2] ?? "") ||
        !fields.slice(3, 7).every((field) => MODE_PATTERN.test(field)) ||
        !fields.slice(7, 10).every((field) => OID_PATTERN.test(field))
      ) {
        throw new Error("malformed unmerged record");
      }
      counts.conflicts += 1;
      continue;
    }
    if (recordType === "1" || recordType === "2") {
      const fields = line.split(" ");
      const requiredFields = recordType === "1" ? 9 : 10;
      if (
        fields.length < requiredFields ||
        fields.slice(0, requiredFields).some((field) => field.length === 0) ||
        !XY_PATTERN.test(fields[1] ?? "") ||
        !SUBMODULE_PATTERN.test(fields[2] ?? "") ||
        !fields.slice(3, 6).every((field) => MODE_PATTERN.test(field)) ||
        !fields.slice(6, 8).every((field) => OID_PATTERN.test(field)) ||
        (recordType === "2" && (!/^[RC]\d+$/.test(fields[8] ?? "") || !line.includes("\t")))
      ) {
        throw new Error("malformed tracked record");
      }
      const xy = fields[1] ?? "";
      const stagedActive = xy[0] !== "." && xy[0] !== " ";
      const unstagedActive = xy[1] !== "." && xy[1] !== " ";
      if (stagedActive) counts.staged += 1;
      if (unstagedActive) counts.unstaged += 1;
      continue;
    }
    throw new Error(`unknown record: ${recordType}`);
  }

  if (!sawOid) throw new Error("missing branch.oid");
  if (branch === undefined) throw new Error("missing branch.head");

  const status: "clean" | "changed" | "conflict" =
    counts.conflicts > 0
      ? "conflict"
      : counts.staged + counts.unstaged + counts.untracked > 0
        ? "changed"
        : "clean";

  return {
    branch,
    ...(upstream !== undefined ? { upstream } : {}),
    ahead,
    behind,
    counts,
    status,
  };
}

const INSPECTOR_TIMEOUT_MS = 2_000;
const INSPECTOR_MAX_BUFFER = 256 * 1024;

interface ExecFileOptions {
  cwd: string;
  timeout: number;
  maxBuffer: number;
  signal: AbortSignal;
  windowsHide: boolean;
  shell: boolean;
  env: NodeJS.ProcessEnv;
}

type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (error: ExecException | null, stdout: string, stderr: string) => void,
) => Readable;

function isExecError(value: unknown): value is ExecException {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function buildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
    LANG: "C",
  };
}

function runGit(
  exec: ExecFileFn,
  argv: readonly string[],
  cwd: string,
  signal: AbortSignal,
  classifyNotRepository = false,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const options: ExecFileOptions = {
      cwd,
      timeout: INSPECTOR_TIMEOUT_MS,
      maxBuffer: INSPECTOR_MAX_BUFFER,
      signal,
      windowsHide: true,
      shell: false,
      env: buildEnv(),
    };
    exec("git", argv, options, (error, stdout, stderr) => {
      if (error) {
        if (isExecError(error)) {
          if (classifyNotRepository && typeof error.code === "number" && error.code === 128) {
            const stderrText = typeof error.stderr === "string" ? error.stderr : stderr;
            const message = stderrText.trim();
            if (message.startsWith("fatal: not a git repository")) {
              reject(Object.assign(new Error("not-repository"), { kind: "not-repository" }));
              return;
            }
          }
          reject(Object.assign(new Error("git-failed"), { kind: "failed", stderr }));
          return;
        }
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export async function defaultInspect(
  directory: string,
  signal: AbortSignal,
): Promise<WorkspaceInspection> {
  return new Promise<WorkspaceInspection>((resolve, reject) => {
    const exec: ExecFileFn = (file, args, options, cb) =>
      nodeExecFile(file, args as string[], options, cb) as unknown as Readable;
    let root: string;
    runGit(exec, ["rev-parse", "--show-toplevel"], directory, signal, true)
      .then((stdout) => {
        root = stdout.replace(/\r?\n$/, "");
        return runGit(
          exec,
          ["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
          root,
          signal,
        );
      })
      .then((stdout) => {
        const parsed = parseGitStatusV2(stdout);
        resolve({
          kind: "repository",
          root,
          ...(parsed.branch !== undefined ? { branch: parsed.branch } : {}),
          ...(parsed.upstream !== undefined ? { upstream: parsed.upstream } : {}),
          ahead: parsed.ahead,
          behind: parsed.behind,
          counts: parsed.counts,
          status: parsed.status,
        });
      })
      .catch((error: unknown) => {
        const kind = isExecError(error) ? (error as { kind?: string }).kind : undefined;
        if (kind === "not-repository") {
          resolve({ kind: "not-repository" });
          return;
        }
        reject(error);
      });
  });
}

const DEBOUNCE_MS = 250;

interface RuntimeState {
  snapshot: WorkspacePulseSnapshot;
  generation: number;
  active: boolean;
  disposed: boolean;
}

export class WorkspacePulseRuntime {
  private readonly directory: string;
  private readonly inspect: (
    directory: string,
    signal: AbortSignal,
  ) => Promise<WorkspaceInspection>;
  private state: RuntimeState;
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listener: (() => void) | undefined;

  constructor(options: WorkspacePulseRuntimeOptions) {
    this.directory = options.directory;
    this.inspect = options.inspect ?? ((dir, signal) => defaultInspect(dir, signal));
    this.state = {
      snapshot: {
        status: "unavailable",
        directory: options.directory,
        ahead: 0,
        behind: 0,
        counts: { ...ZERO_COUNTS },
      },
      generation: 0,
      active: false,
      disposed: false,
    };
  }

  snapshot(): WorkspacePulseSnapshot {
    return this.state.snapshot;
  }

  start(): void {
    if (!this.state.active && !this.state.disposed) {
      this.state.active = true;
      void this.refresh();
    }
  }

  stop(): void {
    if (!this.state.active) return;
    this.clearTimer();
    this.abortActive();
    this.state.generation += 1;
    this.state.active = false;
  }

  dispose(): void {
    if (this.state.disposed) return;
    this.listener = undefined;
    this.stop();
    this.state.disposed = true;
  }

  setOnChange(callback: (() => void) | undefined): void {
    this.listener = callback;
  }

  scheduleRefresh(): void {
    if (this.state.disposed || !this.state.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, DEBOUNCE_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  async refresh(): Promise<void> {
    if (this.state.disposed || !this.state.active) return;
    this.abortActive();
    this.state.generation += 1;
    const generation = this.state.generation;
    const controller = new AbortController();
    this.controller = controller;

    try {
      const inspection = await this.inspect(this.directory, controller.signal);
      if (generation !== this.state.generation) return;
      if (inspection.kind === "not-repository") {
        this.publish({
          status: "not-repository",
          directory: this.directory,
          ahead: 0,
          behind: 0,
          counts: { ...ZERO_COUNTS },
          checkedAt: Date.now(),
        });
        return;
      }
      this.publish({
        status: inspection.status,
        directory: this.directory,
        root: inspection.root,
        ...(inspection.branch !== undefined ? { branch: inspection.branch } : {}),
        ...(inspection.upstream !== undefined ? { upstream: inspection.upstream } : {}),
        ahead: inspection.ahead,
        behind: inspection.behind,
        counts: { ...inspection.counts },
        checkedAt: Date.now(),
      });
    } catch {
      if (generation !== this.state.generation) return;
      const previous = this.state.snapshot;
      const previousHasRepository =
        previous.status === "clean" ||
        previous.status === "changed" ||
        previous.status === "conflict" ||
        previous.status === "stale";
      if (previousHasRepository) {
        const staleSince = previous.staleSince ?? Date.now();
        this.publish({
          status: "stale",
          directory: this.directory,
          ...(previous.root !== undefined ? { root: previous.root } : {}),
          ...(previous.branch !== undefined ? { branch: previous.branch } : {}),
          ...(previous.upstream !== undefined ? { upstream: previous.upstream } : {}),
          ahead: previous.ahead,
          behind: previous.behind,
          counts: { ...previous.counts },
          checkedAt: previous.checkedAt,
          staleSince,
        });
      } else {
        this.publish({
          status: "unavailable",
          directory: this.directory,
          ahead: 0,
          behind: 0,
          counts: { ...ZERO_COUNTS },
          checkedAt: Date.now(),
        });
      }
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private abortActive(): void {
    if (this.controller) {
      this.controller.abort();
      this.controller = undefined;
    }
  }

  private publish(snapshot: WorkspacePulseSnapshot): void {
    this.state.snapshot = snapshot;
    this.listener?.();
  }
}

export function createWorkspacePulseRuntime(
  options: WorkspacePulseRuntimeOptions,
): WorkspacePulseRuntime {
  return new WorkspacePulseRuntime(options);
}

export function formatWorkspacePulse(snapshot: WorkspacePulseSnapshot): string {
  const tokens: string[] = [];
  const isStale = snapshot.status === "stale";
  if (isStale) tokens.push("Git", "◌");
  else tokens.push("Git");

  const branchLabel = snapshot.status === "unavailable" ? "?" : (snapshot.branch ?? "—");

  if (snapshot.status === "clean") {
    tokens.push("✓", branchLabel);
  } else if (snapshot.status === "not-repository") {
    tokens.push("—");
  } else if (snapshot.status === "unavailable") {
    tokens.push(branchLabel);
  } else {
    if (snapshot.counts.conflicts > 0) tokens.push(`!${snapshot.counts.conflicts}`);
    tokens.push(branchLabel);
    if (snapshot.counts.staged > 0) tokens.push(`+${snapshot.counts.staged}`);
    if (snapshot.counts.unstaged > 0) tokens.push(`~${snapshot.counts.unstaged}`);
    if (snapshot.counts.untracked > 0) tokens.push(`?${snapshot.counts.untracked}`);
    if (snapshot.ahead > 0) tokens.push(`↑${snapshot.ahead}`);
    if (snapshot.behind > 0) tokens.push(`↓${snapshot.behind}`);
  }

  return tokens.join(" ");
}
