import { describe, expect, it } from "vitest";
import { ATELIER_COLORS, DEFAULT_COLOR_SETTINGS } from "../../src/core/colors.ts";
import type { ColorSettings } from "../../src/shared/types.ts";
import { createStatusLineTheme, noColorRequested, noTheme } from "../../src/tui/theme.ts";

function makeSpyTheme() {
  return {
    fg: vi_fn((color: string, text: string) => `[fg:${color}:${text}]`),
    bold: vi_fn((text: string) => `[bold:${text}]`),
  };
}

function vi_fn<T extends (...args: never[]) => unknown>(impl: T) {
  const calls: Array<Parameters<T>> = [];
  const fn = ((...args: Parameters<T>) => {
    calls.push(args);
    return impl(...args);
  }) as T & { calls: Array<Parameters<T>> };
  fn.calls = calls;
  return fn;
}

describe("noTheme", () => {
  it("returns the original text from fg", () => {
    expect(noTheme.fg("accent", "hello")).toBe("hello");
    expect(noTheme.fg("dim", "world")).toBe("world");
  });

  it("returns the original text from bold", () => {
    expect(noTheme.bold("strong")).toBe("strong");
  });

  it("returns the original text from dim", () => {
    expect(noTheme.dim("faint")).toBe("faint");
  });

  it("returns the original text from rainbow", () => {
    expect(noTheme.rainbow("hi")).toBe("hi");
  });

  it("returns the original text from dashboard background and inverse methods", () => {
    expect(noTheme.bg("selectedBg", "tab")).toBe("tab");
    expect(noTheme.inverse("tab")).toBe("tab");
  });
});

describe("noColorRequested", () => {
  it("uses presence rather than truthiness", () => {
    expect(noColorRequested({ NO_COLOR: "" })).toBe(true);
    expect(noColorRequested({ NO_COLOR: "0" })).toBe(true);
    expect(noColorRequested({})).toBe(false);
  });
});

