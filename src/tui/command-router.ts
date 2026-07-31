export type StatusLineCommand =
  | { kind: "editor" }
  | { kind: "session" }
  | { kind: "tools" }
  | { kind: "unknown"; command: string };

export function parseStatusLineCommand(args: string): StatusLineCommand {
  const command = args.trim();
  if (!command) return { kind: "editor" };
  const lower = command.toLowerCase();
  if (lower === "tools") return { kind: "tools" };
  if (lower === "session") return { kind: "session" };
  return { kind: "unknown", command };
}
