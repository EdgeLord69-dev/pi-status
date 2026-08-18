import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { loadConfig, normalizeSidebarPanelLayout, saveConfig } from "./core/config.ts";
import {
  createSidebarLayoutRuntime,
  persistSidebarLayout,
  reconcileSidebarEffectiveLayout,
  seedSidebarEffectiveLayout,
  sidebarLayoutDemandsWorkspacePulse,
  type SidebarLayoutRuntime,
} from "./core/sidebar-layout.ts";
import { createActivityRuntime } from "./core/activity-runtime.ts";
import { buildSnapshot, resolveFooter } from "./core/resolve-footer.ts";
import { createNotificationsWiring } from "./core/notifications-wiring.ts";
import { createRuntimeStateMachine } from "./core/runtime-state.ts";
import { reconstructTodos, parseTodoDetails } from "./core/todos.ts";
import { createUsageRuntime } from "./core/usage-runtime.ts";
import { createWorkspacePulseRuntime, type WorkspacePulseRuntime } from "./core/workspace-pulse.ts";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  DEFAULT_SIDEBAR_PANEL_LAYOUT,
  type AccessType,
  type NormalizedTodo,
  type PiStatusConfig,
  type SidebarCatalogEntry,
  type SidebarEffectiveLayout,
  type StatusLineZones,
} from "./shared/types.ts";
import { buildFooterRowsFromResolved } from "./tui/render.ts";
import { fromPiTheme, noColorRequested, noTheme } from "./tui/theme.ts";
import { openStatusLineDashboard, type StatusLineDashboardComponent } from "./tui/dashboard.ts";
import {
  createSidebarController,
  type SidebarController,
  type SidebarView,
} from "./tui/sidebar.ts";
import { buildSidebarSnapshot } from "./tui/sidebar-render.ts";
import { buildSidebarSegmentCatalog } from "./tui/sidebar-segments.ts";
import type { SidebarPanelEventTransport, SidebarPanelRegistry } from "./tui/sidebar-panels.ts";
import {
  createSidebarPanelRegistry,
  isSidebarPanelContributionId,
  isSidebarPanelId,
  isSidebarPanelRequestId,
  isSidebarPanelRole,
  isSidebarPanelSource,
  registerSidebarPanel,
  sanitizeSidebarPanelText,
  SIDEBAR_PANEL_CHANNEL,
  SIDEBAR_PANEL_MAX_ID_CHARS,
  SIDEBAR_PANEL_MAX_PANELS,
  SIDEBAR_PANEL_MAX_ROW_CHARS,
  SIDEBAR_PANEL_MAX_ROWS,
  SIDEBAR_PANEL_MAX_SOURCE_CHARS,
  SIDEBAR_PANEL_MAX_TITLE_CHARS,
  SIDEBAR_PANEL_MAX_TRACKED_SOURCES,
  SIDEBAR_PANEL_PROTOCOL_VERSION,
} from "./tui/sidebar-panels.ts";

export type {
  SidebarPanelContribution,
  SidebarPanelData,
  SidebarPanelDiscoveryEvent,
  SidebarPanelEvent,
  SidebarPanelEventTransport,
  SidebarPanelRegisterEvent,
  SidebarPanelRegistry,
  SidebarPanelRegistryOptions,
  SidebarPanelRole,
  SidebarPanelRow,
  SidebarPanelUnregisterEvent,
} from "./tui/sidebar-panels.ts";
export type {
  BuiltinSidebarPanelId,
  ContributedSidebarPanelId,
  SidebarPanelId,
  SidebarPanelLayout,
  SidebarPanelLayoutEntry,
} from "./shared/types.ts";

