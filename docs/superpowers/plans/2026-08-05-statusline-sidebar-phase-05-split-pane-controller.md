# Statusline Sidebar Phase 5: Split Pane and Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock one pure sidebar component beside Pi's public TUI without capturing editor input or touching fullscreen private state.

**Architecture:** Port Atelier's split-pane controller verbatim from `michaelmjhhhh-pi-atelier/src/split-pane.ts` at `d78f1d1`. Build a sidebar controller that mounts one non-capturing overlay via `ctx.ui.custom({overlay:true, overlayOptions, onHandle})`, retains the resulting `OverlayHandle`, and toggles visibility through `handle.setHidden(true|false)` without re-creating the overlay on each toggle.

**Tech Stack:** TypeScript 6, Pi 0.83 public `TUI`/`OverlayHandle`/`OverlayOptions`/`isViewportTUI`, Vitest 4.

**Authority:**
- Atelier reference: `/Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier` at `d78f1d113814af4eee6deb9f4418f96cf50c66fa`.
- Pi reference: `/Users/lanh/Developer/pi-packages/pi` at `583f153d502aa8e958eefdb9af0fbd3344e68f95`.
- Phase 4 renderer lives at `src/tui/sidebar-render.ts`; the controller in this plan reads its `SidebarSnapshot` / `renderSidebarLines` exports.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/tui/split-pane.ts` | Width reservation, render wrapper, resize input handling. Verbatim port of Atelier's split-pane. |
| `tests/tui/split-pane.test.ts` | Split-pane behavior tests. Adapted from Atelier's test file with pi-status import paths. |
| `src/tui/sidebar.ts` | Sidebar controller: overlay mount lifecycle, `setShown` toggling, animation gating, fullscreen gating. |
| `tests/tui/sidebar.test.ts` | Controller tests with a host-realistic fake TUI capturing `ctx.ui.custom()` calls. |

Both modules are leaves; they depend only on `@earendil-works/pi-tui` (public API), the existing renderer in `src/tui/sidebar-render.ts`, and `src/shared/types.ts`. No new runtime dependencies.

---

## Task 1: Implement split pane (verbatim Atelier port)

**Files:** Create `src/tui/split-pane.ts`; create `tests/tui/split-pane.test.ts`.

The split-pane module is a verbatim port of `michaelmjhhhh-pi-atelier/src/split-pane.ts` (Atelier `d78f1d1`). Constants, SGR parser, render wrapper, resize mode, and disposal are byte-identical in behavior. The only changes are the import path for `OverlayOptions`/`TUI` (Atelier uses `.js`, we use the public package re-export at index) and the file extension.

### Step 1: Add constants and SGR parser

Write `src/tui/split-pane.ts` with the four width constants, the mouse enable/disable sequences, the SGR regex, the `parseSgrMouseEvent` function, and a `clamp`/`finiteInteger` placeholder helper. No controller yet.

```ts
import { matchesKey } from "@earendil-works/pi-tui";
import type { OverlayOptions, TUI } from "@earendil-works/pi-tui";

const ENABLE_MOUSE = "[?1002h[?1006h";
const DISABLE_MOUSE = "[?1006l[?1002l";
const SGR_MOUSE = /^\[<(\d+);(\d+);(\d+)([Mm])$/;

export interface SgrMouseEvent {
	button: number;
	x: number;
	y: number;
	release: boolean;
	motion: boolean;
}

export function parseSgrMouseEvent(data: string): SgrMouseEvent | undefined {
	const match = data.match(SGR_MOUSE);
	if (!match) return undefined;
	const button = Number(match[1]);
	const x = Number(match[2]);
	const y = Number(match[3]);
	if (![button, x, y].every(Number.isFinite) || x < 1 || y < 1) return undefined;
	return { button, x, y, release: match[4] === "m", motion: (button & 32) !== 0 };
}

export const DEFAULT_SIDEBAR_WIDTH = 44;
export const MIN_SIDEBAR_WIDTH = 28;
export const MAX_SIDEBAR_WIDTH = 72;
export const MIN_MAIN_WIDTH = 64;

const finiteInteger = (value: number, fallback: number): number =>
	Number.isFinite(value) ? Math.trunc(value) : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.min(maximum, Math.max(minimum, value));
```

### Step 2: Write failing tests for constants and SGR parser

Create `tests/tui/split-pane.test.ts` with the harness helper and the two describe blocks for SGR parsing.

```ts
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SIDEBAR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_MAIN_WIDTH,
	MIN_SIDEBAR_WIDTH,
	createSplitPaneController,
	parseSgrMouseEvent,
} from "../src/tui/split-pane.ts";

function harness(columns = 120) {
	const baseRender = vi.fn((width: number) => [`base:${width}`]);
	const requestRender = vi.fn();
	const write = vi.fn();
	const tui = {
		render: baseRender,
		requestRender,
		terminal: { columns, rows: 36, write },
	} as unknown as TUI;
	return { tui, baseRender, requestRender, write };
}

const press = (x: number, y = 4) => `[<0;${x};${y}M`;
const motion = (x: number, y = 4) => `[<32;${x};${y}M`;
const release = (x: number, y = 4) => `[<0;${x};${y}m`;
const mousePress = (button: number, x: number, y = 4) => `[<${button};${x};${y}M`;

function resizeHarness(columns = 120) {
	const h = harness(columns);
	let input: ((data: string) => { consume?: boolean; data?: string } | undefined) | undefined;
	const unsubscribe = vi.fn();
	const onResizeChange = vi.fn();
	const split = createSplitPaneController({
		subscribeInput(handler) {
			input = handler;
			return unsubscribe;
		},
		onResizeChange,
	});
	split.attach(h.tui);
	split.show();
	return { ...h, split, unsubscribe, onResizeChange, send: (data: string) => input?.(data) };
}

