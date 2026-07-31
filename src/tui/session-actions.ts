import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

export type SessionDetails = {
  name: string | undefined;
  id: string;
  file: string | undefined;
  cwd: string;
  model: string | undefined;
};

export function formatSessionDetails(details: SessionDetails): string {
  return [
    "Session details",
    `Name: ${details.name ?? "Untitled"}`,
    `ID: ${details.id}`,
    `File: ${details.file ?? "In memory"}`,
    `Directory: ${details.cwd}`,
    `Model: ${details.model ?? "None"}`,
  ].join("\n");
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
      formatSessionDetails({
        name: pi.getSessionName(),
        id,
        file: ctx.sessionManager.getSessionFile(),
        cwd: ctx.cwd,
        model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
      }),
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
      onComplete: () => ctx.ui.notify("Session compacted", "info"),
      onError: (error) => ctx.ui.notify(error.message, "warning"),
    });
  } catch (error) {
    ctx.ui.notify(
      `Session action failed: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
}
