# Phase 1: Backward-Compatible Config Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canonical `statusbarEnabled` and `sidebarEnabled` configuration fields with enabled-by-default, literal-`false` opt-out normalization and complete persistence.

**Architecture:** Extend the existing `PiStatusConfig` contract and keep all behavior in `src/core/config.ts`. Older files continue through the existing normalization path; every successful save emits both booleans. Existing test fixtures are updated only where they construct typed in-memory configs.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, Vitest 4, and the existing `ConfigStore` abstraction.

**Spec:** `docs/superpowers/specs/2026-08-17-statusbar-sidebar-visibility-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility.md` (read-only; do not modify).

## Global Constraints

- `statusbarEnabled` and `sidebarEnabled` are required `boolean` fields on `PiStatusConfig`.
- Both fields default to `true`.
- Only the literal stored value `false` disables a field; missing and all other values normalize to `true`.
- `saveConfig` always serializes both fields as booleans.
- Existing malformed-file refusal, direct extension-file storage, and legacy layout handling remain unchanged.
- Do not modify `/Users/lanh/Developer/pi-packages/pi`.
- Follow RED/GREEN/REFACTOR: production changes follow a test that was run and failed for the missing behavior.
- Do not add dependencies or commit changes unless the user separately requests a commit.

---

## Phase boundary and usable result

This phase is complete when `loadConfig` returns both fields for missing, valid, invalid, and literal-false inputs; `saveConfig` round-trips them; all typed config fixtures compile; and `pnpm exec vitest run tests/core/config.test.ts` plus `pnpm exec tsc --noEmit` pass. Later phases can use the fields without casts or fallback logic.

## File map

- Modify: `src/shared/types.ts` — required fields on `PiStatusConfig`.
- Modify: `src/core/config.ts` — defaults, clone, normalization, serialization.
- Modify: `tests/core/config.test.ts` — failing behavior tests and expected schema.
- Modify: `tests/core/resolve-footer.test.ts` — typed fixture fields.
- Modify: `tests/core/runtime-state.test.ts` — typed fixture fields.
- Modify: `tests/core/sidebar-layout.test.ts` — typed fixture fields.
- Modify: `tests/index-sidebar-layout.test.ts` — typed fixture fields.
- Modify: `tests/tui/sidebar.test.ts` — typed fixture fields.
- Modify: `tests/tui/sidebar-render.test.ts` — typed fixture fields.
- Modify: `tests/index-save.test.ts` — typed fixture fields.
- Modify: `tests/index.test.ts` — typed fixture and persisted-schema expectations.
- Modify: `tests/tui/dashboard-render.test.ts` — typed fixture fields.
- Modify: `tests/tui/dashboard-state.test.ts` — typed fixture fields.
- Modify: `tests/tui/dashboard.test.ts` — typed fixture fields.

---

### Task 1: Add and persist the two surface fields

**Interfaces:**

- Consumes: Existing `ConfigStore`, `loadConfig`, `saveConfig`, `DEFAULT_CONFIG`, and `PiStatusConfig` fields.
- Produces: `PiStatusConfig.statusbarEnabled: boolean`, `PiStatusConfig.sidebarEnabled: boolean`; normalized defaults; canonical serialized keys.

- [ ] **Step 1: Write the failing configuration tests**

Add this block to `tests/core/config.test.ts` without changing production code:

```ts
describe("config — surface visibility", () => {
  it("defaults both surfaces to enabled when the fields are absent", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({
        zones: DEFAULT_ZONES,
        extensionSegments: { hidden: [] },
      }),
    );

    expect(loadConfig({ agentDir: "/agent", store })).toMatchObject({
      statusbarEnabled: true,
      sidebarEnabled: true,
    });
  });

  it.each(["statusbarEnabled", "sidebarEnabled"] as const)(
    "treats non-false %s values as enabled",
    (field) => {
      for (const value of [true, null, 0, "false", {}, []]) {
        const store = new MemoryConfigStore();
        store.seed(
          getConfigPath("/agent"),
          JSON.stringify({
            zones: DEFAULT_ZONES,
            extensionSegments: { hidden: [] },
            [field]: value,
          }),
        );

        expect(loadConfig({ agentDir: "/agent", store })[field]).toBe(true);
      }
    },
  );

  it.each([
    { statusbarEnabled: false, sidebarEnabled: true },
    { statusbarEnabled: true, sidebarEnabled: false },
    { statusbarEnabled: false, sidebarEnabled: false },
  ] as const)(
    "disables only the surface whose stored value is literal false: %j",
    (surfaceValues) => {
      const store = new MemoryConfigStore();
      store.seed(
        getConfigPath("/agent"),
        JSON.stringify({
          zones: DEFAULT_ZONES,
          extensionSegments: { hidden: [] },
          ...surfaceValues,
        }),
      );

      expect(loadConfig({ agentDir: "/agent", store })).toMatchObject(
        surfaceValues,
      );
    },
  );

  it("round-trips both surface fields and publishes them in the schema", () => {
    const store = new MemoryConfigStore();
    const disabled = {
      ...config,
      statusbarEnabled: false,
      sidebarEnabled: true,
    } as PiStatusConfig;

    saveConfig(disabled, { agentDir: "/agent", store });

    const written = JSON.parse(store.read(getConfigPath("/agent")) as string);
    expect(written).toMatchObject({
      statusbarEnabled: false,
      sidebarEnabled: true,
    });
    expect(loadConfig({ agentDir: "/agent", store })).toMatchObject(disabled);
    expect(Object.keys(written).sort()).toContain("sidebarEnabled");
    expect(Object.keys(written).sort()).toContain("statusbarEnabled");
  });
});
```