describe("SGR mouse parsing", () => {
	it("parses press, held motion, and release coordinates", () => {
		expect(parseSgrMouseEvent(press(77))).toEqual({ button: 0, x: 77, y: 4, release: false, motion: false });
		expect(parseSgrMouseEvent(motion(70))).toMatchObject({ x: 70, motion: true, release: false });
		expect(parseSgrMouseEvent(release(70))).toMatchObject({ x: 70, motion: false, release: true });
	});
	it.each(["", "left", "[<x;1;1M", "[<0;0;1M"])("rejects malformed input: %j", (data) =>
		expect(parseSgrMouseEvent(data)).toBeUndefined(),
	);
});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: FAIL with `createSplitPaneController is not a function` (and the SGR parser tests pass on their own).

### Step 3: Implement `createSplitPaneController` skeleton (attach, show, hide, width clamping)

Append the controller factory. At this step the controller only knows `attach`, `show`, `hide`, `isEnabled`, `isVisibleAtWidth`, `setSidebarWidth`, `getSidebarWidth`, `overlayOptions`, `requestRender`, `dispose`. Resize mode lands in step 5.

```ts
export interface SplitPaneControllerOptions {
	defaultSidebarWidth?: number;
	minSidebarWidth?: number;
	maxSidebarWidth?: number;
	minMainWidth?: number;
	onError?(error: unknown): void;
	subscribeInput?(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
	onResizeChange?(resizing: boolean): void;
	onWarning?(message: string): void;
}

export interface SplitPaneController {
	attach(tui: TUI): void;
	show(): void;
	hide(): void;
	setSidebarWidth(width: number): void;
	getSidebarWidth(): number;
	isEnabled(): boolean;
	isVisibleAtWidth(terminalWidth: number): boolean;
	beginResize(): boolean;
	finishResize(): void;
	cancelResize(): void;
	isResizing(): boolean;
	overlayOptions(): OverlayOptions;
	requestRender(): void;
	dispose(): void;
}

type RenderFunction = TUI["render"];

export function createSplitPaneController(options: SplitPaneControllerOptions = {}): SplitPaneController {
	const minimumSidebar = Math.max(
		1,
		finiteInteger(options.minSidebarWidth ?? MIN_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH),
	);
	const maximumSidebar = Math.max(
		minimumSidebar,
		finiteInteger(options.maxSidebarWidth ?? MAX_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
	);
	const minimumMain = Math.max(1, finiteInteger(options.minMainWidth ?? MIN_MAIN_WIDTH, MIN_MAIN_WIDTH));
	let sidebarWidth = clamp(
		finiteInteger(options.defaultSidebarWidth ?? DEFAULT_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH),
		minimumSidebar,
		maximumSidebar,
	);
	let tui: TUI | undefined;
	let originalRender: RenderFunction | undefined;
	let wrappedRender: RenderFunction | undefined;
	let enabled = false;
	let disposed = false;

	const safely = (action: () => unknown) => {
		try {
			const result = action();
			if (result && typeof (result as PromiseLike<unknown>).then === "function") {
				void Promise.resolve(result).catch(() => undefined);
			}
		} catch {
			// Cleanup and error reporting are best effort; continue with remaining actions.
		}
	};

	const visibleAt = (terminalWidth: number): boolean =>
		enabled && Number.isFinite(terminalWidth) && terminalWidth >= minimumMain + minimumSidebar;

	const effectiveSidebarWidth = (terminalWidth: number): number => {
		if (!visibleAt(terminalWidth)) return 0;
		return clamp(sidebarWidth, minimumSidebar, Math.min(maximumSidebar, terminalWidth - minimumMain));
	};

	const overlayLayout: OverlayOptions = {
		anchor: "top-right",
		width: sidebarWidth,
		maxHeight: "100%",
		margin: 0,
		nonCapturing: true,
		visible: (terminalWidth) => visibleAt(terminalWidth),
	};

	const syncOverlayWidth = (terminalWidth = tui?.terminal.columns) => {
		const effectiveWidth = terminalWidth === undefined ? 0 : effectiveSidebarWidth(terminalWidth);
		overlayLayout.width = effectiveWidth > 0 ? effectiveWidth : sidebarWidth;
	};

	const requestRender = () => tui?.requestRender();

	const attach = (nextTui: TUI) => {
		if (disposed) throw new Error("Cannot attach a disposed split pane");
		if (tui === nextTui) return;
		if (tui) throw new Error("Split pane is already attached to another TUI");
		tui = nextTui;
		originalRender = nextTui.render;
		const previousRender = nextTui.render;
		wrappedRender = function (this: TUI, terminalWidth: number): string[] {
			const reserved = effectiveSidebarWidth(terminalWidth);
			syncOverlayWidth(terminalWidth);
			try {
				return previousRender.call(nextTui, terminalWidth - reserved);
			} catch (error) {
				enabled = false;
				safely(() => options.onError?.(error));
				return previousRender.call(nextTui, terminalWidth);
			}
		};
		nextTui.render = wrappedRender;
		requestRender();
	};

	return {
		attach,
		show() {
			if (disposed || enabled) return;
			enabled = true;
			syncOverlayWidth();
			requestRender();
		},
		hide() {
			if (!enabled) return;
			enabled = false;
			requestRender();
		},
		setSidebarWidth(width) {
			const next = clamp(finiteInteger(width, sidebarWidth), minimumSidebar, maximumSidebar);
			if (next === sidebarWidth) return;
			sidebarWidth = next;
			syncOverlayWidth();
			requestRender();
		},
		getSidebarWidth: () => sidebarWidth,
		beginResize: () => false,
		finishResize: () => undefined,
		cancelResize: () => undefined,
		isResizing: () => false,
		isEnabled: () => enabled,
		isVisibleAtWidth: visibleAt,
		overlayOptions: () => overlayLayout,
		requestRender,
		dispose() {
			if (disposed) return;
			disposed = true;
			enabled = false;
			if (tui && originalRender && tui.render === wrappedRender) tui.render = originalRender;
			tui?.requestRender();
			tui = undefined;
			originalRender = undefined;
			wrappedRender = undefined;
		},
	};
}
```

