import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  Input,
  Key,
  matchesKey,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import type { PiStatusConfig, SidebarPanelId } from "../shared/types.ts";
import { renderDashboard, type DashboardDialog } from "./dashboard-render.ts";
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
  getAvailableSidebarPanels(): readonly { id: SidebarPanelId; title: string }[];
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

export class StatusLineDashboardComponent implements Component, Focusable {
  private state: DashboardState;
  private dialog: DashboardDialog | undefined;
  private closed = false;
  private _focused = false;

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

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if (this.dialog?.type === "rename") this.dialog.input.focused = value;
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
      this.dialog,
      this.options.getAvailableSidebarPanels(),
    );
    if (!this.dialog && result.offset !== this.state.navigation[this.state.activeTab].offset) {
      this.state = reduceDashboardState(this.state, {
        type: "set_offset",
        tab: this.state.activeTab,
        offset: result.offset,
      }).state;
    }
    return result.lines;
  }

  invalidate(): void {
    if (this.dialog?.type === "rename") this.dialog.input.invalidate();
  }

  handleInput(data: string): void {
    if (this.closed) return;
    if (this.dialog) return void this.handleDialogInput(data);
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
    this.clearDialog();
    this.closed = true;
    this.options.done();
  }

  dispose(): void {
    this.clearDialog();
    this.closed = true;
  }

  private dispatch(action: DashboardAction): void {
    if (this.closed) return;
    const transition = reduceDashboardState(this.state, action);
    this.state = transition.state;
    if (transition.effect) this.runEffect(transition.effect);
    if (!this.closed) this.options.tui.requestRender();
  }

  private runEffect(effect: DashboardEffect): void {
    if (effect.type === "notify") {
      try {
        this.options.ctx.ui.notify(effect.message, effect.kind);
      } catch {
        // Best-effort: ui.notify is unavailable in some test hosts and broken
        // notify implementations should never bring down the dashboard.
      }
      return;
    }
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
      this.openRenameDialog();
      return;
    }
    this.openConfirmDialog("compact");
  }

  private requestClose(): void {
    if (!isDashboardDirty(this.state)) {
      this.close();
      return;
    }
    this.openConfirmDialog("discard");
  }

  private openRenameDialog(): void {
    const input = new Input();
    input.focused = this.focused;
    input.onSubmit = (value) => {
      if (this.closed || this.dialog?.type !== "rename" || this.dialog.input !== input) return;
      if (!value.trim()) return void this.dismissDialog();
      try {
        const session = renameCurrentSession(this.options.pi, this.options.ctx, value);
        this.dispatch({ type: "replace_session", session });
        this.options.ctx.ui.notify(`Session renamed to ${session.name}`, "info");
      } catch (error) {
        this.warn(errorText(error));
      }
      this.dismissDialog();
    };
    input.onEscape = () => this.dismissDialog();
    this.dialog = { type: "rename", input };
    this.options.tui.requestRender();
  }

  private openConfirmDialog(kind: "discard" | "compact"): void {
    this.dialog = { type: "confirm", kind, selectedIndex: 0 };
    this.options.tui.requestRender();
  }

  private handleDialogInput(data: string): void {
    const dialog = this.dialog;
    if (!dialog) return;
    if (dialog.type === "rename") {
      dialog.input.handleInput(data);
      if (!this.closed && this.dialog?.type === "rename") this.options.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.dialog = { ...dialog, selectedIndex: 0 };
      this.options.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.dialog = { ...dialog, selectedIndex: 1 };
      this.options.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.escape) || printableAscii(data) === "q") {
      this.dismissDialog();
      return;
    }
    if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
      if (dialog.selectedIndex === 0) {
        this.dismissDialog();
      } else if (dialog.kind === "discard") {
        this.close();
      } else {
        this.close();
        try {
          startSessionCompaction(this.options.ctx);
        } catch (error) {
          this.warn(errorText(error));
        }
      }
    }
  }

  private dismissDialog(): void {
    this.clearDialog();
    if (!this.closed) this.options.tui.requestRender();
  }

  private clearDialog(): void {
    if (this.dialog?.type === "rename") this.dialog.input.focused = false;
    this.dialog = undefined;
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
  await options.ctx.ui.custom<void>(
    (tui, piTheme, _keys, done) => {
      const component = new StatusLineDashboardComponent({
        ...options,
        tui,
        theme: noColorRequested() ? noTheme : fromPiTheme(piTheme),
        done,
      });
      options.onComponent?.(component);
      return component;
    },
    {
      overlay: true,
      overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
    },
  );
}
