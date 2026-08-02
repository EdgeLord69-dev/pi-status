import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig } from "./core/config.ts";
import { createActivityRuntime } from "./core/activity-runtime.ts";
import type { SpawnNotificationProcess } from "./core/completion-notifier.ts";
import { buildSnapshot, resolveFooter } from "./core/resolve-footer.ts";
import { createNotificationsWiring } from "./core/notifications-wiring.ts";
import { createRuntimeStateMachine } from "./core/runtime-state.ts";
import { createUsageRuntime } from "./core/usage-runtime.ts";
import { createWorkspacePulseRuntime, type WorkspacePulseRuntime } from "./core/workspace-pulse.ts";
import type { AccessType, PiStatusConfig, StatusLineZones } from "./shared/types.ts";
import { parseStatusLineCommand } from "./tui/command-router.ts";
import { handleDisplayPreset } from "./tui/preset-actions.ts";
import { openToolControls } from "./tui/tool-controls.ts";
import { handleSessionActions } from "./tui/session-actions.ts";
import { buildFooterRowsFromResolved } from "./tui/render.ts";
import { fromPiTheme, noColorRequested, noTheme } from "./tui/theme.ts";
import { openStatusLineDashboard, type StatusLineDashboardComponent } from "./tui/dashboard.ts";

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

function getAccessType(ctx: ExtensionContext): AccessType | undefined {
  if (!ctx.model) return undefined;
  return ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model)
    ? "subscription"
    : "metered";
}

function isActiveTuiSession(
  ctx: ExtensionContext,
  manager: ExtensionContext["sessionManager"] | undefined,
): boolean {
  return ctx.mode === "tui" && manager !== undefined && ctx.sessionManager === manager;
}

