import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  Key,
  matchesKey,
  type Component,
  type OverlayHandle,
  type TUI,
} from "@earendil-works/pi-tui";
import type { PiStatusConfig } from "../shared/types.ts";
import { renderDashboard } from "./dashboard-render.ts";
import {
  initDashboardState,
  reduceDashboardState,
  type DashboardAction,
  type DashboardEffect,
  type DashboardState,
  isDashboardDirty,
} from "./dashboard-state.ts";
import type { FooterRenderInput } from "./render.ts";
import {
  readSessionDetails,
  renameCurrentSession,
  startSessionCompaction,
  type SessionDetails,
} from "./session-actions.ts";
import { fromPiTheme, noColorRequested, noTheme, type StatusLineTheme } from "./theme.ts";
import { readToolSnapshot, toggleLiveTool, type DashboardTool } from "./tool-controls.ts";

export interface StatusLineDashboardOptions {
  pi: ExtensionAPI;
  ctx: ExtensionCommandContext;
  tui: TUI;
  theme: StatusLineTheme;
  config: PiStatusConfig;
  discoveredStatuses: string[];
  usageAvailable: boolean;
  getPreviewInput(): Omit<FooterRenderInput, "zones" | "extensionSegments">;
  save(config: PiStatusConfig): void;
  done(): void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printableAscii(data: string): string | undefined {
  const value = decodeKittyPrintable(data) ?? data;
  return /^[\x20-\x7e]$/.test(value) ? value : undefined;
}

function isSearchable(state: DashboardState): boolean {
  return state.activeTab === "statuses" || state.activeTab === "tools";
}

export class StatusLineDashboardComponent implements Component {
  private state: DashboardState;
  private overlayHandle: OverlayHandle | undefined;
  private busy = false;
  private closed = false;

  constructor(private readonly options: StatusLineDashboardOptions) {
    let tools: DashboardTool[] = [];
    let session: SessionDetails | undefined;
    try {
      tools = readToolSnapshot(options.pi);
    } catch (error) {
      this.warn(`Could not load Pi tools: ${errorText(error)}`);
    }
    try {
      session = readSessionDetails(options.pi, options.ctx);
    } catch (error) {
      this.warn(`Could not load session details: ${errorText(error)}`);
    }
    this.state = initDashboardState(
      options.config,
      options.discoveredStatuses,
      options.usageAvailable,
      { tools, session },
    );
  }

  setOverlayHandle(handle: OverlayHandle): void {
    this.overlayHandle = handle;
  }

  getState(): Readonly<DashboardState> {
    return this.state;
  }

  render(width: number): string[] {
    const result = renderDashboard(
      this.state,
      this.options.getPreviewInput(),
      this.options.theme,
      width,
      this.options.tui.terminal.rows,
    );
    if (result.offset !== this.state.navigation[this.state.activeTab].offset) {
      this.state = reduceDashboardState(this.state, {
        type: "set_offset",
        tab: this.state.activeTab,
        offset: result.offset,
      }).state;
    }
    return result.lines;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.busy || this.closed) return;
    const printable = printableAscii(data);

    if (matchesKey(data, "shift+tab")) return void this.dispatch({ type: "previous_tab" });
    if (matchesKey(data, Key.tab)) return void this.dispatch({ type: "next_tab" });
    if (matchesKey(data, Key.escape)) {
      if (isSearchable(this.state) && this.state.navigation[this.state.activeTab].query) {
        return void this.dispatch({ type: "clear_query" });
      }
      return void this.requestClose();
    }
    if (printable === "q") {
      if (isSearchable(this.state)) {
        return void this.dispatch({ type: "type_char", char: printable });
      }
      return void this.requestClose();
    }
    if (matchesKey(data, Key.up)) return void this.dispatch({ type: "move", delta: -1 });
    if (matchesKey(data, Key.down)) return void this.dispatch({ type: "move", delta: 1 });
    if (matchesKey(data, Key.left)) return void this.dispatch({ type: "adjust", delta: -1 });
    if (matchesKey(data, Key.right)) return void this.dispatch({ type: "adjust", delta: 1 });
    if (matchesKey(data, Key.backspace)) return void this.dispatch({ type: "backspace" });
    if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
      return void this.dispatch({ type: "activate" });
    }
    if (printable && isSearchable(this.state)) {
      this.dispatch({ type: "type_char", char: printable });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.options.done();
  }

