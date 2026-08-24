import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSplitPaneController, type SplitPaneController } from "./split-pane.ts";
import { renderSidebarLines, type SidebarSnapshot } from "./sidebar-render.ts";
import { createStatusLineTheme } from "./theme.ts";
import type {
  ColorSettings,
  SidebarCatalogEntry,
  SidebarEffectiveLayout,
} from "../shared/types.ts";

export interface SidebarView {
  snapshot: SidebarSnapshot;
  catalog: readonly SidebarCatalogEntry[];
  layout: SidebarEffectiveLayout;
}

export interface SidebarControllerOptions {
  ctx: ExtensionContext;
  getView(): SidebarView;
  getColors(): ColorSettings;
  shouldAnimate?(): boolean;
  animationIntervalMs?: number;
  onWarning?(message: string): void;
  onError?(error: unknown): void;
}

export interface SidebarController {
  show(): void;
  setShown(shown: boolean): void;
  isShown(): boolean;
  isSupported(): boolean;
  isEffectivelyVisible(): boolean;
  beginResize(): boolean;
  getEffectiveWidth(): number;
  requestRender(): void;
  dispose(): void;
}

const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport");

const supportsSidebar = (tui: TUI | undefined): boolean =>
  tui !== undefined && (tui as unknown as Record<symbol, unknown>)[VIEWPORT_TUI] !== true;

export function createSidebarController(options: SidebarControllerOptions): SidebarController {
  const split: SplitPaneController = createSplitPaneController({
    ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    subscribeInput: (handler) => options.ctx.ui.onTerminalInput(handler),
    onResizeChange: () => {
      safely(() => requestOverlayRender?.());
      safely(() => split.requestRender());
    },
  });
  let mounted = false;
  let shown = false;
  let disposed = false;
  let generation = 0;
  let overlayHandle: OverlayHandle | undefined;
  let requestOverlayRender: (() => void) | undefined;
  let animationTimer: ReturnType<typeof setInterval> | undefined;
  let capturedTui: TUI | undefined;

  const safely = (action: () => unknown) => {
    try {
      action();
    } catch (error) {
      try {
        options.onError?.(error);
      } catch {}
    }
  };

  const stopAnimation = () => {
    if (!animationTimer) return;
    clearInterval(animationTimer);
    animationTimer = undefined;
  };

  const syncAnimation = () => {
    if (!shown || options.shouldAnimate?.() !== true || !requestOverlayRender) {
      stopAnimation();
      return;
    }
    if (animationTimer) return;
    const intervalMs = Math.max(1, Math.trunc(options.animationIntervalMs ?? 1_000));
    animationTimer = setInterval(() => safely(() => requestOverlayRender?.()), intervalMs);
    animationTimer.unref?.();
  };

  const show = () => {
    if (disposed || mounted) return;
    mounted = true;
    shown = true;
    const currentGeneration = ++generation;
    try {
      const pending = options.ctx.ui.custom<void>(
        (tui, theme) => {
          capturedTui = tui;
          requestOverlayRender = () => tui.requestRender?.();

          const renderSidebar = (width: number, height: number): string[] => {
            try {
              const view = options.getView();
              const statusTheme = createStatusLineTheme(theme, options.getColors());
              return renderSidebarLines(
                view.snapshot,
                view.catalog,
                view.layout,
                statusTheme,
                width,
                height,
                { resizing: split.isResizing() },
              );
            } catch (error) {
              safely(() => options.onError?.(error));
              return Array.from(
                { length: Math.max(0, Math.trunc(height)) },
                () => "Sidebar unavailable",
              );
            }
          };

          if (supportsSidebar(tui)) {
            split.attach(tui, renderSidebar);
          }

          // Lifecycle-only bridge: Pi composes no visible output from this component.
          return {
            render: () => [],
            invalidate: () => undefined,
          };
        },
        {
          overlay: true,
          overlayOptions: { visible: () => false },
          onHandle: (handle) => {
            if (generation !== currentGeneration) {
              safely(() => handle.hide());
              return;
            }
            overlayHandle = handle;
            syncAnimation();
          },
        },
      );
      void pending.catch((error: unknown) => safely(() => options.onError?.(error)));
    } catch (error) {
      safely(() => options.onError?.(error));
    }
  };

  const setShown = (value: boolean) => {
    if (disposed) return;
    if (value) {
      if (!mounted) show();
      shown = true;
      safely(() => overlayHandle?.setHidden(false));
      if (supportsSidebar(capturedTui)) safely(() => split.show());
      syncAnimation();
    } else {
      if (!shown) return;
      shown = false;
      safely(() => overlayHandle?.setHidden(true));
      safely(() => split.hide());
      stopAnimation();
    }
  };

  return {
    show,
    setShown,
    isShown: () => shown,
    isSupported: () => supportsSidebar(capturedTui),
    isEffectivelyVisible: () => {
      const terminalWidth = capturedTui?.terminal.columns ?? 0;
      return shown && supportsSidebar(capturedTui) && split.isVisibleAtWidth(terminalWidth);
    },
    beginResize: () => split.beginResize(),
    getEffectiveWidth: () => {
      const terminalWidth = capturedTui?.terminal.columns ?? 0;
      return shown && supportsSidebar(capturedTui) && split.isVisibleAtWidth(terminalWidth)
        ? split.getEffectiveWidth()
        : 0;
    },
    requestRender: () => {
      safely(() => requestOverlayRender?.());
      safely(() => split.requestRender());
      syncAnimation();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      shown = false;
      generation += 1;
      stopAnimation();
      safely(() => split.cancelResize());
      safely(() => split.hide());
      safely(() => split.dispose());
      const handle = overlayHandle;
      overlayHandle = undefined;
      requestOverlayRender = undefined;
      capturedTui = undefined;
      if (handle) safely(() => handle.hide());
    },
  };
}