export {
  BUILTIN_SIDEBAR_PANEL_IDS,
  DEFAULT_SIDEBAR_PANEL_LAYOUT,
  createSidebarPanelRegistry,
  isSidebarPanelContributionId,
  isSidebarPanelId,
  isSidebarPanelRequestId,
  isSidebarPanelRole,
  isSidebarPanelSource,
  normalizeSidebarPanelLayout,
  registerSidebarPanel,
  sanitizeSidebarPanelText,
  SIDEBAR_PANEL_CHANNEL,
  SIDEBAR_PANEL_MAX_ID_CHARS,
  SIDEBAR_PANEL_MAX_PANELS,
  SIDEBAR_PANEL_MAX_ROW_CHARS,
  SIDEBAR_PANEL_MAX_ROWS,
  SIDEBAR_PANEL_MAX_SOURCE_CHARS,
  SIDEBAR_PANEL_MAX_TITLE_CHARS,
  SIDEBAR_PANEL_MAX_TRACKED_SOURCES,
  SIDEBAR_PANEL_PROTOCOL_VERSION,
};

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
  let activeSidebarController: SidebarController | undefined;
  let activeSidebarRegistry: SidebarPanelRegistry | undefined;
  let sidebarLayoutRuntime: SidebarLayoutRuntime | undefined;
  let currentTodos: NormalizedTodo[] = [];

  pi.registerShortcut("ctrl+shift+r", {
    description: "Resize the pi-status sidebar",
    handler: (ctx) => {
      if (ctx.mode !== "tui") return;
      if (ctx.sessionManager !== activeTuiSessionManager) return;
      const controller = activeSidebarController;
      if (!controller?.isEffectivelyVisible()) {
        ctx.ui.notify("pi-status sidebar is not visible", "warning");
        return;
      }
      closeActiveDashboard();
      controller.beginResize();
    },
  });

  function saveAndApplyConfig(
    next: PiStatusConfig,
    sidebarLayout: SidebarEffectiveLayout,
    catalog: readonly SidebarCatalogEntry[],
  ): void {
    const ctx = runtimeState.snapshot().ctx;
    if (ctx?.mode === "tui") {
      persistSidebarLayout({
        config: next,
        effective: sidebarLayout,
        catalog,
        persist: saveConfig,
        commit: (committed, committedLayout) => {
          sidebarLayoutRuntime?.replace(committedLayout, catalog);
          runtimeState.update({ type: "config_reload", config: committed });
          applySurfaceVisibility(ctx, committed);
        },
      });
      return;
    }
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

  function safelyDisposeSidebarController(): void {
    const controller = activeSidebarController;
    if (!controller) return;
    try {
      controller.dispose();
    } catch {
      // Disposal is best effort; never block subsequent cleanup.
    }
  }

  function safelyDisposeSidebarRegistry(): void {
    const registry = activeSidebarRegistry;
    if (!registry) return;
    try {
      registry.dispose();
    } catch {
      // Disposal is best effort; never block subsequent cleanup.
    }
  }

  function safeRead<T>(action: () => T): T | undefined {
    try {
      return action();
    } catch {
      return undefined;
    }
  }

  function readCurrentTodos(ctx: ExtensionContext): NormalizedTodo[] {
    return safeRead(() => reconstructTodos(ctx.sessionManager.getBranch())) ?? [];
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

  function buildCurrentSidebarSnapshot(ctx: ExtensionContext) {
    const activeCtx = runtimeState.snapshot().ctx ?? ctx;
    const safeSessionName = safeRead(() => pi.getSessionName());
    const safeAvailableToolNames = safeRead(() => pi.getAllTools().map(({ name }) => name));
    const sessionFile = safeRead(() => activeCtx.sessionManager.getSessionFile());
    const branchEntries = safeRead(() => activeCtx.sessionManager.getBranch().length);
    return buildSidebarSnapshot({
      footer: currentFooterInput(ctx),
      ...(safeSessionName !== undefined ? { sessionName: safeSessionName } : {}),
      persisted: sessionFile !== undefined,
      branchEntryCount: branchEntries ?? 0,
      availableToolNames: safeAvailableToolNames ?? [],
      todos: currentTodos,
      sidebarPanels: activeSidebarRegistry?.getAvailable() ?? [],
    });
  }

  function previewSidebarView(ctx: ExtensionContext): SidebarView {
    const snapshot = buildCurrentSidebarSnapshot(ctx);
    const catalog = buildSidebarSegmentCatalog(snapshot);
    const layout = sidebarLayoutRuntime
      ? reconcileSidebarEffectiveLayout(sidebarLayoutRuntime.snapshot(), catalog)
      : seedSidebarEffectiveLayout(runtimeState.snapshot().config, catalog);
    return { snapshot, catalog, layout };
  }

  function captureSidebarView(ctx: ExtensionContext): SidebarView {
    const view = previewSidebarView(ctx);
    if (!sidebarLayoutRuntime) {
      sidebarLayoutRuntime = createSidebarLayoutRuntime({
        config: runtimeState.snapshot().config,
        catalog: view.catalog,
      });
    }
    sidebarLayoutRuntime.replace(view.layout, view.catalog);
    return { ...view, layout: sidebarLayoutRuntime.snapshot() };
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

  function sidebarWorkspaceDemand(): boolean {
    const controller = activeSidebarController;
    const ctx = runtimeState.snapshot().ctx;
    if (!controller?.isShown() || !controller.isSupported() || !ctx) return false;
    const view = captureSidebarView(ctx);
    return sidebarLayoutDemandsWorkspacePulse(view.layout, view.catalog);
  }

  function syncWorkspacePulse(config: PiStatusConfig): void {
    if (!workspacePulseRuntime) return;

    const statusbarDemand = config.statusbarEnabled && isWorkspacePulseEnabled(config.zones);
    const sidebarDemand = config.sidebarEnabled && sidebarWorkspaceDemand();

    if (statusbarDemand || sidebarDemand) {
      workspacePulseRuntime.start();
    } else {
      workspacePulseRuntime.stop();
    }
  }

  function clearRenderSubscriptions(): void {
    runtimeState.onInvalidate(undefined);
    usageRuntime.setOnChange(undefined);
    activityRuntime.setOnChange(undefined);
    workspacePulseRuntime?.setOnChange(undefined);
  }

  function setSidebarRenderSubscriptions(): void {
    if (!activeSidebarController) return;
    const requestRender = () => activeSidebarController?.requestRender();
    runtimeState.onInvalidate(requestRender);
    usageRuntime.setOnChange(requestRender);
    activityRuntime.setOnChange(requestRender);
    workspacePulseRuntime?.setOnChange(requestRender);
  }

  function applySurfaceVisibility(ctx: ExtensionContext, config: PiStatusConfig): void {
    if (ctx.mode !== "tui") return;

    activeSidebarController?.setShown(config.sidebarEnabled);
    installFooter(ctx, config);
    if (!config.statusbarEnabled) setSidebarRenderSubscriptions();
    syncWorkspacePulse(config);
    activeSidebarController?.requestRender();
  }

  let notifications = createNotificationsWiring({
    events: pi.events,
    isEnabled: () => runtimeState.snapshot().config.completionNotifications,
    sessionManager: activeTuiSessionManager,
  });

  function attachNotificationsForCurrentSession(): void {
    notifications.dispose();
    notifications = createNotificationsWiring({
      events: pi.events,
      isEnabled: () => runtimeState.snapshot().config.completionNotifications,
      sessionManager: activeTuiSessionManager,
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

  function installFooter(ctx: ExtensionContext, config = runtimeState.snapshot().config): void {
    if (ctx.mode !== "tui") return;

    if (!workspacePulseRuntime) {
      workspacePulseRuntime = createWorkspacePulseRuntime({ directory: ctx.cwd });
    }

    if (!config.statusbarEnabled) {
      ctx.ui.setFooter(undefined);
      return;
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
          clearRenderSubscriptions();
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
  }

  pi.registerCommand("statusline", {
    description: "Configure statusline layout, statuses, session, tools, and settings",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Usage: /statusline", "warning");
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
        const sidebarView = captureSidebarView(ctx);
        const sidebarPanels = [
          ...BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
            id,
            title: `${id[0]?.toUpperCase() ?? ""}${id.slice(1)}`,
          })),
          ...(activeSidebarRegistry?.getAvailable() ?? []).map(({ id, title }) => ({
            id,
            title,
          })),
        ];
        await openStatusLineDashboard({
          pi,
          ctx,
          config: runtimeState.snapshot().config,
          discoveredStatuses: discovered,
          usageAvailable: usageRuntime.getAvailable(),
          getPreviewInput: () => currentFooterInput(ctx),
          sidebarCatalog: sidebarView.catalog,
          sidebarPanels,
          sidebarLayout: sidebarView.layout,
          save: (config, sidebarLayout) =>
            saveAndApplyConfig(config, sidebarLayout, sidebarView.catalog),
          getEffectiveSidebarWidth: () => activeSidebarController?.getEffectiveWidth(),
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
    safelyDisposeSidebarController();
    safelyDisposeSidebarRegistry();
    activeSidebarController = undefined;
    activeSidebarRegistry = undefined;
    sidebarLayoutRuntime = undefined;
    currentTodos = [];
    clearRenderSubscriptions();
    workspacePulseRuntime?.dispose();
    workspacePulseRuntime = undefined;
    resetFooterProviderState();
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
    if (ctx.mode === "tui") {
      activeSidebarRegistry = createSidebarPanelRegistry({
        events: pi.events as unknown as SidebarPanelEventTransport,
        onChange: () => {
          captureSidebarView(ctx);
          syncWorkspacePulse(runtimeState.snapshot().config);
          activeSidebarController?.requestRender();
        },
      });
      try {
        currentTodos = readCurrentTodos(ctx);
        captureSidebarView(ctx);
        activeSidebarController = createSidebarController({
          ctx,
          getView: () => captureSidebarView(ctx),
          onWarning: (message) => ctx.ui.notify(message, "warning"),
          onError: (error) =>
            ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"),
        });
        activeSidebarController.show();
      } catch (error) {
        // Spec: partway-through setup disposes the resources already created and reports one warning.
        safelyDisposeSidebarRegistry();
        activeSidebarRegistry = undefined;
        activeSidebarController = undefined;
        sidebarLayoutRuntime = undefined;
        ctx.ui.notify(
          `pi-status sidebar setup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "warning",
        );
      }
      applySurfaceVisibility(ctx, runtimeState.snapshot().config);
    }
  });

  pi.on("session_tree", (_event, ctx) => {
    const activeCtx = runtimeState.snapshot().ctx;
    if (activeCtx && activeCtx.sessionManager !== ctx.sessionManager) return;
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
    attachNotificationsForCurrentSession();
    if (ctx.mode === "tui") {
      if (activeSidebarController) {
        currentTodos = readCurrentTodos(ctx);
        captureSidebarView(ctx);
      }
      applySurfaceVisibility(ctx, runtimeState.snapshot().config);
    }
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
      activityRuntime.startTool(event.toolCallId, event.toolName, event.args, ctx.cwd);
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (isActiveTuiSession(ctx, activeTuiSessionManager)) {
      activityRuntime.finishTool(event.toolCallId, event.isError);
      workspacePulseRuntime?.scheduleRefresh();
    }
  });

  pi.on("tool_result", (event, ctx) => {
    if (
      event.toolName !== "todo" ||
      event.isError ||
      !isActiveTuiSession(ctx, activeTuiSessionManager)
    ) {
      return;
    }
    const parsed = parseTodoDetails(event.details);
    if (parsed === undefined) return;
    currentTodos = parsed;
    captureSidebarView(ctx);
    syncWorkspacePulse(runtimeState.snapshot().config);
    activeSidebarController?.requestRender();
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
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
    clearRenderSubscriptions();
    safelyDisposeSidebarController();
    safelyDisposeSidebarRegistry();
    activeSidebarController = undefined;
    activeSidebarRegistry = undefined;
    sidebarLayoutRuntime = undefined;
    currentTodos = [];
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
  });
}
