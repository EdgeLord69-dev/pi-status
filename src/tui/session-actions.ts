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

export async function handleSessionActions(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/statusline session requires interactive TUI", "warning");
    return;
  }

  try {
    const id = ctx.sessionManager.getSessionId();
    const action = await ctx.ui.select(
      [
        "Session details",
        `Name: ${pi.getSessionName() ?? "Untitled"}`,
        `ID: ${id}`,
        `File: ${ctx.sessionManager.getSessionFile() ?? "In memory"}`,
        `Directory: ${ctx.cwd}`,
        `Model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "None"}`,
      ].join("\n"),
      ["Rename session", "Compact session", "Close"],
    );

    if (action === "Rename session") {
      const name = (await ctx.ui.input("Rename session", "Session name"))?.trim();
      if (!name) return;
      pi.setSessionName(name);
      ctx.ui.notify(`Session renamed to ${name}`, "info");
      return;
    }

    if (action !== "Compact session") return;
    const confirmed = await ctx.ui.confirm(
      "Compact session?",
      `Pi will summarize older context for session ${id}. Continue?`,
    );
    if (!confirmed) return;

    ctx.compact({
      onComplete: () => notifyIfActive(ctx, "Session compacted", "info"),
      onError: (error) => notifyIfActive(ctx, error.message, "warning"),
    });
  } catch (error) {
    ctx.ui.notify(
      `Session action failed: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
}