Note: `beginResize`/`finishResize`/`cancelResize`/`isResizing` are stubs at this step; step 5 wires them. Resize-mode tests are deferred to that step.

### Step 4: Add width-reservation tests and run

Append the following describe block to `tests/tui/split-pane.test.ts`:

```ts
describe("split pane width reservation", () => {
	it("reserves the default sidebar width without changing overlay coordinates", () => {
		const h = harness(120);
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();

		expect(h.tui.render(120)).toEqual(["base:76"]);
		expect(h.baseRender).toHaveBeenLastCalledWith(120 - DEFAULT_SIDEBAR_WIDTH);
		expect(split.overlayOptions()).toMatchObject({
			anchor: "top-right",
			width: 44,
			maxHeight: "100%",
			margin: 0,
			nonCapturing: true,
		});
	});

	it("keeps one overlay options object and updates its width with the split", () => {
		const h = harness(120);
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();
		const retainedOptions = split.overlayOptions();

		split.setSidebarWidth(36);

		expect(split.overlayOptions()).toBe(retainedOptions);
		expect(retainedOptions.width).toBe(36);
		expect(h.tui.render(120)).toEqual(["base:84"]);
	});

	it("uses full width when hidden or too narrow and restores on widen", () => {
		const h = harness(120);
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();

		expect(h.tui.render(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1)).toEqual(["base:91"]);
		expect(split.isVisibleAtWidth(91)).toBe(false);
		expect(h.tui.render(120)).toEqual(["base:76"]);

		split.hide();
		expect(h.tui.render(120)).toEqual(["base:120"]);
	});

	it("shows the pane at the exact minimum terminal width", () => {
		const h = harness();
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();

		expect(split.isVisibleAtWidth(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH)).toBe(true);
		expect(h.tui.render(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH)).toEqual(["base:64"]);
	});

	it("passes zero and negative widths through unchanged", () => {
		const h = harness();
		const split = createSplitPaneController();
		split.attach(h.tui);

		expect(h.tui.render(0)).toEqual(["base:0"]);
		expect(h.tui.render(-5)).toEqual(["base:-5"]);
	});

	it("clamps configured and runtime widths while preserving the main pane", () => {
		const h = harness(100);
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();

		split.setSidebarWidth(999);
		expect(split.getSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH);
		expect(h.tui.render(100)).toEqual([`base:${MIN_MAIN_WIDTH}`]);
		expect(split.overlayOptions()).toMatchObject({ width: 36 });

		split.setSidebarWidth(Number.NaN);
		expect(split.getSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH);

		split.setSidebarWidth(-10);
		expect(split.getSidebarWidth()).toBe(MIN_SIDEBAR_WIDTH);
		expect(h.tui.render(100)).toEqual(["base:72"]);
	});
});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: PASS. The SGR parser and width-reservation tests all green.

### Step 5: Add render-lifecycle tests and verify they pass

Append the following describe block to `tests/tui/split-pane.test.ts`:

```ts
describe("split pane render lifecycle", () => {
	it("attaches once and restores the exact original method on dispose", () => {
		const h = harness();
		const original = h.tui.render;
		const split = createSplitPaneController();

		split.attach(h.tui);
		const wrapped = h.tui.render;
		split.attach(h.tui);
		expect(h.tui.render).toBe(wrapped);

		split.dispose();
		expect(h.tui.render).toBe(original);
		split.dispose();
		expect(h.tui.render).toBe(original);
	});

	it("does not overwrite a renderer installed later by another extension", () => {
		const h = harness();
		const split = createSplitPaneController();
		split.attach(h.tui);
		const atelierWrapper = h.tui.render;
		const laterWrapper = vi.fn((width: number) => atelierWrapper.call(h.tui, width));
		h.tui.render = laterWrapper;

		split.dispose();

		expect(h.tui.render).toBe(laterWrapper);
		expect(h.tui.render(120)).toEqual(["base:120"]);
	});

	it("calls onError, disables the split, and retries the prior renderer full-width", () => {
		const error = new Error("render failed");
		const onError = vi.fn();
		const baseRender = vi
			.fn()
			.mockImplementationOnce(() => {
				throw error;
			})
			.mockImplementation((width: number) => [`base:${width}`]);
		const requestRender = vi.fn();
		const tui = {
			render: baseRender,
			requestRender,
			terminal: { columns: 120, rows: 36, write: vi.fn() },
		} as unknown as TUI;
		const split = createSplitPaneController({ onError });
		split.attach(tui);
		split.show();

		expect(tui.render(120)).toEqual(["base:120"]);
		expect(onError).toHaveBeenCalledWith(error);
		expect(split.isEnabled()).toBe(false);
		expect(baseRender.mock.calls).toEqual([[76], [120]]);
	});

	it("keeps show, hide, width updates, and requests idempotent", () => {
		const h = harness();
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();
		split.show();
		split.setSidebarWidth(44);
		split.requestRender();
		split.hide();
		split.hide();

		expect(split.isEnabled()).toBe(false);
		expect(h.tui.render(120)).toEqual(["base:120"]);
		expect(h.requestRender.mock.calls.length).toBeGreaterThan(0);
	});
});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: PASS.

### Step 6: Implement resize mode (beginResize, finishResize, cancelResize, key/mouse handling)

Replace the stubs in `createSplitPaneController` and add the resize state and `handleResizeInput` function. The implementation mirrors `atelier/src/split-pane.ts:87-143,179-225,249-300`.

