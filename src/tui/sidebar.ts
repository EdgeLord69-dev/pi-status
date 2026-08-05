import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSplitPaneController, type SplitPaneController } from "./split-pane.ts";
import { renderSidebarLines, type SidebarSnapshot } from "./sidebar-render.ts";
import type { PiStatusConfig } from "../shared/types.ts";

export interface SidebarControllerOptions {
	ctx: ExtensionContext;
	getSnapshot(): SidebarSnapshot;
	getConfig(): PiStatusConfig;
	colorEnabled?: boolean;
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
	isResizing(): boolean;
	getWidth(): number;
	requestRender(): void;
	dispose(): void;
}

export function createSidebarController(options: SidebarControllerOptions): SidebarController {
	const split: SplitPaneController = createSplitPaneController({
		...(options.onWarning ? { onWarning: options.onWarning } : {}),
		...(options.onError ? { onError: options.onError } : {}),
	});
	let mounted = false;
	let shown = false;
	let disposed = false;
	let generation = 0;
	let overlayHandle: OverlayHandle | undefined;
	let requestOverlayRender: (() => void) | undefined;
	let animationTimer: ReturnType<typeof setInterval> | undefined;
	let capturedTui: TUI | undefined;
	let currentColumns = 0;

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
		if (!shown || options.shouldAnimate?.() !== true) {
			stopAnimation();
			return;
		}
		if (animationTimer) return;
		const intervalMs = Math.max(1, Math.trunc(options.animationIntervalMs ?? 1_000));
		animationTimer = setInterval(() => safely(() => requestOverlayRender?.()), intervalMs);
		animationTimer.unref?.();
	};

	const refreshColumns = () => {
		if (capturedTui) currentColumns = capturedTui.terminal.columns;
	};

	const show = () => {
		if (disposed || mounted) return;
		mounted = true;
		shown = true;
		const currentGeneration = ++generation;
		try {
			const pending = options.ctx.ui.custom<void>(
				(tui) => {
					split.attach(tui);
					capturedTui = tui;
					currentColumns = tui.terminal.columns;
					requestOverlayRender = () => tui.requestRender?.();
					return {
						render(width: number) {
							currentColumns = tui.terminal.columns;
							try {
								return renderSidebarLines(
									options.getSnapshot(),
									options.getConfig(),
									{} as never,
									width,
									tui.terminal.rows,
									{
										...(options.colorEnabled === undefined
											? {}
											: { colorEnabled: options.colorEnabled }),
										resizing: split.isResizing(),
									},
								);
							} catch (error) {
								safely(() => options.onError?.(error));
								return Array.from({ length: tui.terminal.rows }, () => "Sidebar unavailable");
							}
						},
						invalidate: () => undefined,
					};
				},
				{
					overlay: true,
					overlayOptions: () => split.overlayOptions(),
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
			safely(() => split.show());
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
		isSupported: () => {
			if (!capturedTui) return false;
			return (capturedTui as unknown as Record<symbol, unknown>)[
				Symbol.for("@earendil-works/pi-tui/viewport")
			] !== true;
		},
		isEffectivelyVisible: () => {
			refreshColumns();
			return shown && split.isVisibleAtWidth(currentColumns);
		},
		beginResize: () => split.beginResize(),
		isResizing: () => split.isResizing(),
		getWidth: () => split.getSidebarWidth(),
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