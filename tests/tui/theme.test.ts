import { describe, expect, it } from "vitest";
import { ATELIER_COLORS, DEFAULT_COLOR_SETTINGS } from "../../src/core/colors.ts";
import type { ColorSettings } from "../../src/shared/types.ts";
import {
  createStatusLineTheme,
  fromPiTheme,
  noColorRequested,
  noTheme,
} from "../../src/tui/theme.ts";

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
});

describe("fromPiTheme", () => {
  it("delegates fg calls to the live Pi theme", () => {
    const theme = makeSpyTheme();
    const adapted = fromPiTheme(theme);

    const result = adapted.fg("accent", "title");

    expect(result).toBe("[fg:accent:title]");
    expect(theme.fg.calls).toEqual([["accent", "title"]]);
  });

  it("delegates bold calls to the live Pi theme", () => {
    const theme = makeSpyTheme();
    const adapted = fromPiTheme(theme);

    const result = adapted.bold("title");

    expect(result).toBe("[bold:title]");
    expect(theme.bold.calls).toEqual([["title"]]);
  });

  it("implements dim as fg('dim', text) because Pi's dim is a color role", () => {
    const theme = makeSpyTheme();
    const adapted = fromPiTheme(theme);

    const result = adapted.dim("faint");

    expect(result).toBe("[fg:dim:faint]");
    expect(theme.fg.calls).toEqual([["dim", "faint"]]);
  });

  it("forwards unknown color roles to the live Pi theme fg", () => {
    const theme = makeSpyTheme();
    const adapted = fromPiTheme(theme);

    adapted.fg("borderMuted", "rule");
    adapted.fg("success", "ok");
    adapted.fg("warning", "warn");
    adapted.fg("error", "fail");

    expect(theme.fg.calls.map(([color]) => color)).toEqual([
      "borderMuted",
      "success",
      "warning",
      "error",
    ]);
  });

  it("returns noTheme when fg is not a function", () => {
    const adapted = fromPiTheme({ bold: (text: string) => text });
    expect(adapted).toBe(noTheme);
  });

  it("returns noTheme when bold is not a function", () => {
    const adapted = fromPiTheme({ fg: (_color: string, text: string) => text });
    expect(adapted).toBe(noTheme);
  });

  it("returns noTheme for null or non-object input", () => {
    expect(fromPiTheme(null)).toBe(noTheme);
    expect(fromPiTheme(undefined)).toBe(noTheme);
    expect(fromPiTheme("theme")).toBe(noTheme);
    expect(fromPiTheme(42)).toBe(noTheme);
  });

  it("captures the live theme by reference so the next render sees updates", () => {
    const theme = makeSpyTheme();
    const adapted = fromPiTheme(theme);

    adapted.fg("accent", "first");
    theme.fg = vi_fn((_color: string, text: string) => `[NEW:${text}]`);
    const second = adapted.fg("accent", "second");

    expect(second).toBe("[NEW:second]");
  });

  it("rainbow applies per-character ANSI colors and ends with reset", () => {
    const adapted = fromPiTheme(makeSpyTheme());
    const result = adapted.rainbow("ab");
    const ESC = String.fromCharCode(27);
    // Each character gets ESC[38;2;R;G;Bm prefix
    expect(result).toContain(`${ESC}[38;2;`);
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result.endsWith(`${ESC}[0m`)).toBe(true);
  });

  it("rainbow skips spaces and colons without coloring them", () => {
    const adapted = fromPiTheme(makeSpyTheme());
    const result = adapted.rainbow("a b:c");
    const ESC = String.fromCharCode(27);
    // Split on ANSI sequences to check structure
    const parts = result.split(new RegExp(`${ESC}\\[[^m]*m`));
    // Space and colon should appear as standalone characters (not preceded by color)
    expect(parts.some((p) => p.includes(" "))).toBe(true);
    expect(parts.some((p) => p.includes(":"))).toBe(true);
  });

  it("rainbow cycles through the color palette", () => {
    const adapted = fromPiTheme(makeSpyTheme());
    const result = adapted.rainbow("abcdefghi");
    const ESC = String.fromCharCode(27);
    // First color: #b281d6 → rgb(178,129,214)
    expect(result).toContain(`${ESC}[38;2;178;129;214m`);
    // Second color: #d787af → rgb(215,135,175)
    expect(result).toContain(`${ESC}[38;2;215;135;175m`);
    // Third color: #febc38 → rgb(254,188,56)
    expect(result).toContain(`${ESC}[38;2;254;188;56m`);
    // Palette is 8 entries; 9th char wraps to index 0
    // (palette[0] and palette[7] are both #b281d6 for smooth gradient wrap)
    const firstColor = `${ESC}[38;2;178;129;214m`;
    const occurrences = result.split(firstColor).length - 1;
    expect(occurrences).toBe(3);
  });

  it("safeFg falls back to accent when theme.fg throws", () => {
    const theme = {
      fg: (color: string, text: string) => {
        if (color === "thinkingHigh") throw new Error("unknown");
        return `[${color}:${text}]`;
      },
      bold: (t: string) => t,
    };
    const adapted = fromPiTheme(theme);
    expect(adapted.fg("thinkingHigh", "x")).toBe("[accent:x]");
  });

  it("safeFg returns plain text when both color and accent throw", () => {
    const theme = {
      fg: (_color: string, _text: string): string => {
        throw new Error("broken");
      },
      bold: (t: string) => t,
    };
    const adapted = fromPiTheme(theme);
    expect(adapted.fg("accent", "fallback")).toBe("fallback");
  });

  it("safeFg passes through when theme.fg succeeds", () => {
    const adapted = fromPiTheme(makeSpyTheme());
    expect(adapted.fg("thinkingMinimal", "test")).toBe("[fg:thinkingMinimal:test]");
  });

  it("delegates dashboard pill styling to the live Pi theme", () => {
    const adapted = fromPiTheme({
      fg: (_color: string, text: string) => text,
      bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => `<b>${text}</b>`,
      inverse: (text: string) => `<inverse>${text}</inverse>`,
    });

    expect(adapted.bg("selectedBg", "tab")).toBe("<selectedBg>tab</selectedBg>");
    expect(adapted.inverse("tab")).toBe("<inverse>tab</inverse>");
  });

  it("falls back when older theme-like objects omit dashboard methods", () => {
    const adapted = fromPiTheme({
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    });

    expect(adapted.bg("selectedBg", "tab")).toBe("tab");
    expect(adapted.inverse("tab")).toBe("tab");
  });

  it("falls back when optional dashboard properties are not functions", () => {
    const adapted = fromPiTheme({
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      bg: "broken",
      inverse: 42,
    });

    expect(adapted.bg("selectedBg", "tab")).toBe("tab");
    expect(adapted.inverse("tab")).toBe("tab");
  });

  it("falls back when optional dashboard methods throw", () => {
    const adapted = fromPiTheme({
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      bg: () => {
        throw new Error("broken background");
      },
      inverse: () => {
        throw new Error("broken inverse");
      },
    });

    expect(adapted.bg("selectedBg", "tab")).toBe("tab");
    expect(adapted.inverse("tab")).toBe("tab");
  });

  it("copies the theme name when present", () => {
    const named = {
      name: "dark",
      fg: (color: string, text: string) => `[${color}:${text}]`,
      bold: (t: string) => t,
    };
    const wrapped = fromPiTheme(named);
    expect(wrapped.name).toBe("dark");
  });

  it("leaves name undefined when the source theme has no name", () => {
    const anon = {
      fg: (color: string, text: string) => `[${color}:${text}]`,
      bold: (t: string) => t,
    };
    expect(fromPiTheme(anon).name).toBeUndefined();
  });

  it("passes new tokens through fg without falling back", () => {
    const called: string[] = [];
    const theme = {
      name: "dark",
      fg: (color: string, text: string) => {
        called.push(color);
        return text;
      },
      bold: (t: string) => t,
    };
    const wrapped = fromPiTheme(theme);
    for (const token of ["text", "muted", "mdHeading", "syntaxType"] as const) {
      wrapped.fg(token, "x");
    }
    expect(called).toEqual(expect.arrayContaining(["text", "muted", "mdHeading", "syntaxType"]));
  });
});
