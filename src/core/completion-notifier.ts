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

export interface CompletionNotifierOptions {
  isEnabled(): boolean;
  platform?: NodeJS.Platform;
  spawn?: SpawnNotificationProcess;
}

export interface CompletionNotifier {
  runStarted(): void;
  inputRequested(intervalId: string): void;
  turnSettled(): void;
  reset(): void;
}

const PROCESS_TIMEOUT_MS = 3_000;
const APPLE_SCRIPT = [
  "on run argv",
  "display notification (item 2 of argv) with title (item 1 of argv)",
  "end run",
] as const;
const WINDOWS_TOAST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
  "[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
  "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
  "$texts = $xml.GetElementsByTagName('text')",
  "$texts.Item(0).AppendChild($xml.CreateTextNode($env:PI_STATUS_NOTIFICATION_TITLE)) > $null",
  "$texts.Item(1).AppendChild($xml.CreateTextNode($env:PI_STATUS_NOTIFICATION_BODY)) > $null",
  "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Pi Status').Show($toast)",
].join("; ");

const defaultSpawn: SpawnNotificationProcess = (file, args, options) =>
  nodeSpawn(file, args, options) as unknown as NotificationProcess;

export function createCompletionNotifier(options: CompletionNotifierOptions): CompletionNotifier {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? defaultSpawn;
  let settledNotified = false;
  const questionnaireIntervals = new Set<string>();
  const activeCancellations = new Set<() => void>();

  function deliver(title: string, body: string): void {
    if (!options.isEnabled()) return;

    let cancel: (() => void) | undefined;
    cancel = spawnNotification(platform, spawn, title, body, () => {
      if (cancel) activeCancellations.delete(cancel);
    });
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
      deliver("Pi needs input", "A questionnaire is waiting for you.");
    },

    turnSettled(): void {
      if (settledNotified) return;
      settledNotified = true;
      deliver("Pi finished", "The current run has settled.");
    },

    reset(): void {
      settledNotified = false;
      questionnaireIntervals.clear();
      for (const cancel of activeCancellations) cancel();
      activeCancellations.clear();
    },
  };
}

function spawnNotification(
  platform: NodeJS.Platform,
  spawn: SpawnNotificationProcess,
  title: string,
  body: string,
  onFinished: () => void,
): (() => void) | undefined {
  if (platform === "darwin") {
    return spawnDetached(
      spawn,
      "/usr/bin/osascript",
      [...APPLE_SCRIPT.flatMap((line) => ["-e", line]), "--", title, body],
      {},
      onFinished,
    );
  }
  if (platform === "win32") {
    return spawnDetached(
      spawn,
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", WINDOWS_TOAST_SCRIPT],
      {
        env: {
          ...process.env,
          PI_STATUS_NOTIFICATION_TITLE: title,
          PI_STATUS_NOTIFICATION_BODY: body,
        },
        windowsHide: true,
      },
      onFinished,
    );
  }
  return undefined;
}

function spawnDetached(
  spawn: SpawnNotificationProcess,
  file: string,
  args: string[],
  extra: Pick<SpawnOptions, "env" | "windowsHide">,
  onFinished: () => void,
): (() => void) | undefined {
  let child: NotificationProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  const finish = (kill: boolean): void => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (kill) {
      try {
        child?.kill();
      } catch {
        // Native delivery is best effort.
      }
    }
    try {
      onFinished();
    } catch {
      // Native delivery is best effort.
    }
  };

  try {
    child = spawn(file, args, { detached: true, stdio: "ignore", ...extra });
    child.once("error", () => finish(false));
    child.once("exit", () => finish(false));
    child.unref();
    timer = setTimeout(() => finish(true), PROCESS_TIMEOUT_MS);
    timer.unref?.();
    if (finished) clearTimeout(timer);
    return () => finish(true);
  } catch {
    finish(true);
    return undefined;
  }
}
