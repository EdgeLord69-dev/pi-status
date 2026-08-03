import { execFile as nodeExecFile, type ExecException } from "node:child_process";
import { relative as relativePath } from "node:path";
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
  readonly relativeCwd?: string;
  readonly branch?: string;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly counts: WorkspacePulseCounts;
  readonly trackedFiles: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly binaryFiles: number;
  readonly submodules: number;
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
      relativeCwd: string;
      branch?: string;
      upstream?: string;
      ahead: number;
      behind: number;
      counts: WorkspacePulseCounts;
      status: "clean" | "changed" | "conflict";
      trackedFiles: number;
      linesAdded: number;
      linesRemoved: number;
      binaryFiles: number;
      submodules: number;
    }
  | { kind: "not-repository" };

interface ParsedStatus {
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  counts: WorkspacePulseCounts;
  status: "clean" | "changed" | "conflict";
}

export interface NumstatAggregates {
  linesAdded: number;
  linesRemoved: number;
  binaryFiles: number;
}

const ZERO_COUNTS: WorkspacePulseCounts = { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 };
const ZERO_RICH: NumstatAggregates = { linesAdded: 0, linesRemoved: 0, binaryFiles: 0 };
const XY_PATTERN = /^[.MTADRCU]{2}$/;
const SUBMODULE_PATTERN = /^(?:N\.\.\.|S[C.][M.][U.])$/;
const MODE_PATTERN = /^[0-7]{6}$/;
const OID_PATTERN = /^[0-9a-f]+$/;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

interface MutableRecordState {
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  trackedFiles: number;
  submodulePaths: Set<string>;
  unborn: boolean;
}

function parseRecords(text: string, into: MutableRecordState): void {
  let sawOid = false;
  const records = text.split("\0");
  if (text.length === 0 || records[records.length - 1] !== "") {
    throw new Error("missing NUL termination");
  }
  const limited = records.slice(0, -1);

  for (let i = 0; i < limited.length; i += 1) {
    const record = limited[i] ?? "";
    if (record.length === 0) throw new Error("empty status record");
    if (record.startsWith("# ")) {
      const header = record.slice(2);
      const spaceIndex = header.indexOf(" ");
      const key = spaceIndex === -1 ? header : header.slice(0, spaceIndex);
      const value = spaceIndex === -1 ? "" : header.slice(spaceIndex + 1);
      if (
        key === "branch.oid" ||
        key === "branch.head" ||
        key === "branch.upstream" ||
        key === "branch.ab"
      ) {
        if (key === "branch.oid") sawOid = true;
        applyBranchHeader(key, value, into);
      }
      continue;
    }
    if (record.startsWith("? ")) {
      const path = record.slice(2);
      if (!path) throw new Error("malformed untracked record");
      into.untracked += 1;
      continue;
    }
    if (record.startsWith("! ")) {
      const path = record.slice(2);
      if (!path) throw new Error("malformed ignored record");
      continue;
    }

    const recordType = record[0];
    if (recordType === "1" || recordType === "2" || recordType === "u") {
      const fields = record.split(" ");
      const pathStart = recordType === "u" ? 10 : recordType === "2" ? 9 : 8;
      const required = recordType === "u" ? 11 : recordType === "2" ? 9 : 8;
      if (
        fields.length < required ||
        fields.slice(0, required).some((field) => field.length === 0) ||
        !XY_PATTERN.test(fields[1] ?? "") ||
        !SUBMODULE_PATTERN.test(fields[2] ?? "") ||
        (recordType !== "u" && !fields.slice(3, 6).every((f) => MODE_PATTERN.test(f))) ||
        (recordType !== "u" && !fields.slice(6, 8).every((f) => OID_PATTERN.test(f))) ||
        (recordType === "u" && !fields.slice(3, 7).every((f) => MODE_PATTERN.test(f))) ||
        (recordType === "u" && !fields.slice(7, 10).every((f) => OID_PATTERN.test(f))) ||
        (recordType === "2" &&
          (!/[RC]/.test(fields[1] ?? "") ||
            !/^[RC]\d+$/.test(fields[8] ?? "") ||
            Number((fields[8] ?? "").slice(1)) > 100))
      ) {
        throw new Error("malformed tracked record");
      }
      const path = fields.slice(pathStart).join(" ");
      if (!path) throw new Error("empty path");
      if (recordType === "2") {
        const nextRecord = limited[i + 1];
        if (nextRecord === undefined || nextRecord.length === 0) {
          throw new Error("incomplete rename pair");
        }
        i += 1;
      }
      into.trackedFiles += 1;
      if (recordType === "u") {
        into.conflicts += 1;
      } else {
        const xy = fields[1] ?? "";
        const stagedActive = xy[0] !== "." && xy[0] !== " ";
        const unstagedActive = xy[1] !== "." && xy[1] !== " ";
        if (stagedActive) into.staged += 1;
        if (unstagedActive) into.unstaged += 1;
      }
      const submodule = fields[2] ?? "";
      if (submodule.startsWith("S") && path) into.submodulePaths.add(path);
      continue;
    }
    throw new Error(`unknown record: ${recordType}`);
  }

  if (!sawOid) throw new Error("missing branch.oid");
  if (into.branch === undefined) throw new Error("missing branch.head");
}

