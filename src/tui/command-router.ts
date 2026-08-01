import { isDisplayPresetName, type PresetAction } from "./preset-actions.ts";

export type NotificationCommandAction = "query" | "on" | "off" | "invalid";

export type StatusLineCommand =
  | { kind: "editor" }
  | { kind: "session" }
  | { kind: "tools" }
  | { kind: "notifications"; action: NotificationCommandAction }
  | { kind: "preset"; action: PresetAction }
  | { kind: "unknown"; command: string };

export function parseStatusLineCommand(args: string): StatusLineCommand {
  const trimmed = args.trim();
  if (!trimmed) return { kind: "editor" };
  const tokens = trimmed.toLowerCase().split(/\s+/);
  const [head, sub, extra] = tokens;
  if (head === "tools") {
    if (sub !== undefined) return { kind: "unknown", command: trimmed };
    return { kind: "tools" };
  }
  if (head === "session") {
    if (sub !== undefined) return { kind: "unknown", command: trimmed };
    return { kind: "session" };
  }
  if (head === "preset") {
    if (sub === undefined) return { kind: "preset", action: { type: "select" } };
    if (extra !== undefined) return { kind: "preset", action: { type: "invalid" } };
    if (isDisplayPresetName(sub)) {
      return { kind: "preset", action: { type: "apply", name: sub } };
    }
    return { kind: "preset", action: { type: "invalid" } };
  }
  if (head === "notifications") {
    if (sub === undefined) return { kind: "notifications", action: "query" };
    if (extra !== undefined) return { kind: "notifications", action: "invalid" };
    if (sub === "on") return { kind: "notifications", action: "on" };
    if (sub === "off") return { kind: "notifications", action: "off" };
    return { kind: "notifications", action: "invalid" };
  }
  return { kind: "unknown", command: trimmed };
}
