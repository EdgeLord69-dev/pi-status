import type { ExtensionContext, EventBus } from "@earendil-works/pi-coding-agent";
import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { createCompletionNotifier, type CompletionNotifier } from "./completion-notifier.ts";
import type { PiStatusConfig } from "../shared/types.ts";

export const NOTIFICATIONS_STATUS_EVENT = "pi-vault:questionnaire:status";

export type NotificationsStatusPayload = {
  active?: unknown;
  label?: unknown;
};

export type NotificationsSpawn = (file: string, args: string[], options: SpawnOptions) => unknown;

export interface NotificationsWiring {
  notifyAgentSettled(ctx: ExtensionContext): void;
  notifyRunStarted(ctx: ExtensionContext): void;
  notifyTurnStarted(ctx: ExtensionContext): void;
  dispose(): void;
}

export interface NotificationsWiringOptions {
  events: EventBus;
  isEnabled: () => boolean;
  activeTuiSession: () => ExtensionContext | undefined;
  spawn?: () => NotificationsSpawn | undefined;
  platform?: () => NodeJS.Platform | undefined;
}

const defaultSpawn = (file: string, args: string[], options: SpawnOptions) =>
  nodeSpawn(file, args, options);

export function createNotificationsWiring(
  options: NotificationsWiringOptions,
): NotificationsWiring {
  const notifier: CompletionNotifier = createCompletionNotifier({
    isEnabled: options.isEnabled,
    spawn: (file, args, spawnOptions) => {
      const override = options.spawn?.();
      const target = override ?? defaultSpawn;
      return target(file, args, spawnOptions) as never;
    },
    platform: options.platform?.() ?? process.platform,
  });
  const unsubscribe = options.events.on(NOTIFICATIONS_STATUS_EVENT, (raw) => {
    const payload = raw as NotificationsStatusPayload | null | undefined;
    if (!payload || typeof payload !== "object") return;
    const active = payload.active;
    if (active === true) {
      notifier.inputRequested("questionnaire");
    } else if (active === false) {
      notifier.reset();
    }
  });

  function isActiveTui(ctx: ExtensionContext): boolean {
    if (ctx.mode !== "tui") return false;
    return ctx === options.activeTuiSession();
  }

  return {
    notifyAgentSettled(ctx) {
      if (!isActiveTui(ctx)) return;
      if (!ctx.isIdle()) return;
      notifier.turnSettled();
    },
    notifyRunStarted(ctx) {
      if (!isActiveTui(ctx)) return;
      notifier.runStarted();
    },
    notifyTurnStarted(ctx) {
      if (!isActiveTui(ctx)) return;
      notifier.runStarted();
    },
    dispose() {
      unsubscribe();
      notifier.reset();
    },
  };
}

export function isNotificationsEnabled(config: PiStatusConfig): boolean {
  return config.completionNotifications === true;
}