function applyBranchHeader(key: string, value: string, into: MutableRecordState): void {
  if (key === "branch.oid") {
    if (!/^(?:\(initial\)|[0-9a-f]+)$/.test(value)) {
      throw new Error("malformed branch.oid");
    }
    into.unborn = value === "(initial)";
    return;
  }
  if (key === "branch.head") {
    if (value.length === 0) throw new Error("malformed branch.head");
    into.branch = value === "(detached)" ? "HEAD" : value;
    return;
  }
  if (key === "branch.upstream") {
    if (value.length === 0) throw new Error("malformed branch.upstream");
    into.upstream = value;
    return;
  }
  if (key === "branch.ab") {
    const match = /^\+(\d+) -(\d+)$/.exec(value);
    if (!match) throw new Error("malformed branch.ab");
    const nextAhead = Number(match[1]);
    const nextBehind = Number(match[2]);
    if (!Number.isSafeInteger(nextAhead) || !Number.isSafeInteger(nextBehind)) {
      throw new Error("malformed branch.ab");
    }
    into.ahead = nextAhead;
    into.behind = nextBehind;
  }
}

export function parseGitStatusV2(text: string): ParsedStatus {
  const state: MutableRecordState = {
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    trackedFiles: 0,
    submodulePaths: new Set(),
    unborn: false,
  };
  parseRecords(text, state);

  const status: "clean" | "changed" | "conflict" =
    state.conflicts > 0
      ? "conflict"
      : state.staged + state.unstaged + state.untracked > 0
        ? "changed"
        : "clean";

  return {
    ...(state.branch !== undefined ? { branch: state.branch } : {}),
    ...(state.upstream !== undefined ? { upstream: state.upstream } : {}),
    ahead: state.ahead,
    behind: state.behind,
    counts: {
      staged: state.staged,
      unstaged: state.unstaged,
      untracked: state.untracked,
      conflicts: state.conflicts,
    },
    status,
  };
}

export function parseNumstat(text: string, submodulePaths: ReadonlySet<string>): NumstatAggregates {
  const aggregates: NumstatAggregates = { ...ZERO_RICH };
  if (text.length === 0) return aggregates;
  const records = text.split("\0");
  if (records[records.length - 1] !== "") {
    throw new Error("numstat missing NUL termination");
  }
  const limited = records.slice(0, -1);

  for (let index = 0; index < limited.length; index += 1) {
    const raw = limited[index] ?? "";
    if (raw.length === 0) throw new Error("empty numstat record");
    const firstTab = raw.indexOf("\t");
    if (firstTab < 0) throw new Error("malformed numstat entry");
    if (firstTab === 0) throw new Error("malformed numstat entry");
    const secondTab = raw.indexOf("\t", firstTab + 1);
    if (secondTab <= firstTab) throw new Error("malformed numstat entry");
    const added = raw.slice(0, firstTab);
    const removed = raw.slice(firstTab + 1, secondTab);
    let path = raw.slice(secondTab + 1);
    if (!path) {
      const source = limited[index + 1];
      const destination = limited[index + 2];
      if (!source || !destination) throw new Error("incomplete numstat rename");
      path = destination;
      index += 2;
    }
    if (submodulePaths.has(path)) continue;
    if (added === "-" && removed === "-") {
      aggregates.binaryFiles += 1;
      continue;
    }
    if (!/^\d+$/.test(added) || !/^\d+$/.test(removed)) {
      throw new Error("malformed numstat counts");
    }
    const addedCount = Number(added);
    const removedCount = Number(removed);
    if (!Number.isSafeInteger(addedCount) || !Number.isSafeInteger(removedCount)) {
      throw new Error("numstat counts out of range");
    }
    const linesAdded = aggregates.linesAdded + addedCount;
    const linesRemoved = aggregates.linesRemoved + removedCount;
    if (!Number.isSafeInteger(linesAdded) || !Number.isSafeInteger(linesRemoved)) {
      throw new Error("numstat totals out of range");
    }
    aggregates.linesAdded = linesAdded;
    aggregates.linesRemoved = linesRemoved;
  }
  return aggregates;
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

interface RunGitResult {
  stdout: string;
  stderr: string;
}

function runGit(
  exec: ExecFileFn,
  argv: readonly string[],
  cwd: string,
  signal: AbortSignal,
  classifyNotRepository = false,
): Promise<RunGitResult> {
  return new Promise<RunGitResult>((resolve, reject) => {
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
          const stderrText =
            typeof error.stderr === "string"
              ? error.stderr
              : typeof stderr === "string"
                ? stderr
                : "";
          if (
            classifyNotRepository &&
            error.code === 128 &&
            stderrText.trim().startsWith("fatal: not a git repository")
          ) {
            reject(
              Object.assign(new Error("not-repository"), {
                kind: "not-repository",
                stderr: stderrText,
              }),
            );
            return;
          }
          reject(
            Object.assign(new Error("git-failed"), {
              kind: "failed",
              code: error.code,
              killed: error.killed,
              stderr: stderrText,
            }),
          );
          return;
        }
        reject(error);
        return;
      }
      resolve({
        stdout: typeof stdout === "string" ? stdout : "",
        stderr: typeof stderr === "string" ? stderr : "",
      });
    });
  });
}

