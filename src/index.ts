import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig } from "./core/config.ts";
import { buildSnapshot, resolveFooter } from "./core/resolve-footer.ts";
import { createRuntimeStateMachine } from "./core/runtime-state.ts";
import { createUsageRuntime } from "./core/usage-runtime.ts";
import type { AccessType, PiStatusConfig } from "./shared/types.ts";
import { createStatusLineEditor } from "./tui/editor.ts";
import { parseStatusLineCommand } from "./tui/command-router.ts";
import { handleSessionActions } from "./tui/session-actions.ts";
import { buildFooterRowsFromResolved } from "./tui/render.ts";
import { fromPiTheme, noColorRequested, noTheme, type StatusLineTheme } from "./tui/theme.ts";

type FooterComponent = {
  render: (width: number) => string[];
  invalidate: () => void;
  dispose?: () => void;
};

type FooterDataLike = {
  getGitBranch: () => string | null;
  getExtensionStatuses: () => ReadonlyMap<string, string>;
  onBranchChange?: (listener: () => void) => (() => void) | undefined;
};

type FooterFactory = (
  tui: { requestRender?: () => void },
  theme: { fg: (color: string, text: string) => string },
  footerData: FooterDataLike,
) => FooterComponent;

type FooterProviderState = {
  gitBranch: string | null;
  extensionStatuses: Map<string, string>;
};

const EMPTY_FOOTER_FACTORY: FooterFactory = () => ({
  render(): string[] {
    return [];
  },
  invalidate(): void {},
  dispose(): void {},
});

function isLiveTheme(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { fg?: unknown; bold?: unknown };
  return typeof candidate.fg === "function" && typeof candidate.bold === "function";
}

function getAccessType(ctx: ExtensionContext): AccessType | undefined {
  if (!ctx.model) return undefined;
  return ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model)
    ? "subscription"
    : "metered";
}

