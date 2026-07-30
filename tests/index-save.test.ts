import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiStatusConfig } from "../src/shared/types.ts";
import {
  buildPiWithHandlers,
  buildSetFooterSpy,
  createContext,
  getRegisteredCommand,
  renderWithFactory,
} from "./helpers.ts";

afterEach(() => {
  vi.doUnmock("../src/core/config.ts");
  vi.resetModules();
});

describe("/statusline persistence", () => {
  it("uses the saved editor result without reloading config", async () => {
    const initial: PiStatusConfig = {
      segments: ["model"],
      extensionSegments: { hidden: [] },
    };
    const saved: PiStatusConfig = {
      segments: ["current-dir"],
      extensionSegments: { hidden: [] },
    };
    const loadConfig = vi.fn(() => initial);
    const saveConfig = vi.fn();
    vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }));

    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: vi.fn(async () => saved) as unknown as ExtensionContext["ui"]["custom"],
      },
    });

    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);

    expect(saveConfig).toHaveBeenCalledWith(saved);
    expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("project");
  });
});