export async function defaultInspect(
  directory: string,
  signal: AbortSignal,
): Promise<WorkspaceInspection> {
  const exec: ExecFileFn = (file, args, options, cb) =>
    nodeExecFile(file, args as string[], options, cb) as unknown as Readable;

  try {
    const rootResult = await runGit(
      exec,
      ["rev-parse", "--show-toplevel"],
      directory,
      signal,
      true,
    );
    const root = rootResult.stdout.replace(/\r?\n$/, "");
    const state: MutableRecordState = {
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicts: 0,
      trackedFiles: 0,
      submodulePaths: new Set(),
      unborn: false,
    };
    const statusResult = await runGit(
      exec,
      ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
      root,
      signal,
    );
    parseRecords(statusResult.stdout, state);
    const statusKind: "clean" | "changed" | "conflict" =
      state.conflicts > 0
        ? "conflict"
        : state.staged + state.unstaged + state.untracked > 0
          ? "changed"
          : "clean";

    let baseline: string;
    try {
      const headResult = await runGit(exec, ["rev-parse", "--verify", "HEAD^{tree}"], root, signal);
      baseline = headResult.stdout.trim();
    } catch (headError: unknown) {
      const failure = headError as { code?: unknown; killed?: unknown };
      if (state.unborn && typeof failure.code === "number" && failure.killed !== true) {
        baseline = EMPTY_TREE;
      } else {
        throw headError;
      }
    }
    if (!baseline) throw new Error("missing tree baseline");

    const diffResult = await runGit(
      exec,
      ["diff", "--numstat", "-z", "--find-renames", baseline, "--"],
      root,
      signal,
    );
    const numstat = parseNumstat(diffResult.stdout, state.submodulePaths);

    return {
      kind: "repository",
      root,
      relativeCwd: relativePath(root, directory),
      ...(state.branch !== undefined ? { branch: state.branch } : {}),
      ...(state.upstream !== undefined ? { upstream: state.upstream } : {}),
      ahead: state.ahead,
      behind: state.behind,
      counts: {
        staged: state.staged,
        unstaged: state.unstaged,
        untracked: state.untracked,
        conflicts: state.conflicts,
      },
      status: statusKind,
      trackedFiles: state.trackedFiles,
      linesAdded: numstat.linesAdded,
      linesRemoved: numstat.linesRemoved,
      binaryFiles: numstat.binaryFiles,
      submodules: state.submodulePaths.size,
    };
  } catch (error: unknown) {
    const kind = isExecError(error) ? (error as { kind?: string }).kind : undefined;
    if (kind === "not-repository") {
      return { kind: "not-repository" };
    }
    throw error;
  }
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
        trackedFiles: 0,
        linesAdded: 0,
        linesRemoved: 0,
        binaryFiles: 0,
        submodules: 0,
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
          trackedFiles: 0,
          linesAdded: 0,
          linesRemoved: 0,
          binaryFiles: 0,
          submodules: 0,
          checkedAt: Date.now(),
        });
        return;
      }
      this.publish({
        status: inspection.status,
        directory: this.directory,
        root: inspection.root,
        relativeCwd: inspection.relativeCwd,
        ...(inspection.branch !== undefined ? { branch: inspection.branch } : {}),
        ...(inspection.upstream !== undefined ? { upstream: inspection.upstream } : {}),
        ahead: inspection.ahead,
        behind: inspection.behind,
        counts: { ...inspection.counts },
        trackedFiles: inspection.trackedFiles,
        linesAdded: inspection.linesAdded,
        linesRemoved: inspection.linesRemoved,
        binaryFiles: inspection.binaryFiles,
        submodules: inspection.submodules,
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
          ...(previous.relativeCwd !== undefined ? { relativeCwd: previous.relativeCwd } : {}),
          ...(previous.branch !== undefined ? { branch: previous.branch } : {}),
          ...(previous.upstream !== undefined ? { upstream: previous.upstream } : {}),
          ahead: previous.ahead,
          behind: previous.behind,
          counts: { ...previous.counts },
          trackedFiles: previous.trackedFiles,
          linesAdded: previous.linesAdded,
          linesRemoved: previous.linesRemoved,
          binaryFiles: previous.binaryFiles,
          submodules: previous.submodules,
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
          trackedFiles: 0,
          linesAdded: 0,
          linesRemoved: 0,
          binaryFiles: 0,
          submodules: 0,
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