export default function createExtension(pi: ExtensionAPI): void {
  const runtimeState = createRuntimeStateMachine(loadConfig(), "off");

  const usageRuntime = createUsageRuntime(pi);
  const footerProviderState: FooterProviderState = {
    gitBranch: null,
    extensionStatuses: new Map(),
  };

  function resetFooterProviderState(): void {
    footerProviderState.gitBranch = null;
    footerProviderState.extensionStatuses = new Map();
  }

  function refreshFooterProviderState(footerData: FooterDataLike): void {
    footerProviderState.gitBranch = footerData.getGitBranch();
    footerProviderState.extensionStatuses = new Map(footerData.getExtensionStatuses().entries());
  }

  function installFooter(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;

    const factory: FooterFactory = (tui, theme, footerData) => {
      const requestRender = () => tui.requestRender?.();
      runtimeState.onInvalidate(requestRender);
      usageRuntime.setOnChange(requestRender);
      const unsubscribe = footerData.onBranchChange?.(() => {
        refreshFooterProviderState(footerData);
        requestRender();
      });

      return {
        dispose() {
          unsubscribe?.();
          runtimeState.onInvalidate(undefined);
          usageRuntime.setOnChange(undefined);
        },
        invalidate() {
          requestRender();
        },
        render(width: number) {
          refreshFooterProviderState(footerData);

          const snap = runtimeState.snapshot();
          const activeCtx = snap.ctx ?? ctx;
          const statusTheme = noColorRequested() ? noTheme : fromPiTheme(theme);
          const snapshot = buildSnapshot({
            model: activeCtx.model,
            cwd: activeCtx.cwd,
            thinkingLevel: snap.thinkingLevel,
            gitBranch: footerProviderState.gitBranch,
            isIdle: activeCtx.isIdle(),
            hasPendingMessages: activeCtx.hasPendingMessages(),
            contextUsage: activeCtx.getContextUsage(),
            entries: activeCtx.sessionManager.getEntries() as unknown[],
            accessType: getAccessType(activeCtx),
            sessionId: activeCtx.sessionManager.getSessionId(),
            usageState: usageRuntime.getState(),
            extensionStatuses: footerProviderState.extensionStatuses,
          });
          return buildFooterRowsFromResolved(
            resolveFooter(snapshot, snap.config, statusTheme),
            statusTheme,
            width,
          );
        },
      };
    };

    ctx.ui.setFooter(factory as never);
  }

  function installEmptyFooter(ctx: ExtensionContext): void {
    if (ctx.mode === "tui") ctx.ui.setFooter(EMPTY_FOOTER_FACTORY as never);
  }

  pi.registerCommand("statusline", {
    description: "Configure statusline segments and extension-status visibility",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/statusline requires interactive UI", "warning");
        return;
      }

      const command = parseStatusLineCommand(args);
      if (command.kind === "session") {
        await handleSessionActions(pi, ctx);
        return;
      }
      if (command.kind === "unknown") {
        ctx.ui.notify(`Unknown /statusline command: ${command.command}`, "warning");
        return;
      }

      const discovered = [...footerProviderState.extensionStatuses.keys()].sort((a, b) =>
        a.localeCompare(b),
      );

      let result: PiStatusConfig | null = null;
      try {
        installEmptyFooter(ctx);
        result = await ctx.ui.custom<PiStatusConfig | null>((tui, theme, _keys, done) => {
          const editorSnap = runtimeState.snapshot();
          const activeCtx = editorSnap.ctx ?? ctx;
          const menuTheme: StatusLineTheme = noColorRequested()
            ? noTheme
            : isLiveTheme(theme)
              ? fromPiTheme(theme)
              : noTheme;
          const snapshot = buildSnapshot({
            model: activeCtx.model,
            cwd: activeCtx.cwd,
            thinkingLevel: editorSnap.thinkingLevel,
            gitBranch: footerProviderState.gitBranch,
            isIdle: activeCtx.isIdle(),
            hasPendingMessages: activeCtx.hasPendingMessages(),
            contextUsage: activeCtx.getContextUsage(),
            entries: activeCtx.sessionManager.getEntries() as unknown[],
            accessType: getAccessType(activeCtx),
            sessionId: activeCtx.sessionManager.getSessionId(),
            usageState: usageRuntime.getState(),
            extensionStatuses: footerProviderState.extensionStatuses,
          });
          return createStatusLineEditor({
            config: editorSnap.config,
            discoveredStatuses: discovered,
            previewInput: snapshot,
            theme: menuTheme,
            done,
            requestRender: () => tui.requestRender?.(),
            usageAvailable: usageRuntime.getAvailable(),
          });
        });
      } finally {
        installFooter(ctx);
      }

      if (!result) return;

      try {
        saveConfig(result);
        runtimeState.update({ type: "config_reload", config: result });
      } catch {
        ctx.ui.notify("Failed to save statusline config", "warning");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    resetFooterProviderState();
    usageRuntime.requestCurrent();
    runtimeState.update({ type: "session_start", ctx });
    runtimeState.update({
      type: "thinking_level_changed",
      ctx,
      level: String(ctx.thinkingLevel ?? pi.getThinkingLevel()),
    });
    runtimeState.update({ type: "config_reload", config: loadConfig() });
    installFooter(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    resetFooterProviderState();
    runtimeState.update({ type: "session_tree", ctx });
    runtimeState.update({
      type: "thinking_level_changed",
      ctx,
      level: String(ctx.thinkingLevel ?? pi.getThinkingLevel()),
    });
    runtimeState.update({ type: "config_reload", config: loadConfig() });
    installFooter(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    runtimeState.update({ type: "model_select", ctx });
  });

  pi.on("thinking_level_select", (event, ctx) => {
    runtimeState.update({
      type: "thinking_level_changed",
      ctx,
      level: String(event.level),
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    resetFooterProviderState();
    runtimeState.update({ type: "session_shutdown" });
    usageRuntime.setOnChange(undefined);
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}