```ts
// Inside createSplitPaneController, after attach, add resize state:
let resizing = false;
let resizeStartWidth = sidebarWidth;
let dragging = false;
let unsubscribeInput: (() => void) | undefined;
let mouseReportingEnabled = false;
let controller: SplitPaneController;

// Replace the stubs with the real implementations, and add handleResizeInput.
const stopResize = (restore: boolean) => {
	if (!resizing && !mouseReportingEnabled && !unsubscribeInput) return;
	if (restore) sidebarWidth = resizeStartWidth;
	syncOverlayWidth();
	const shouldDisableMouse = mouseReportingEnabled;
	const unsubscribe = unsubscribeInput;
	dragging = false;
	resizing = false;
	mouseReportingEnabled = false;
	unsubscribeInput = undefined;
	if (shouldDisableMouse) safely(() => tui?.terminal.write(DISABLE_MOUSE));
	if (unsubscribe) safely(unsubscribe);
	safely(() => options.onResizeChange?.(false));
	safely(requestRender);
};

const reconcileResizeWidth = (terminalWidth: number) => {
	if (!resizing) return;
	if (!visibleAt(terminalWidth)) {
		stopResize(true);
		return;
	}
	const effectiveMax = Math.min(maximumSidebar, terminalWidth - minimumMain);
	sidebarWidth = clamp(sidebarWidth, minimumSidebar, Math.max(minimumSidebar, effectiveMax));
};

const handleResizeInput = (data: string): { consume?: boolean; data?: string } | undefined => {
	const mouse = parseSgrMouseEvent(data);
	if (mouse) {
		if (mouse.release) {
			if (dragging) stopResize(false);
			return { consume: true };
		}
		if (!mouse.motion && (mouse.button & 3) === 0 && (mouse.button & 64) === 0) {
			const dividerX = (tui?.terminal.columns ?? 0) - sidebarWidth + 1;
			if (Math.abs(mouse.x - dividerX) <= 1) dragging = true;
			return { consume: true };
		}
		if (mouse.motion && dragging && tui) {
			const proposed = tui.terminal.columns - mouse.x + 1;
			const effectiveMax = Math.min(maximumSidebar, tui.terminal.columns - minimumMain);
			sidebarWidth = clamp(proposed, minimumSidebar, Math.max(minimumSidebar, effectiveMax));
			syncOverlayWidth();
			requestRender();
		}
		return { consume: true };
	}
	if (matchesKey(data, "shift+left")) {
		controller.setSidebarWidth(sidebarWidth + 4);
		return { consume: true };
	}
	if (matchesKey(data, "shift+right")) {
		controller.setSidebarWidth(sidebarWidth - 4);
		return { consume: true };
	}
	if (matchesKey(data, "left")) {
		controller.setSidebarWidth(sidebarWidth + 1);
		return { consume: true };
	}
	if (matchesKey(data, "right")) {
		controller.setSidebarWidth(sidebarWidth - 1);
		return { consume: true };
	}
	if (matchesKey(data, "enter")) {
		stopResize(false);
		return { consume: true };
	}
	if (matchesKey(data, "escape")) {
		stopResize(true);
		return { consume: true };
	}
	return undefined;
};

controller = {
	attach,
	show() {
		if (disposed || enabled) return;
		enabled = true;
		syncOverlayWidth();
		requestRender();
	},
	hide() {
		stopResize(true);
		if (!enabled) return;
		enabled = false;
		requestRender();
	},
	setSidebarWidth(width) {
		const next = clamp(finiteInteger(width, sidebarWidth), minimumSidebar, maximumSidebar);
		if (next === sidebarWidth) return;
		sidebarWidth = next;
		syncOverlayWidth();
		requestRender();
	},
	getSidebarWidth: () => sidebarWidth,
	beginResize() {
		if (resizing) return true;
		if (!tui || !enabled) {
			options.onWarning?.("Atelier sidebar is not ready to resize");
			return false;
		}
		if (!visibleAt(tui.terminal.columns)) {
			options.onWarning?.("Terminal is too narrow to resize the Atelier sidebar");
			return false;
		}
		if (!options.subscribeInput) {
			options.onWarning?.("Terminal input is unavailable for sidebar resizing");
			return false;
		}
		sidebarWidth = effectiveSidebarWidth(tui.terminal.columns);
		syncOverlayWidth();
		resizeStartWidth = sidebarWidth;
		dragging = false;
		resizing = true;
		try {
			unsubscribeInput = options.subscribeInput(handleResizeInput);
			mouseReportingEnabled = true;
			tui.terminal.write(ENABLE_MOUSE);
			options.onResizeChange?.(true);
			requestRender();
			return true;
		} catch (error) {
			stopResize(true);
			safely(() => options.onError?.(error));
			return false;
		}
	},
	finishResize: () => stopResize(false),
	cancelResize: () => stopResize(true),
	isResizing: () => resizing,
	isEnabled: () => enabled,
	isVisibleAtWidth: visibleAt,
	overlayOptions: () => overlayLayout,
	requestRender,
	dispose() {
		if (disposed) return;
		stopResize(true);
		disposed = true;
		enabled = false;
		if (tui && originalRender && tui.render === wrappedRender) tui.render = originalRender;
		tui?.requestRender();
		tui = undefined;
		originalRender = undefined;
		wrappedRender = undefined;
	},
};
return controller;
```

Important: also call `reconcileResizeWidth(terminalWidth)` at the top of the wrapped render function (before computing `reserved`). Update the wrapped render to:

```ts
wrappedRender = function (this: TUI, terminalWidth: number): string[] {
	reconcileResizeWidth(terminalWidth);
	const reserved = effectiveSidebarWidth(terminalWidth);
	syncOverlayWidth(terminalWidth);
	try {
		return previousRender.call(nextTui, terminalWidth - reserved);
	} catch (error) {
		stopResize(true);
		enabled = false;
		safely(() => options.onError?.(error));
		return previousRender.call(nextTui, terminalWidth);
	}
};
```

