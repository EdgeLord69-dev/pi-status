export type StatusLineCommand =
  | { kind: "editor" }
  | { kind: "session" }
  | { kind: "unknown"; command: string };

export function parseStatusLineCommand(args: string): StatusLineCommand {
  const command = args.trim();
  if (!command) return { kind: "editor" };
  if (command.toLowerCase() === "session") return { kind: "session" };
  return { kind: "unknown", command };
}
