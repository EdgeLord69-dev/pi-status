import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";

export interface NotificationProcess {
  kill(): boolean;
  once(event: "error" | "exit", listener: (...args: unknown[]) => void): this;
  unref(): void;
}

export type SpawnNotificationProcess = (
  file: string,
  args: string[],
  options: SpawnOptions,
) => NotificationProcess;

export type WriteNotification = (data: string) => unknown;

export interface CompletionNotifierOptions {
  isEnabled(): boolean;
  spawn?: SpawnNotificationProcess;
  env?: NodeJS.ProcessEnv;
  write?: WriteNotification;
}

export interface CompletionNotifier {
  runStarted(): void;
  inputRequested(intervalId: string): void;
  turnSettled(): void;
  reset(): void;
}

type NotificationSound = "done" | "request";

const PROCESS_TIMEOUT_MS = 3_000;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control stripper must match the full C0/C1 range.
const TERMINAL_CONTROL = /[\x00-\x1f\x7f-\x9f]/g;

function cleanNotificationText(value: string): string {
  return value.replace(TERMINAL_CONTROL, "");
}

export function formatGhosttyNotification(title: string, body: string): string {
  return `\x1b]9;${cleanNotificationText(title)}: ${cleanNotificationText(body)}\x1b\\`;
}

const defaultSpawn: SpawnNotificationProcess = (file, args, options) =>
  nodeSpawn(file, args, options) as unknown as NotificationProcess;
const defaultWrite: WriteNotification = (data) => process.stdout.write(data);

export function createCompletionNotifier(options: CompletionNotifierOptions): CompletionNotifier {
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? defaultSpawn;
  const write = options.write ?? defaultWrite;
  let settledNotified = false;
  const questionnaireIntervals = new Set<string>();
  const activeCancellations = new Set<() => void>();

  function writeOsc(title: string, body: string): void {
    try {
      write(formatGhosttyNotification(title, body));
    } catch {
      // Terminal notification delivery is best effort.
    }
  }

  function deliver(title: string, body: string, sound: NotificationSound): void {
    if (!options.isEnabled()) return;
    if (env.HERDR_ENV !== "1") {
      writeOsc(title, body);
      return;
    }

    let cancel: (() => void) | undefined;
    cancel = spawnHerdr(
      spawn,
      env.HERDR_BIN_PATH || "herdr",
      ["notification", "show", title, "--body", body, "--sound", sound],
      env,
      () => writeOsc(title, body),
      () => {
        if (cancel) activeCancellations.delete(cancel);
      },
    );
    if (cancel) activeCancellations.add(cancel);
  }

  return {
    runStarted(): void {
      settledNotified = false;
      questionnaireIntervals.clear();
    },

    inputRequested(intervalId: string): void {
      if (questionnaireIntervals.has(intervalId)) return;
      questionnaireIntervals.add(intervalId);
      deliver("Pi needs input", "A questionnaire is waiting for you.", "request");
    },

    turnSettled(): void {
      if (settledNotified) return;
      settledNotified = true;
      deliver("Pi finished", "The current run has settled.", "done");
    },

    reset(): void {
      settledNotified = false;
      questionnaireIntervals.clear();
      for (const cancel of activeCancellations) cancel();
      activeCancellations.clear();
    },
  };
}

function spawnHerdr(
  spawn: SpawnNotificationProcess,
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  onLaunchError: () => void,
  onFinished: () => void,
): (() => void) | undefined {
  let child: NotificationProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  const finish = (kill: boolean, fallback: boolean): void => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (kill) {
      try {
        child?.kill();
      } catch {
        // Herdr delivery is best effort.
      }
    }
    if (fallback) {
      try {
        onLaunchError();
      } catch {
        // Herdr delivery is best effort.
      }
    }
    try {
      onFinished();
    } catch {
      // Herdr delivery is best effort.
    }
  };

  try {
    child = spawn(file, args, { detached: true, stdio: "ignore", env });
    child.once("error", () => finish(false, true));
    if (finished) return undefined;
    child.once("exit", () => finish(false, false));
    if (finished) return undefined;
    child.unref();
    if (finished) return undefined;
    timer = setTimeout(() => finish(true, false), PROCESS_TIMEOUT_MS);
    timer.unref?.();
    return () => finish(true, false);
  } catch {
    finish(true, true);
    return undefined;
  }
}