  dispose(): void {
    this.closed = true;
    this.overlayHandle = undefined;
  }

  private dispatch(action: DashboardAction): void {
    if (this.closed) return;
    const transition = reduceDashboardState(this.state, action);
    this.state = transition.state;
    if (transition.effect) this.runEffect(transition.effect);
    if (!this.closed) this.options.tui.requestRender();
  }

  private runEffect(effect: DashboardEffect): void {
    if (effect.type === "save") {
      try {
        this.options.save(effect.config);
        this.dispatch({ type: "saved", config: effect.config });
      } catch {
        this.warn("Failed to save statusline config");
      }
      return;
    }
    if (effect.type === "toggle_tool") {
      try {
        const result = toggleLiveTool(this.options.pi, effect.name, effect.enabled);
        if (result.type === "reject-last-active") {
          this.warn("At least one tool must remain active");
        } else {
          this.dispatch({ type: "replace_tools", tools: result.tools });
        }
      } catch (error) {
        this.warn(`Could not update Pi tools: ${errorText(error)}`);
      }
      return;
    }
    if (effect.type === "rename_session") {
      void this.renameSession();
      return;
    }
    void this.compactSession();
  }

  private requestClose(): void {
    if (!isDashboardDirty(this.state)) {
      this.close();
      return;
    }
    void this.withDialog(async () => {
      const confirmed = await this.options.ctx.ui.confirm(
        "Discard unsaved changes?",
        "Unsaved Layout, Statuses, or Settings changes will be lost.",
      );
      if (this.closed) return;
      if (confirmed) this.close();
    });
  }

  private async renameSession(): Promise<void> {
    await this.withDialog(async () => {
      const input = await this.options.ctx.ui.input("Rename session", "Session name");
      if (this.closed) return;
      if (!input?.trim()) return;
      const session = renameCurrentSession(this.options.pi, this.options.ctx, input);
      this.dispatch({ type: "replace_session", session });
      this.options.ctx.ui.notify(`Session renamed to ${session.name}`, "info");
    });
  }

  private async compactSession(): Promise<void> {
    await this.withDialog(async () => {
      const session = this.state.session;
      if (!session) return;
      const confirmed = await this.options.ctx.ui.confirm(
        "Compact session?",
        `Pi will summarize older context for session ${session.id}. Continue?`,
      );
      if (this.closed) return;
      if (!confirmed) return;
      this.close();
      startSessionCompaction(this.options.ctx);
    });
  }

  private async withDialog(action: () => Promise<void>): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      this.warn(errorText(error));
    } finally {
      this.busy = false;
      if (!this.closed) {
        this.overlayHandle?.focus();
        this.options.tui.requestRender();
      }
    }
  }

  private warn(message: string): void {
    try {
      this.options.ctx.ui.notify(message, "warning");
    } catch {}
  }
}

export async function openStatusLineDashboard(
  options: Omit<StatusLineDashboardOptions, "tui" | "theme" | "done"> & {
    onComponent?(component: StatusLineDashboardComponent): void;
  },
): Promise<void> {
  let component: StatusLineDashboardComponent | undefined;
  let handle: OverlayHandle | undefined;
  await options.ctx.ui.custom<void>(
    (tui, piTheme, _keys, done) => {
      component = new StatusLineDashboardComponent({
        ...options,
        tui,
        theme: noColorRequested() ? noTheme : fromPiTheme(piTheme),
        done,
      });
      if (handle) component.setOverlayHandle(handle);
      options.onComponent?.(component);
      return component;
    },
    {
      overlay: true,
      overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
      onHandle(next) {
        handle = next;
        component?.setOverlayHandle(next);
      },
    },
  );
}