### Step 7: Add resize-mode tests and verify they pass

Append the following describe block to `tests/tui/split-pane.test.ts`:

```ts
describe("temporary Resize mode", () => {
	it("enables mouse reporting only during Resize mode", () => {
		const h = resizeHarness();
		expect(h.write).not.toHaveBeenCalled();
		expect(h.split.beginResize()).toBe(true);
		expect(h.write).toHaveBeenCalledWith("[?1002h[?1006h");
		expect(h.split.isResizing()).toBe(true);
		h.split.finishResize();
		expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		expect(h.split.isResizing()).toBe(false);
	});

	it("drags only from the divider and accepts on release", () => {
		const h = resizeHarness();
		h.split.beginResize();
		const dividerX = 120 - DEFAULT_SIDEBAR_WIDTH + 1;
		expect(h.send(press(dividerX))).toEqual({ consume: true });
		expect(h.send(motion(70))).toEqual({ consume: true });
		expect(h.split.getSidebarWidth()).toBe(51);
		expect(h.send(release(70))).toEqual({ consume: true });
		expect(h.split.isResizing()).toBe(false);
		expect(h.split.getSidebarWidth()).toBe(51);
	});

	it("does not start dragging for wheel or non-primary mouse events", () => {
		const h = resizeHarness();
		h.split.beginResize();
		const dividerX = 120 - DEFAULT_SIDEBAR_WIDTH + 1;

		expect(h.send(mousePress(64, dividerX))).toEqual({ consume: true });
		expect(h.send(motion(70))).toEqual({ consume: true });
		expect(h.split.getSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);

		expect(h.send(mousePress(1, dividerX))).toEqual({ consume: true });
		expect(h.send(motion(70))).toEqual({ consume: true });
		expect(h.split.getSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
	});

	it("leaves unrelated keyboard input unconsumed", () => {
		const h = resizeHarness();
		h.split.beginResize();
		expect(h.send("a")).toBeUndefined();
	});

	it("keeps Resize mode active on misses and starts dragging within one column of the divider", () => {
		const h = resizeHarness();
		h.split.beginResize();
		h.send("[C");
		expect(h.split.getSidebarWidth()).toBe(43);

		h.send(press(10));
		expect(h.split.getSidebarWidth()).toBe(43);
		expect(h.split.isResizing()).toBe(true);

		const dividerX = 120 - 43 + 1;
		h.send(press(dividerX - 1));
		h.send(motion(70));
		expect(h.split.getSidebarWidth()).toBe(51);
		h.send(release(70));
		expect(h.split.isResizing()).toBe(false);
	});

	it("supports arrows, shifted arrows, Enter, and Escape rollback", () => {
		const h = resizeHarness();
		h.split.beginResize();
		h.send("[D");
		expect(h.split.getSidebarWidth()).toBe(45);
		h.send("[1;2D");
		expect(h.split.getSidebarWidth()).toBe(49);
		h.send("");
		expect(h.split.getSidebarWidth()).toBe(44);
		h.split.beginResize();
		h.send("[C");
		h.send("\r");
		expect(h.split.getSidebarWidth()).toBe(43);
		expect(h.split.isResizing()).toBe(false);
	});

	it("refuses Resize mode when the split is hidden or not attached", () => {
		const warnings: string[] = [];
		const split = createSplitPaneController({ onWarning: (message) => warnings.push(message) });
		expect(split.beginResize()).toBe(false);
		expect(warnings.at(-1)).toContain("not ready");
		const h = harness(91);
		split.attach(h.tui);
		split.show();
		expect(split.beginResize()).toBe(false);
		expect(h.write).not.toHaveBeenCalled();
	});

	it.each(["hide", "dispose"] as const)("cleans mouse state on %s", (action) => {
		const h = resizeHarness();
		h.split.beginResize();
		h.split[action]();
		expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
		expect(h.unsubscribe).toHaveBeenCalledOnce();
	});

	it("attempts remaining cleanup when disabling mouse reporting throws", () => {
		const h = resizeHarness();
		h.write.mockImplementation((sequence: string) => {
			if (sequence === "[?1006l[?1002l") throw new Error("disable failed");
		});
		h.split.beginResize();

		expect(() => h.split.finishResize()).not.toThrow();
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		expect(h.onResizeChange).toHaveBeenLastCalledWith(false);
		expect(h.split.isResizing()).toBe(false);
	});

	it("attempts remaining cleanup when unsubscribe throws", () => {
		const h = resizeHarness();
		h.unsubscribe.mockImplementation(() => {
			throw new Error("unsubscribe failed");
		});
		h.split.beginResize();

		expect(() => h.split.finishResize()).not.toThrow();
		expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
		expect(h.onResizeChange).toHaveBeenLastCalledWith(false);
		expect(h.split.isResizing()).toBe(false);
	});

	it("cleans up before safely reporting begin errors", () => {
		const h = resizeHarness();
		const error = new Error("enable failed");
		h.write.mockImplementationOnce(() => {
			throw error;
		});
		const onError = vi.fn(() => {
			throw new Error("report failed");
		});
		const split = createSplitPaneController({
			subscribeInput: () => h.unsubscribe,
			onResizeChange: h.onResizeChange,
			onError,
		});
		split.attach(h.tui);
		split.show();

		expect(() => split.beginResize()).not.toThrow();
		expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		expect(h.onResizeChange).toHaveBeenLastCalledWith(false);
		expect(onError).toHaveBeenCalledWith(error);
		expect(split.isResizing()).toBe(false);
	});

	it("continues cleanup when onResizeChange throws", () => {
		const h = resizeHarness();
		h.onResizeChange.mockImplementation(() => {
			throw new Error("resize callback failed");
		});
		h.split.beginResize();

		expect(() => h.split.finishResize()).not.toThrow();
		expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		expect(h.split.isResizing()).toBe(false);
	});

	it("reclamps while resizing and exits safely when terminal becomes too narrow", () => {
		const h = resizeHarness();
		h.split.setSidebarWidth(72);
		h.split.beginResize();
		expect(h.split.getSidebarWidth()).toBe(56);
		(h.tui.terminal as { columns: number }).columns = 100;
		h.tui.render(100);
		expect(h.split.getSidebarWidth()).toBe(36);
		(h.tui.terminal as { columns: number }).columns = 91;
		h.tui.render(91);
		expect(h.split.isResizing()).toBe(false);
		expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
	});
});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: PASS. All split-pane tests green.

### Step 8: Verify and commit

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/split-pane.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
git add src/tui/split-pane.ts tests/tui/split-pane.test.ts
git commit -m "feat: add sidebar split pane resizing"
```