Add these fields to the canonical in-memory fixture in the same test file:

```ts
statusbarEnabled: true,
sidebarEnabled: true,
```

Keep raw JSON fixtures that intentionally represent old files without the fields.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run tests/core/config.test.ts
```

Expected: FAIL because the current loaded config has no surface fields and saved JSON has no surface keys. A compile or assertion error unrelated to those missing behaviors must be fixed before proceeding.

- [ ] **Step 3: Extend the shared config type and defaults**

In `src/shared/types.ts`, make the fields required:

```ts
export type PiStatusConfig = {
  statusbarEnabled: boolean;
  sidebarEnabled: boolean;
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  extensionStatusZone: StatusLineZone;
  completionNotifications: boolean;
  sidebarPanelLayout: SidebarPanelLayout;
  sidebarHiddenSegments: string[];
};
```

In `src/core/config.ts`, add both values to `DEFAULT_CONFIG` and `cloneDefaultConfig`:

```ts
export const DEFAULT_CONFIG: PiStatusConfig = {
  statusbarEnabled: true,
  sidebarEnabled: true,
  zones: cloneZones(DEFAULT_ZONES),
  extensionSegments: { hidden: [] },
  extensionStatusZone: "bottomRight",
  completionNotifications: false,
  sidebarPanelLayout: cloneSidebarPanelLayout(DEFAULT_SIDEBAR_PANEL_LAYOUT),
  sidebarHiddenSegments: [],
};
```

The clone must copy the scalar booleans directly, alongside the existing cloned arrays:

```ts
function cloneDefaultConfig(): PiStatusConfig {
  return {
    statusbarEnabled: DEFAULT_CONFIG.statusbarEnabled,
    sidebarEnabled: DEFAULT_CONFIG.sidebarEnabled,
    zones: cloneZones(DEFAULT_CONFIG.zones),
    extensionSegments: { hidden: [...DEFAULT_CONFIG.extensionSegments.hidden] },
    extensionStatusZone: DEFAULT_CONFIG.extensionStatusZone,
    completionNotifications: DEFAULT_CONFIG.completionNotifications,
    sidebarPanelLayout: cloneSidebarPanelLayout(
      DEFAULT_CONFIG.sidebarPanelLayout,
    ),
    sidebarHiddenSegments: [...DEFAULT_CONFIG.sidebarHiddenSegments],
  };
}
```

- [ ] **Step 4: Normalize only literal false as disabled**

In `normalizeConfig`, add the fields before the existing layout fields:

```ts
function normalizeConfig(input: Record<string, unknown>): PiStatusConfig {
  const layout = normalizeSidebarLayout(input);
  return {
    statusbarEnabled: input.statusbarEnabled !== false,
    sidebarEnabled: input.sidebarEnabled !== false,
    zones: Object.hasOwn(input, "zones")
      ? normalizeZones(input.zones)
      : Object.hasOwn(input, "segments") && Array.isArray(input.segments)
        ? normalizeZones({ topLeft: input.segments })
        : cloneZones(DEFAULT_ZONES),
    extensionSegments: normalizeExtensionSegments(input.extensionSegments),
    extensionStatusZone: layout.extensionStatusZone,
    completionNotifications: input.completionNotifications === true,
    sidebarPanelLayout: layout.sidebarPanelLayout,
    sidebarHiddenSegments: layout.sidebarHiddenSegments,
  };
}
```

This preserves old files and treats `null`, strings, numbers, arrays, objects, and `true` as enabled.

- [ ] **Step 5: Serialize both booleans**

Add the fields to `saveConfig`'s canonical `next` object:

```ts
const next: PiStatusConfig = {
  statusbarEnabled: config.statusbarEnabled,
  sidebarEnabled: config.sidebarEnabled,
  zones: cloneZones(config.zones),
  extensionSegments: { hidden: [...config.extensionSegments.hidden] },
  extensionStatusZone: config.extensionStatusZone,
  completionNotifications: config.completionNotifications,
  sidebarPanelLayout: sidebar.sidebarPanelLayout,
  sidebarHiddenSegments: sidebar.sidebarHiddenSegments.filter(
    isPersistedSidebarSegmentId,
  ),
};
```

Update exact serialized-key expectations in `tests/core/config.test.ts` to include both `sidebarEnabled` and `statusbarEnabled` alongside the existing published keys.

- [ ] **Step 6: Update typed fixtures and backward-compatibility expectations**

Add this pair to every in-memory `PiStatusConfig` object in the phase file map:

```ts
statusbarEnabled: true,
sidebarEnabled: true,
```

For disabled fixtures, use the intended boolean. For raw old-file JSON, leave fields absent and update expected normalized objects to contain `statusbarEnabled: true` and `sidebarEnabled: true`. Do not add fields to a raw legacy fixture whose purpose is to prove missing-key compatibility.

- [ ] **Step 7: Run GREEN checks**

Run:

```bash
pnpm exec vitest run tests/core/config.test.ts
pnpm exec tsc --noEmit
```

Expected: both commands exit successfully; no typed fixture reports a missing surface property.

## Phase acceptance checklist

- [ ] Missing fields load as `true`/`true`.
- [ ] Literal `false` independently disables either field without affecting the other.
- [ ] Invalid non-false values load as enabled for either field.
- [ ] Save/reload preserves both fields.
- [ ] Serialized schema contains both keys.
- [ ] Full TypeScript typecheck passes.
