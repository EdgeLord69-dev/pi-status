import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

function notifyIfActive(
  ctx: ExtensionCommandContext,
  message: string,
  type: "info" | "warning",
): void {
  try {
    ctx.ui.notify(message, type);
  } catch {
    // Deferred callbacks may outlive the command context after session replacement.
  }
}

export interface SessionDetails {
  name: string;
  id: string;
  file: string;
  directory: string;
  model: string;
}

export function readSessionDetails(pi: ExtensionAPI, ctx: ExtensionCommandContext): SessionDetails {
  return {
    name: pi.getSessionName() ?? "Untitled",
    id: ctx.sessionManager.getSessionId(),
    file: ctx.sessionManager.getSessionFile() ?? "In memory",
    directory: ctx.cwd,
    model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "None",
  };
}

export function renameCurrentSession(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  input: string,
): SessionDetails {
  const details = readSessionDetails(pi, ctx);
  const name = input.trim();
  if (!name) return details;
  pi.setSessionName(name);
  return { ...details, name };
}

export function startSessionCompaction(ctx: ExtensionCommandContext): void {
  ctx.compact({
    onComplete: () => notifyIfActive(ctx, "Session compacted", "info"),
    onError: (error) => notifyIfActive(ctx, error.message, "warning"),
  });
}

export async function handleSessionActions(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/statusline session requires interactive TUI", "warning");
    return;
  }

  try {
    const details = readSessionDetails(pi, ctx);
    const action = await ctx.ui.select(
      [
        "Session details",
        `Name: ${details.name}`,
        `ID: ${details.id}`,
        `File: ${details.file}`,
        `Directory: ${details.directory}`,
        `Model: ${details.model}`,
      ].join("\n"),
      ["Rename session", "Compact session", "Close"],
    );

    if (action === "Rename session") {
      const input = await ctx.ui.input("Rename session", "Session name");
      if (!input?.trim()) return;
      const renamed = renameCurrentSession(pi, ctx, input);
      ctx.ui.notify(`Session renamed to ${renamed.name}`, "info");
      return;
    }

    if (action !== "Compact session") return;
    const confirmed = await ctx.ui.confirm(
      "Compact session?",
      `Pi will summarize older context for session ${details.id}. Continue?`,
    );
    if (!confirmed) return;

    startSessionCompaction(ctx);
  } catch (error) {
    ctx.ui.notify(
      `Session action failed: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
}
