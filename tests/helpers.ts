import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConfigStore } from "../src/shared/types.ts";
import { DEFAULT_ZONES } from "../src/shared/types.ts";
import type { FooterRenderInput } from "../src/tui/render.ts";

export function withDefaults(
  input: Omit<FooterRenderInput, "extensionSegments" | "zones"> & {
    zones?: FooterRenderInput["zones"];
  },
): FooterRenderInput {
  return {
    ...input,
    zones: input.zones ?? structuredClone(DEFAULT_ZONES),
    extensionSegments: { hidden: [] },
  };
}

export function createContext(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    ui: {
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      notify: () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      custom: async () => null,
      pasteToEditor: () => {},
      setEditorText: () => {},
      getEditorText: () => "",
      editor: async () => undefined,
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      theme: {} as never,
      getAllThemes: () => [],
    },
    mode: "tui",
    hasUI: true,
    cwd: "/Users/test/project",
    sessionManager: {
      getSessionId: () => "abcdef123456",
      getBranch: () => [],
      getEntries: () => [],
    } as unknown as ExtensionContext["sessionManager"],
    modelRegistry: { isUsingOAuth: () => false } as unknown as ExtensionContext["modelRegistry"],
    model: { id: "gpt-5", name: "GPT-5", provider: "anthropic", reasoning: true } as never,
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
    ...overrides,
  } as ExtensionContext;
}

export function getRegisteredCommand(
  calls: readonly (readonly unknown[])[],
  name: string,
): {
  handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
} {
  const command = calls.find(([registeredName]) => registeredName === name);
  if (!command) throw new Error(`Command not registered: ${name}`);
  return command[1] as {
    handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
  };
}

export function createBus() {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  return {
    emit(event: string, payload: unknown) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
    on(event: string, handler: (payload: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((current) => current !== handler),
        );
      };
    },
  };
}

export function buildPiWithHandlers(options: { thinkingLevel?: string } = {}) {
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
  const events = createBus();
  const registerCommand = {
    calls: [] as unknown[][],
    fn(name: string, definition: unknown) {
      this.calls.push([name, definition]);
    },
  };
  const pi = {
    events,
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand: registerCommand.fn.bind(registerCommand),
    getThinkingLevel: () => options.thinkingLevel ?? "medium",
  } as unknown as ExtensionAPI;
  return { pi, handlers, registerCommandCalls: registerCommand.calls };
}

export function buildSetFooterSpy() {
  const calls: unknown[] = [];
  const setFooter = (factory: unknown) => {
    calls.push(factory);
  };
  return { calls, setFooter };
}

export class MemoryConfigStore implements ConfigStore {
  private files = new Map<string, string>();
  readonly existsPaths: string[] = [];
  readonly readPaths: string[] = [];
  readonly writePaths: string[] = [];
  readonly accessPaths: string[] = [];

  seed(path: string, content: string): void {
    this.files.set(path, content);
  }
  exists(path: string): boolean {
    this.existsPaths.push(path);
    this.accessPaths.push(path);
    return this.files.has(path);
  }
  read(path: string): string | null {
    this.readPaths.push(path);
    this.accessPaths.push(path);
    return this.files.get(path) ?? null;
  }
  write(path: string, data: string): void {
    this.writePaths.push(path);
    this.accessPaths.push(path);
    this.files.set(path, data);
  }
}

export function renderWithFactory(
  factory: unknown,
  options: { gitBranch?: string | null; width?: number } = {},
): string {
  if (typeof factory !== "function") return "";
  const component = (
    factory as (
      tui: unknown,
      theme: unknown,
      footerData: unknown,
    ) => { render: (width: number) => string[] }
  )(
    { requestRender: () => {} },
    { fg: (_c: string, t: string) => t, rainbow: (t: string) => t },
    {
      getGitBranch: () => options.gitBranch ?? null,
      getExtensionStatuses: () => new Map(),
    },
  );
  return component.render(options.width ?? 200).join("\n");
}