describe("createStatusLineTheme — presets", () => {
  const custom: ColorSettings = {
    preset: "custom",
    custom: { ...ATELIER_COLORS, input: "#010203", context: "#040506" },
    customInitialized: true,
  };

  it("keeps direct Custom roles distinct", () => {
    const theme = createStatusLineTheme(makeSpyTheme(), custom, {});
    expect(theme.fg("input", "in")).toBe("\x1b[38;2;1;2;3min\x1b[39m");
    expect(theme.fg("context", "ctx")).toBe("\x1b[38;2;4;5;6mctx\x1b[39m");
  });

  it("uses exact fixed-preset colours", () => {
    const theme = createStatusLineTheme(
      makeSpyTheme(),
      { ...DEFAULT_COLOR_SETTINGS, preset: "catppuccin-mocha" },
      {},
    );
    expect(theme.fg("accent", "x")).toBe("\x1b[38;2;203;166;247mx\x1b[39m");
  });

  it("renders fixed colours without a usable Pi theme", () => {
    const theme = createStatusLineTheme(null, { ...DEFAULT_COLOR_SETTINGS, preset: "atelier" }, {});
    expect(theme.fg("accent", "x")).toBe("\x1b[38;2;177;140;255mx\x1b[39m");
    expect(theme.bold("x")).toBe("x");
  });

  it("delegates Pi roles and observes the live theme", () => {
    let prefix = "first";
    const pi = {
      fg: (color: string, text: string) => `${prefix}:${color}:${text}`,
      bg: (color: string, text: string) => `${prefix}:bg:${color}:${text}`,
      bold: (text: string) => `${prefix}:bold:${text}`,
      inverse: (text: string) => `${prefix}:inverse:${text}`,
    };
    const theme = createStatusLineTheme(pi, DEFAULT_COLOR_SETTINGS, {});

    expect(theme.fg("ready", "x")).toBe("first:thinkingLow:x");
    prefix = "second";
    expect(theme.fg("ready", "x")).toBe("second:thinkingLow:x");
    expect(theme.bg("selectedBg", "x")).toBe("second:bg:selectedBg:x");
  });

  it("lets NO_COLOR override every preset", () => {
    const theme = createStatusLineTheme(makeSpyTheme(), custom, { NO_COLOR: "" });
    expect(theme.fg("accent", "x")).toBe("x");
    expect(theme.bg("selectedBg", "x")).toBe("x");
    expect(theme.bold("x")).toBe("x");
    expect(theme.dim("x")).toBe("x");
    expect(theme.inverse("x")).toBe("x");
    expect(theme.rainbow("x")).toBe("x");
  });

  it("maps legacy tokens to semantic roles", () => {
    const theme = createStatusLineTheme(
      makeSpyTheme(),
      { ...DEFAULT_COLOR_SETTINGS, preset: "atelier" },
      {},
    );
    expect(theme.fg("success", "x")).toContain("38;2;110;168;254m");
    expect(theme.fg("thinkingHigh", "x")).toContain("38;2;255;159;67m");
    expect(theme.fg("syntaxType", "x")).toContain("38;2;125;211;252m");
  });

  it("uses scoped background and foreground resets", () => {
    const theme = createStatusLineTheme(
      makeSpyTheme(),
      { ...DEFAULT_COLOR_SETTINGS, preset: "atelier" },
      {},
    );
    expect(theme.bg("selectedBg", "x")).toBe("\x1b[48;2;102;102;102mx\x1b[49m");
    expect(theme.inverse("x")).toBe(
      "\x1b[48;2;177;140;255m\x1b[38;2;212;212;212mx\x1b[39m\x1b[49m",
    );
  });

  it("uses the documented rainbow role order", () => {
    const theme = createStatusLineTheme(
      makeSpyTheme(),
      { ...DEFAULT_COLOR_SETTINGS, preset: "atelier" },
      {},
    );
    const output = theme.rainbow("ab c:d");
    expect(output).toContain("38;2;177;140;255ma");
    expect(output).toContain("38;2;255;93;115mb");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC byte required to strip ANSI SGR sequences
    expect(output.replace(/\x1b\[[0-9;]*m/g, "")).toBe("ab c:d");
  });

  it("returns plain text when Pi styling throws", () => {
    const broken = {
      fg: () => {
        throw new Error("broken");
      },
      bg: () => {
        throw new Error("broken");
      },
      bold: () => {
        throw new Error("broken");
      },
      inverse: () => {
        throw new Error("broken");
      },
    };
    const theme = createStatusLineTheme(broken, DEFAULT_COLOR_SETTINGS, {});
    expect(theme.fg("accent", "x")).toBe("x");
    expect(theme.bg("selectedBg", "x")).toBe("x");
    expect(theme.bold("x")).toBe("x");
    expect(theme.inverse("x")).toBe("x");
  });

  it("keeps working Pi methods when a sibling method is missing", () => {
    const theme = createStatusLineTheme(
      {
        fg: (color: string, text: string) => `[${color}:${text}]`,
      },
      DEFAULT_COLOR_SETTINGS,
      {},
    );

    expect(theme.fg("ready", "x")).toBe("[thinkingLow:x]");
    expect(theme.bold("x")).toBe("x");
  });

  it("falls back only the broken Pi operation to plain text", () => {
    const theme = createStatusLineTheme(
      {
        fg: (color: string, text: string) => {
          if (color === "thinkingLow") throw new Error("broken role");
          return `[${color}:${text}]`;
        },
        bold: (text: string) => `[bold:${text}]`,
      },
      DEFAULT_COLOR_SETTINGS,
      {},
    );

    expect(theme.fg("ready", "x")).toBe("x");
    expect(theme.fg("accent", "x")).toBe("[accent:x]");
    expect(theme.bold("x")).toBe("[bold:x]");
  });

  it("delegates fixed-preset bold without requiring Pi foreground support", () => {
    const theme = createStatusLineTheme(
      { bold: (text: string) => `[bold:${text}]` },
      { ...DEFAULT_COLOR_SETTINGS, preset: "atelier" },
      {},
    );

    expect(theme.fg("accent", "x")).toBe("\x1b[38;2;177;140;255mx\x1b[39m");
    expect(theme.bold("x")).toBe("[bold:x]");
  });
});
