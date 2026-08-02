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
