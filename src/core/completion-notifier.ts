export type WriteNotification = (data: string) => unknown;

export interface CompletionNotifierOptions {
  isEnabled(): boolean;
  write?: WriteNotification;
}

export interface CompletionNotifier {
  runStarted(): void;
  inputRequested(intervalId: string): void;
  turnSettled(): void;
  reset(): void;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control stripper must match the full C0/C1 range.
const TERMINAL_CONTROL = /[\x00-\x1f\x7f-\x9f]/g;

function cleanNotificationText(value: string): string {
  return value.replace(TERMINAL_CONTROL, "");
}

export function formatGhosttyNotification(title: string, body: string): string {
  return `\x1b]9;${cleanNotificationText(title)}: ${cleanNotificationText(body)}\x1b\\`;
}

const defaultWrite: WriteNotification = (data) => process.stdout.write(data);

export function createCompletionNotifier(options: CompletionNotifierOptions): CompletionNotifier {
  const write = options.write ?? defaultWrite;
  let settledNotified = false;
  const questionnaireIntervals = new Set<string>();

  function deliver(title: string, body: string): void {
    if (!options.isEnabled()) return;
    try {
      write(formatGhosttyNotification(title, body));
    } catch {
      // Terminal notification delivery is best effort.
    }
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
    },
  };
}