export default function createExtension(pi: ExtensionAPI): void {
  const runtimeState = createRuntimeStateMachine(loadConfig(), "off");
  let activeTuiSessionManager: ExtensionContext["sessionManager"] | undefined;

  function saveAndApplyConfig(next: PiStatusConfig): void {
    saveConfig(next);
    runtimeState.update({ type: "config_reload", config: next });
    syncWorkspacePulse(next);
  }

  let dashboardOpen = false;
  let activeDashboard: StatusLineDashboardComponent | undefined;

  function closeActiveDashboard(): void {
    activeDashboard?.close();
    activeDashboard = undefined;
  }

  function currentFooterInput(ctx: ExtensionContext) {
    const snap = runtimeState.snapshot();
    const activeCtx = snap.ctx ?? ctx;
    return buildSnapshot({
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
      activity: activityRuntime.snapshot(),
      ...(workspacePulseRuntime ? { workspacePulse: workspacePulseRuntime.snapshot() } : {}),
    });
  }

  const usageRuntime = createUsageRuntime(pi);
  const activityRuntime = createActivityRuntime();
  let workspacePulseRuntime: WorkspacePulseRuntime | undefined;
  const footerProviderState = {
    gitBranch: null as string | null,
    extensionStatuses: new Map<string, string>(),
  };

  function isWorkspacePulseEnabled(zones: StatusLineZones): boolean {
    return Object.values(zones).some((zone) => zone.includes("workspace-pulse"));
  }

  function syncWorkspacePulse(config: PiStatusConfig): void {
    if (!workspacePulseRuntime) return;
    if (isWorkspacePulseEnabled(config.zones)) {
      workspacePulseRuntime.start();
    } else {
      workspacePulseRuntime.stop();
    }
  }

  let notifications = createNotificationsWiring({
    events: pi.events,
    isEnabled: () => runtimeState.snapshot().config.completionNotifications,
    sessionManager: activeTuiSessionManager,
    spawn: (pi as unknown as { spawn?: SpawnNotificationProcess }).spawn,
    platform: (pi as unknown as { platform?: NodeJS.Platform }).platform,
  });

  function attachNotificationsForCurrentSession(): void {
    notifications.dispose();
    notifications = createNotificationsWiring({
      events: pi.events,
      isEnabled: () => runtimeState.snapshot().config.completionNotifications,
      sessionManager: activeTuiSessionManager,
      spawn: (pi as unknown as { spawn?: SpawnNotificationProcess }).spawn,
      platform: (pi as unknown as { platform?: NodeJS.Platform }).platform,
    });
  }

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

    if (!workspacePulseRuntime) {
      workspacePulseRuntime = createWorkspacePulseRuntime({ directory: ctx.cwd });
    }

    const factory: FooterFactory = (tui, theme, footerData) => {
      const requestRender = () => tui.requestRender?.();
      runtimeState.onInvalidate(requestRender);
      usageRuntime.setOnChange(requestRender);
      activityRuntime.setOnChange(requestRender);
      workspacePulseRuntime?.setOnChange(requestRender);
      const unsubscribe = footerData.onBranchChange?.(() => {
        refreshFooterProviderState(footerData);
        requestRender();
      });

      return {
        dispose() {
          unsubscribe?.();
          runtimeState.onInvalidate(undefined);
          usageRuntime.setOnChange(undefined);
          activityRuntime.setOnChange(undefined);
          workspacePulseRuntime?.setOnChange(undefined);
        },
        invalidate() {
          requestRender();
        },
        render(width: number) {
          refreshFooterProviderState(footerData);

          const snap = runtimeState.snapshot();
          const statusTheme = noColorRequested() ? noTheme : fromPiTheme(theme);
          const snapshot = currentFooterInput(ctx);
          return buildFooterRowsFromResolved(
            resolveFooter(snapshot, snap.config, statusTheme),
            statusTheme,
            width,
          );
        },
      };
    };

    ctx.ui.setFooter(factory as never);
    syncWorkspacePulse(runtimeState.snapshot().config);
  }

  function handleNotificationsCommand(
    ctx: ExtensionContext,
    action: "query" | "on" | "off" | "invalid",
  ): void {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("/statusline requires interactive UI", "warning");
      return;
    }
    if (action === "invalid") {
      ctx.ui.notify("Usage: /statusline notifications [on|off]", "warning");
      return;
    }
    if (action === "query") {
      const enabled = runtimeState.snapshot().config.completionNotifications;
      ctx.ui.notify(
        enabled ? "Completion notifications: on" : "Completion notifications: off",
        "info",
      );
      return;
    }
    const current = runtimeState.snapshot().config;
    const next: PiStatusConfig = {
      ...current,
      completionNotifications: action === "on",
    };
    try {
      saveAndApplyConfig(next);
    } catch {
      ctx.ui.notify("Failed to save statusline config", "warning");
      return;
    }
    ctx.ui.notify(
      next.completionNotifications
        ? "Completion notifications: on"
        : "Completion notifications: off",
      "info",
    );
  }

  pi.registerCommand("statusline", {
    description: "Configure statusline segments and extension-status visibility",
    handler: async (args, ctx) => {
      const command = parseStatusLineCommand(args);
      if (command.kind === "tools") {
        await openToolControls(pi, ctx);
        return;
      }
      if (command.kind === "session") {
        await handleSessionActions(pi, ctx);
        return;
      }
      if (command.kind === "notifications") {
        handleNotificationsCommand(ctx, command.action);
        return;
      }
      if (command.kind === "preset") {
        await handleDisplayPreset(ctx, command.action, (zones) => {
          const current = runtimeState.snapshot().config;
          saveAndApplyConfig({
            ...current,
            zones,
          });
        });
        return;
      }
      if (command.kind === "unknown") {
        ctx.ui.notify(`Unknown /statusline command: ${command.command}`, "warning");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/statusline requires interactive UI", "warning");
        return;
      }
      if (dashboardOpen) return;
      dashboardOpen = true;

      const discovered = [...footerProviderState.extensionStatuses.keys()].sort((a, b) =>
        a.localeCompare(b),
      );

      try {
        await openStatusLineDashboard({
          pi,
          ctx,
          config: runtimeState.snapshot().config,
          discoveredStatuses: discovered,
          usageAvailable: usageRuntime.getAvailable(),
          getPreviewInput: () => currentFooterInput(ctx),
          save: saveAndApplyConfig,
          onComponent(component) {
            activeDashboard = component;
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not open statusline dashboard: ${message}`, "warning");
      } finally {
        dashboardOpen = false;
        activeDashboard = undefined;
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    closeActiveDashboard();
    workspacePulseRuntime?.setOnChange(undefined);
    workspacePulseRuntime?.dispose();
    workspacePulseRuntime = undefined;
    resetFooterProviderState();
    activityRuntime.setOnChange(undefined);
    activityRuntime.reset();
    usageRuntime.requestCurrent();
    runtimeState.update({ type: "session_start", ctx });
    activeTuiSessionManager = ctx.mode === "tui" ? ctx.sessionManager : undefined;
    runtimeState.update({
      type: "thinking_level_changed",
      ctx,
      level: String(ctx.thinkingLevel ?? pi.getThinkingLevel()),
    });
    runtimeState.update({ type: "config_reload", config: loadConfig() });
    attachNotificationsForCurrentSession();
    installFooter(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    closeActiveDashboard();
    resetFooterProviderState();
    activityRuntime.setOnChange(undefined);
    activityRuntime.reset();
    runtimeState.update({ type: "session_tree", ctx });
    activeTuiSessionManager = ctx.mode === "tui" ? ctx.sessionManager : undefined;
    runtimeState.update({
      type: "thinking_level_changed",
      ctx,
      level: String(ctx.thinkingLevel ?? pi.getThinkingLevel()),
    });
    runtimeState.update({ type: "config_reload", config: loadConfig() });
    attachNotificationsForCurrentSession();
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

  pi.on("agent_start", (_event, ctx) => {
    notifications.notifyRunStarted(ctx);
    if (isActiveTuiSession(ctx, activeTuiSessionManager)) {
      activityRuntime.startRun();
    }
  });

  pi.on("turn_start", (event, ctx) => {
    notifications.notifyRunStarted(ctx);
    if (isActiveTuiSession(ctx, activeTuiSessionManager)) {
      activityRuntime.startTurn(event.turnIndex, event.timestamp);
      workspacePulseRuntime?.refresh();
    }
  });

  pi.on("turn_end", (_event, ctx) => {
    if (isActiveTuiSession(ctx, activeTuiSessionManager)) {
      activityRuntime.finishTurn();
    }
  });

  pi.on("before_provider_request", (_event, ctx) => {
    if (isActiveTuiSession(ctx, activeTuiSessionManager)) {
      activityRuntime.startResponse();
    }
  });

  pi.on("message_update", (event, ctx) => {
    if (isActiveTuiSession(ctx, activeTuiSessionManager)) {
      if (event.message?.role === "assistant") {
        const estimated = estimateTokens(event.message);
        if (Number.isFinite(estimated) && estimated > 0) {
          activityRuntime.updateResponseEstimate(estimated);
        }
      }
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (isActiveTuiSession(ctx, activeTuiSessionManager)) {
      if (event.message?.role === "assistant") {
        activityRuntime.finishResponse(event.message.usage?.output);
      }
    }
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (isActiveTuiSession(ctx, activeTuiSessionManager)) {
      activityRuntime.startTool(event.toolCallId, event.toolName);
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (isActiveTuiSession(ctx, activeTuiSessionManager)) {
      activityRuntime.finishTool(event.toolCallId, event.isError);
      workspacePulseRuntime?.scheduleRefresh();
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    notifications.notifyAgentSettled(ctx);
    if (isActiveTuiSession(ctx, activeTuiSessionManager) && ctx.isIdle()) {
      activityRuntime.finishRun();
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    const activeCtx = runtimeState.snapshot().ctx;
    if (activeCtx && activeCtx.sessionManager !== ctx.sessionManager) return;
    closeActiveDashboard();
    resetFooterProviderState();
    if (
      activeTuiSessionManager === undefined ||
      (ctx.mode === "tui" && ctx.sessionManager === activeTuiSessionManager)
    ) {
      notifications.dispose();
      activityRuntime.setOnChange(undefined);
      activityRuntime.reset();
      workspacePulseRuntime?.setOnChange(undefined);
      workspacePulseRuntime?.dispose();
      workspacePulseRuntime = undefined;
      activeTuiSessionManager = undefined;
    }
    runtimeState.update({ type: "session_shutdown" });
    usageRuntime.setOnChange(undefined);
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}