Expected: typecheck clean, diff clean, commit created.

---

## Task 2: Add sidebar controller with mount-once `setHidden` toggling

**Files:** Create `src/tui/sidebar.ts`; create `tests/tui/sidebar.test.ts`.

The controller mounts the overlay exactly once on the first `show()` call and uses `OverlayHandle.setHidden(true|false)` for visibility toggles. The `ctx.ui.custom({overlay:true, overlayOptions, onHandle})` pattern is the only viable overlay host for extensions (verified against Atelier `atelier/src/sidebar.ts:1229-1275` and pi-status's own `src/tui/dashboard.ts:296-311`). Direct `tui.showOverlay()` is not callable from outside a factory because extensions cannot retain a `tui` handle.

The controller also calls `split.attach(tui)` inside the factory so that the sidebar can install its render wrapper. `isSupported()` returns `false` when the captured `tui` is a viewport/fullscreen TUI (typed guard `isViewportTUI(tui)` from `@earendil-works/pi-tui`). `isEffectivelyVisible()` combines "shown" with the split's `isVisibleAtWidth(currentColumns)`.

### Step 1: Build the host-realistic fake and the controller shell

Create `tests/tui/sidebar.test.ts` with a fake TUI that captures `ctx.ui.custom()` arguments and exposes a mutable `OverlayHandle`. Add the `createSidebarController` export with all methods stubbed except `show` / `dispose` (which need real behavior to verify mount-once).

```ts
import { isViewportTUI } from "@earendil-works/pi-tui";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarSnapshot } from "../src/tui/sidebar-render.ts";
import type { PiStatusConfig } from "../shared/types.ts";
import { createSidebarController } from "../src/tui/sidebar.ts";

const FIXED_SNAPSHOT: SidebarSnapshot = {
	agentActivity: "ready",
	modelLabel: "gpt-5.6",
	thinkingLevel: "medium",
	projectName: "pi-status",
	persisted: false,
	branchEntryCount: 0,
	activeToolCount: 0,
	activeToolNames: [],
	availableToolCount: 0,
	runPhase: "idle",
	turnNumber: 0,
	runDurationMs: 0,
	completedToolCount: 0,
	failedToolCount: 0,
	alerts: [],
	statuses: [],
	todos: [],
	sidebarPanels: [],
};

const FIXED_CONFIG = {} as PiStatusConfig;

class FakeOverlayHandle implements OverlayHandle {
	hidden = false;
	focused = false;
	hide = vi.fn(() => {
		this.hidden = true;
	});
	setHidden = vi.fn((value: boolean) => {
		this.hidden = value;
	});
	isHidden = vi.fn(() => this.hidden);
	focus = vi.fn(() => {
		this.focused = true;
	});
	unfocus = vi.fn(() => {
		this.focused = false;
	});
	isFocused = vi.fn(() => this.focused);
}

interface FakeHost {
	terminal: { columns: number; rows: number; write: ReturnType<typeof vi.fn> };
	requestRender: ReturnType<typeof vi.fn>;
	handles: FakeOverlayHandle[];
	factories: Array<(tui: TUI, theme: unknown) => Component>;
	optionsList: OverlayOptions[];
	customInvocations: number;
}

function makeFakeHost(columns = 120): { host: FakeHost; tui: TUI } {
	const host: FakeHost = {
		terminal: { columns, rows: 36, write: vi.fn() },
		requestRender: vi.fn(),
		handles: [],
		factories: [],
		optionsList: [],
		customInvocations: 0,
	};
	const tui: TUI = {
		render: vi.fn((width: number) => [`main:${width}`]),
		requestRender: host.requestRender,
		terminal: host.terminal,
	} as unknown as TUI;
	return { host, tui };
}

function makeCtx(host: FakeHost, tui: TUI): ExtensionContext {
	const overlay = (handle: FakeOverlayHandle) => handle;
	return {
		mode: "tui",
		ui: {
			custom: vi.fn(async <T>(
				factory: (tui: TUI, theme: unknown, _keys: unknown, done: (result: T) => void) => Component,
				options?: { overlay?: boolean; overlayOptions?: OverlayOptions | (() => OverlayOptions); onHandle?: (handle: OverlayHandle) => void },
			): Promise<T> => {
				host.customInvocations += 1;
				const handle = new FakeOverlayHandle();
				host.handles.push(handle);
				if (options?.overlayOptions) {
					host.optionsList.push(
						typeof options.overlayOptions === "function" ? options.overlayOptions() : options.overlayOptions,
					);
				}
				const component = factory(tui, {}, {}, () => undefined);
				host.factories.push(() => component);
				options?.onHandle?.(overlay(handle));
				return Promise.resolve(undefined) as Promise<T>;
			}),
			onTerminalInput: vi.fn(() => () => undefined),
			notify: vi.fn(),
		},
	} as unknown as ExtensionContext;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("sidebar controller", () => {
	it("mounts exactly one overlay across repeated show() calls", async () => {
		const { host, tui } = makeFakeHost();
		const controller = createSidebarController({
			ctx: makeCtx(host, tui),
			getSnapshot: () => FIXED_SNAPSHOT,
			getConfig: () => FIXED_CONFIG,
		});
		controller.show();
		await Promise.resolve();
		controller.show();
		await Promise.resolve();
		expect(host.customInvocations).toBe(1);
		expect(host.handles.length).toBe(1);
	});
});
```

Also create `src/tui/sidebar.ts` with stub exports that satisfy the test:

```ts
import { isViewportTUI } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createSplitPaneController,
	type SplitPaneController,
} from "./split-pane.ts";
import type { SidebarSnapshot } from "./sidebar-render.ts";
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
	let disposed = false;

	return {
		show() {
			if (disposed || mounted) return;
			mounted = true;
			const pending = options.ctx.ui.custom<void>(
				(tui: TUI) => {
					split.attach(tui);
					return { render: (width: number) => [`stub:${width}`], invalidate: () => undefined };
				},
				{ overlay: true, overlayOptions: () => split.overlayOptions() },
			);
			void pending.catch(() => undefined);
		},
		setShown() {},
		isShown: () => false,
		isSupported: () => false,
		isEffectivelyVisible: () => false,
		beginResize: () => split.beginResize(),
		isResizing: () => split.isResizing(),
		getWidth: () => split.getSidebarWidth(),
		requestRender: () => split.requestRender(),
		dispose() {
			disposed = true;
			split.dispose();
		},
	};
}
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: PASS for the single mount-once test.

### Step 2: Implement `setShown`, `isShown`, `dispose` semantics

Update `createSidebarController` to retain the `OverlayHandle` returned via `onHandle` and toggle visibility with `handle.setHidden(true|false)`. `dispose()` calls `handle.hide()` exactly once.

Replace the controller body with:

```ts
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

	const show = () => {
		if (disposed || mounted) return;
		mounted = true;
		const currentGeneration = ++generation;
		try {
			const pending = options.ctx.ui.custom<void>(
				(tui) => {
					split.attach(tui);
					requestOverlayRender = () => tui.requestRender?.();
					return {
						render: (width: number) => {
							try {
								return [`stub:${width}`];
							} catch (error) {
								safely(() => options.onError?.(error));
								return ["Sidebar unavailable"];
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
			if (shown) return;
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
		isSupported: () => !isViewportTUI(undefined as unknown as TUI),
		isEffectivelyVisible: () => shown && split.isVisibleAtWidth(0),
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
			if (handle) safely(() => handle.hide());
		},
	};
}
```

### Step 3: Add `setShown` / dispose / stale-handle tests and verify

Append the following tests to the existing `describe("sidebar controller", ...)` block:

```ts
	it("toggles visibility through setHidden without remounting the overlay", async () => {
		const { host, tui } = makeFakeHost();
		const controller = createSidebarController({
			ctx: makeCtx(host, tui),
			getSnapshot: () => FIXED_SNAPSHOT,
			getConfig: () => FIXED_CONFIG,
		});
		controller.show();
		await Promise.resolve();
		const handle = host.handles[0]!;
		controller.setShown(false);
		expect(handle.setHidden).toHaveBeenLastCalledWith(true);
		controller.setShown(true);
		expect(handle.setHidden).toHaveBeenLastCalledWith(false);
		expect(host.customInvocations).toBe(1);
	});

	it("dispose() hides the overlay exactly once and is idempotent", async () => {
		const { host, tui } = makeFakeHost();
		const controller = createSidebarController({
			ctx: makeCtx(host, tui),
			getSnapshot: () => FIXED_SNAPSHOT,
			getConfig: () => FIXED_CONFIG,
		});
		controller.show();
		await Promise.resolve();
		const handle = host.handles[0]!;
		controller.dispose();
		controller.dispose();
		expect(handle.hide).toHaveBeenCalledTimes(1);
	});

	it("ignores setShown after dispose", async () => {
		const { host, tui } = makeFakeHost();
		const controller = createSidebarController({
			ctx: makeCtx(host, tui),
			getSnapshot: () => FIXED_SNAPSHOT,
			getConfig: () => FIXED_CONFIG,
		});
		controller.show();
		await Promise.resolve();
		const handle = host.handles[0]!;
		controller.dispose();
		controller.setShown(true);
		controller.setShown(false);
		expect(handle.setHidden).not.toHaveBeenCalled();
	});

	it("hides stale overlay handles from a previous generation", async () => {
		const { host, tui } = makeFakeHost();
		const ctx = makeCtx(host, tui);
		const controller = createSidebarController({
			ctx,
			getSnapshot: () => FIXED_SNAPSHOT,
			getConfig: () => FIXED_CONFIG,
		});
		controller.show();
		await Promise.resolve();
		controller.dispose();
		const staleHandle = new FakeOverlayHandle();
		// Reach into the first custom() call to invoke its onHandle against a
		// late handle. The implementation must call staleHandle.hide() because
		// dispose() bumped the generation counter past the captured mount.
		const opts = (ctx.ui.custom as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
			| { onHandle?: (handle: OverlayHandle) => void }
			| undefined;
		opts?.onHandle?.(staleHandle);
		expect(staleHandle.hide).toHaveBeenCalled();
	});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: PASS.

### Step 4: Implement animation gating and add tests

Update `syncAnimation` so it does not start until `mounted && shown` is true, and so `stopAnimation` runs on every `setShown(false)` and `dispose()`. The implementation in step 2 already does this. Append these tests:

```ts
	it("runs the animation interval only while shown and shouldAnimate() returns true", () => {
		vi.useFakeTimers();
		const { host, tui } = makeFakeHost();
		let animate = false;
		const controller = createSidebarController({
			ctx: makeCtx(host, tui),
			getSnapshot: () => FIXED_SNAPSHOT,
			getConfig: () => FIXED_CONFIG,
			animationIntervalMs: 100,
			shouldAnimate: () => animate,
		});
		controller.show();
		// Animation is gated by both shown() and shouldAnimate(); both are false
		// here, so no interval should be active.
		expect(vi.getTimerCount()).toBe(0);
		controller.setShown(true);
		expect(vi.getTimerCount()).toBe(0);
		animate = true;
		controller.requestRender(); // re-evaluate
		expect(vi.getTimerCount()).toBeGreaterThan(0);
		animate = false;
		controller.setShown(false);
		expect(vi.getTimerCount()).toBe(0);
	});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: PASS.

### Step 5: Implement `isSupported` and `isEffectivelyVisible` against a real `tui`

Update `isSupported` and `isEffectivelyVisible` to read the captured `tui` from the factory closure. Update the controller body to capture `tui` and `currentColumns`:

```ts
let capturedTui: TUI | undefined;
let currentColumns = 0;

// Inside the factory, after split.attach(tui):
capturedTui = tui;
currentColumns = tui.terminal.columns;
requestOverlayRender = () => tui.requestRender?.();

// Add a refreshColumns helper used by isEffectivelyVisible:
const refreshColumns = () => {
	if (capturedTui) currentColumns = capturedTui.terminal.columns;
};

// Replace isSupported and isEffectivelyVisible in the returned object:
isSupported: () => Boolean(capturedTui) && !isViewportTUI(capturedTui!),
isEffectivelyVisible: () => {
	refreshColumns();
	return shown && split.isVisibleAtWidth(currentColumns);
},
```

Then add tests:

```ts
	it("isSupported() returns false when the host is a viewport TUI", async () => {
		const { host, tui } = makeFakeHost();
		// Mark the tui with the viewport symbol to make isViewportTUI true.
		(tui as unknown as Record<symbol, boolean>)[Symbol.for("@earendil-works/pi-tui/viewport")] = true;
		const controller = createSidebarController({
			ctx: makeCtx(host, tui),
			getSnapshot: () => FIXED_SNAPSHOT,
			getConfig: () => FIXED_CONFIG,
		});
		controller.show();
		await Promise.resolve();
		expect(controller.isSupported()).toBe(false);
	});

	it("isEffectivelyVisible() reflects both shown state and current terminal width", async () => {
		const { host, tui } = makeFakeHost(120);
		const controller = createSidebarController({
			ctx: makeCtx(host, tui),
			getSnapshot: () => FIXED_SNAPSHOT,
			getConfig: () => FIXED_CONFIG,
		});
		controller.show();
		await Promise.resolve();
		expect(controller.isEffectivelyVisible()).toBe(false);
		controller.setShown(true);
		expect(controller.isEffectivelyVisible()).toBe(true);
		host.terminal.columns = 80;
		expect(controller.isEffectivelyVisible()).toBe(false);
	});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: PASS.

### Step 6: Wire the renderer into the component factory

Replace the stub `render` inside the `ctx.ui.custom` factory with a call to `renderSidebarLines(snapshot, config, theme, width, tui.terminal.rows, { colorEnabled, resizing: split.isResizing() })`. The renderer is already exact-height and self-handles failures (phase 4). Add `import { renderSidebarLines } from "./sidebar-render.ts";` and capture the `theme` parameter from the factory:

```ts
const pending = options.ctx.ui.custom<void>(
	(tui, theme) => {
		split.attach(tui);
		capturedTui = tui;
		currentColumns = tui.terminal.columns;
		const statusTheme = (theme ?? {}) as unknown as Parameters<typeof renderSidebarLines>[2];
		return {
			render(width: number) {
				currentColumns = tui.terminal.columns;
				try {
					return renderSidebarLines(
						options.getSnapshot(),
						options.getConfig(),
						statusTheme,
						width,
						tui.terminal.rows,
						{
							...(options.colorEnabled === undefined ? {} : { colorEnabled: options.colorEnabled }),
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
```

Add a smoke test that exercises the renderer through the controller:

```ts
	it("renders the snapshot through the overlay component", async () => {
		const { host, tui } = makeFakeHost();
		const controller = createSidebarController({
			ctx: makeCtx(host, tui),
			getSnapshot: () => FIXED_SNAPSHOT,
			getConfig: () => FIXED_CONFIG,
		});
		controller.show();
		await Promise.resolve();
		const component = host.factories[host.factories.length - 1]!(tui, {});
		const lines = component.render(44);
		expect(lines.length).toBe(36);
	});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: PASS. The renderer returns exactly `tui.terminal.rows` lines.

### Step 7: Verify and commit

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts tests/tui/split-pane.test.ts tests/tui/sidebar-render.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
git add src/tui/sidebar.ts tests/tui/sidebar.test.ts
git commit -m "feat: add direct sidebar overlay controller"
```

Expected: all suites pass, typecheck clean, diff clean, commit created.

---

## Phase gate

All three suites must pass before phase 6 (Dashboard Sidebar tab) begins:

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/tui/split-pane.test.ts \
  tests/tui/sidebar.test.ts \
  tests/tui/sidebar-render.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Expected outcome: a host can call `createSidebarController(...)` once per session generation, call `.show()` to mount the overlay, `.setShown(false/true)` to toggle without re-mounting, `.dispose()` to tear down. Resize mode works via `split.beginResize()` and `split.setSidebarWidth()`. Fullscreen hosts are detected via `isViewportTUI(tui)` and skipped silently. The renderer never throws because phase 4 already guarantees exact-height output.

## Out of scope

Dashboard tab UI, persisted `config.showSidebar`, session-generation lifecycle wiring, TODO reconstruction, Workspace Pulse demand logic, fullscreen entry detection from Pi (we detect viewport TUI only — the entry signal lives in phase 7). These belong to phases 6 through 8.