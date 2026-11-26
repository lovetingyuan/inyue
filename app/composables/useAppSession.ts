import { useSessionStore } from "~/stores/session";
import { usePlayerStore } from "~/stores/player";
import { useLibraryStore } from "~/stores/library";
import { useAppStore } from "~/stores/app";
import { useMusicApi } from "~/composables/useMusicApi";
import { nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { useNuxtApp, useRuntimeConfig } from "#app";
import { useMutationCache, useQueryCache } from "@pinia/colada";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  useDocumentVisibility,
  useEventBus,
  useEventListener,
  useIntervalFn,
  useOnline,
} from "@vueuse/core";
import { offlineSessionKey } from "~~/shared/offline-library";
import { responseStatus } from "~/utils/library-error";
import { libraryKeys, networkActivityEvent } from "~/utils/music-query-keys";

const probeTimeoutMs = 4_000;
const osOfflineGraceMs = 800;
const offlineConfirmDelayMs = 800;
const onlineHeartbeatIntervalMs = 20_000;
const recentReachableWindowMs = 15_000;
const recoveryBackoffMs = [1_500, 2_500, 4_000, 6_000, 10_000] as const;

export function useAppSession() {
  const session = useSessionStore();
  const app = useAppStore();
  const library = useLibraryStore();
  const player = usePlayerStore();
  const cache = useQueryCache();
  const mutations = useMutationCache();
  const { request } = useMusicApi();
  const online = useOnline();
  const visible = useDocumentVisibility();
  const serverRendered = useNuxtApp().payload.serverRendered;
  const integrationPlayback = useRuntimeConfig().public.integrationPlayback;
  const networkActivity = import.meta.client
    ? useEventBus<"reachable" | "unreachable">(networkActivityEvent)
    : undefined;

  let nativeOnline: boolean | undefined;
  let networkRevision = 0;
  let lastReachableAt = 0;
  let lastNativeResumeAt = 0;
  let recoveryAttempt = 0;
  let probeController: AbortController | undefined;
  let activeProbeMode: "verify-offline" | "recover" | undefined;
  let activeProbeRevision = -1;
  let osOfflineTimer: ReturnType<typeof setTimeout> | undefined;
  let confirmOfflineTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshNativeStatus: (() => Promise<void>) | undefined;
  let disposed = false;
  const networkListeners: PluginListenerHandle[] = [];

  function hasOsNetwork() {
    if (app.native && nativeOnline !== undefined) {
      return nativeOnline;
    }
    return online.value;
  }

  function clearOsOfflineTimer() {
    if (osOfflineTimer !== undefined) {
      clearTimeout(osOfflineTimer);
      osOfflineTimer = undefined;
    }
  }

  function clearConfirmOfflineTimer() {
    if (confirmOfflineTimer !== undefined) {
      clearTimeout(confirmOfflineTimer);
      confirmOfflineTimer = undefined;
    }
  }

  function clearRecoveryTimer() {
    if (recoveryTimer !== undefined) {
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    }
  }

  function abortActiveProbe() {
    if (probeController) {
      probeController.abort();
      probeController = undefined;
      activeProbeMode = undefined;
      activeProbeRevision = -1;
    }
  }

  function pauseBackgroundProbes() {
    clearConfirmOfflineTimer();
    clearRecoveryTimer();
    abortActiveProbe();
  }

  function enterOfflineImmediately() {
    clearOsOfflineTimer();
    clearConfirmOfflineTimer();
    abortActiveProbe();
    networkRevision++;
    void session.setConnection(false);
    session.mounted = true;
  }

  function scheduleOsOffline() {
    if (disposed) {
      return;
    }
    if (!session.mounted) {
      enterOfflineImmediately();
      return;
    }
    if (app.offline) {
      clearRecoveryTimer();
      abortActiveProbe();
      void session.setConnection(false);
      return;
    }
    if (osOfflineTimer !== undefined) {
      return;
    }
    osOfflineTimer = setTimeout(() => {
      osOfflineTimer = undefined;
      if (!disposed && !hasOsNetwork()) {
        enterOfflineImmediately();
      }
    }, osOfflineGraceMs);
  }

  async function probeHealth(signal: AbortSignal): Promise<boolean | undefined> {
    try {
      await request("/api/health", {
        method: "GET",
        cache: "no-store",
        timeout: probeTimeoutMs,
        signal,
      });
      return true;
    } catch (error) {
      if (signal.aborted) {
        return undefined;
      }
      const status = responseStatus(error);
      return status !== undefined && status !== 502 && status !== 503 && status !== 504;
    }
  }

  function scheduleRecovery(immediate = false) {
    if (
      disposed ||
      !session.mounted ||
      !app.offline ||
      visible.value !== "visible" ||
      !hasOsNetwork() ||
      session.signingOut
    ) {
      return;
    }
    clearRecoveryTimer();
    if (immediate) {
      recoveryAttempt = 0;
      void runRecoveryProbe(true);
      return;
    }
    const index = Math.min(recoveryAttempt, recoveryBackoffMs.length - 1);
    const delay = recoveryBackoffMs[index] ?? 10_000;
    recoveryAttempt++;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      void runRecoveryProbe(false);
    }, delay);
  }

  async function runRecoveryProbe(forceRestart: boolean) {
    if (
      disposed ||
      !session.mounted ||
      !app.offline ||
      visible.value !== "visible" ||
      !hasOsNetwork() ||
      session.signingOut
    ) {
      return;
    }
    if (probeController) {
      if (
        activeProbeMode === "recover" &&
        (!forceRestart || activeProbeRevision === networkRevision)
      ) {
        return;
      }
      abortActiveProbe();
    }
    clearRecoveryTimer();
    const revision = networkRevision;
    const controller = new AbortController();
    probeController = controller;
    activeProbeMode = "recover";
    activeProbeRevision = revision;
    let reachable: boolean | undefined;
    try {
      reachable = await probeHealth(controller.signal);
    } finally {
      if (probeController === controller) {
        probeController = undefined;
        activeProbeMode = undefined;
        activeProbeRevision = -1;
      }
    }
    if (disposed || reachable === undefined || revision !== networkRevision || !app.offline) {
      return;
    }
    if (!reachable) {
      scheduleRecovery(false);
      return;
    }
    lastReachableAt = Date.now();
    await session.setConnection(true);
    if (!disposed && app.offline && revision === networkRevision) {
      scheduleRecovery(false);
    } else if (!app.offline) {
      recoveryAttempt = 0;
    }
  }

  async function verifyConnectivity(confirmStep = false) {
    if (disposed || !session.mounted || app.offline || visible.value !== "visible") {
      return;
    }
    if (!hasOsNetwork()) {
      scheduleOsOffline();
      return;
    }
    if (probeController) {
      return;
    }
    if (!confirmStep && confirmOfflineTimer !== undefined) {
      return;
    }
    const revision = networkRevision;
    const startedAt = Date.now();
    const controller = new AbortController();
    probeController = controller;
    activeProbeMode = "verify-offline";
    activeProbeRevision = revision;
    let reachable: boolean | undefined;
    try {
      reachable = await probeHealth(controller.signal);
    } finally {
      if (probeController === controller) {
        probeController = undefined;
        activeProbeMode = undefined;
        activeProbeRevision = -1;
      }
    }
    if (disposed || reachable === undefined || revision !== networkRevision || app.offline) {
      return;
    }
    if (reachable || lastReachableAt >= startedAt) {
      lastReachableAt = Math.max(lastReachableAt, Date.now());
      clearConfirmOfflineTimer();
      return;
    }
    if (!confirmStep) {
      clearConfirmOfflineTimer();
      confirmOfflineTimer = setTimeout(() => {
        confirmOfflineTimer = undefined;
        void verifyConnectivity(true);
      }, offlineConfirmDelayMs);
      return;
    }
    void session.setConnection(false);
  }

  function handleNativeStatus(connected: boolean, options?: { fromResume?: boolean }) {
    if (disposed) {
      return;
    }
    const changed = nativeOnline !== connected;
    if (changed) {
      networkRevision++;
    }
    nativeOnline = connected;
    if (connected) {
      clearOsOfflineTimer();
      if (!session.mounted) {
        session.mounted = true;
      } else if (app.offline) {
        scheduleRecovery(true);
      } else if (
        (changed || options?.fromResume) &&
        Date.now() - lastReachableAt > recentReachableWindowMs
      ) {
        void verifyConnectivity(false);
      }
    } else {
      scheduleOsOffline();
    }
  }

  const stopNetworkActivity = networkActivity?.on((status) => {
    if (disposed) {
      return;
    }
    if (status === "reachable") {
      lastReachableAt = Date.now();
      clearConfirmOfflineTimer();
      if (activeProbeMode === "verify-offline") {
        abortActiveProbe();
      }
      if (app.offline && session.mounted && !session.signingOut && hasOsNetwork()) {
        void session.setConnection(true);
      }
      return;
    }
    if (session.mounted && !app.offline && visible.value === "visible") {
      void verifyConnectivity(false);
    }
  });

  useIntervalFn(() => {
    if (
      !session.mounted ||
      app.offline ||
      visible.value !== "visible" ||
      !hasOsNetwork() ||
      Date.now() - lastReachableAt < recentReachableWindowMs
    ) {
      return;
    }
    // Catch silent network loss (such as a stalled VPN or router without upstream internet).
    void verifyConnectivity(false);
  }, onlineHeartbeatIntervalMs);

  watch(
    () => app.offline,
    (isOffline) => {
      if (isOffline) {
        clearOsOfflineTimer();
        clearConfirmOfflineTimer();
        recoveryAttempt = 0;
        scheduleRecovery(false);
      } else {
        clearRecoveryTimer();
        recoveryAttempt = 0;
        lastReachableAt = Date.now();
      }
    },
  );

  watch(online, (isOnline) => {
    if (!session.mounted) {
      return;
    }
    if (app.native && nativeOnline !== undefined) {
      void refreshNativeStatus?.();
      return;
    }
    networkRevision++;
    if (isOnline) {
      clearOsOfflineTimer();
      if (app.offline) {
        scheduleRecovery(true);
      }
    } else {
      scheduleOsOffline();
    }
  });

  watch(visible, (state) => {
    if (state !== "visible") {
      pauseBackgroundProbes();
      return;
    }
    if (!session.mounted) {
      return;
    }
    if (app.native && refreshNativeStatus) {
      if (Date.now() - lastNativeResumeAt > 1_000) {
        void refreshNativeStatus();
      }
      return;
    }
    if (app.offline && hasOsNetwork()) {
      scheduleRecovery(true);
    } else if (
      !app.offline &&
      hasOsNetwork() &&
      Date.now() - lastReachableAt > recentReachableWindowMs
    ) {
      void verifyConnectivity(false);
    }
  });

  useEventListener("storage", ({ key }) => {
    if (!app.native && key === offlineSessionKey) {
      void session.syncOfflineSession();
    }
  });
  useEventListener("pageshow", ({ persisted }) => {
    if (!app.native && persisted) {
      void session.syncOfflineSession();
    }
  });
  useEventListener("focus", () => {
    if (!app.native && session.mounted && app.offline && hasOsNetwork()) {
      scheduleRecovery(true);
    }
  });
  watch(
    () => session.userId,
    async (_, previousId) => {
      if (!previousId) {
        return;
      }
      const filters = { key: libraryKeys.user(previousId) };
      cache.cancelQueries(filters);
      for (const entry of mutations.getEntries(filters)) {
        mutations.remove(entry);
      }
      library.reset();
      app.drawerOpen = false;
      await nextTick();
      if (session.userId !== previousId) {
        for (const entry of cache.getEntries(filters)) {
          cache.remove(entry);
        }
      }
    },
    { flush: "sync" },
  );
  watch([() => session.userId, () => session.refreshing], ([id, refreshing]) => {
    if (integrationPlayback) {
      return;
    }
    if (!id) {
      void player.setOwner("");
    } else if (!refreshing) {
      void player.setOwner(id);
    }
  });

  onMounted(async () => {
    if (!app.native) {
      void session.setConnection(online.value);
      session.mounted = true;
      if (serverRendered && online.value) {
        void session.refreshAccount();
      }
      return;
    }
    try {
      const [{ Network }, { App }] = await Promise.all([
        import("@capacitor/network"),
        import("@capacitor/app"),
      ]);
      let statusRevision = 0;
      refreshNativeStatus = async () => {
        const revision = ++statusRevision;
        const status = await Network.getStatus().catch(() => undefined);
        if (disposed || revision !== statusRevision) {
          return;
        }
        handleNativeStatus(status?.connected ?? online.value, { fromResume: true });
      };
      const add = (listener: PluginListenerHandle) => {
        if (disposed) {
          void listener.remove();
        } else {
          networkListeners.push(listener);
        }
      };
      const [status] = await Promise.all([
        Network.getStatus().catch(() => undefined),
        Network.addListener("networkStatusChange", ({ connected }) => {
          statusRevision++;
          handleNativeStatus(connected);
        }).then(add),
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            lastNativeResumeAt = Date.now();
            void refreshNativeStatus?.();
          } else {
            pauseBackgroundProbes();
          }
        }).then(add),
      ]);
      if (!disposed && statusRevision === 0) {
        handleNativeStatus(status?.connected ?? online.value);
      }
    } catch {
      if (!disposed && !session.mounted) {
        void session.setConnection(online.value);
        session.mounted = true;
      }
    }
  });
  watch(
    () => session.offlineScope,
    (scope, _, onCleanup) => {
      if (!scope) {
        return;
      }
      const timer = setTimeout(() => {
        if (disposed || scope !== session.offlineScope) {
          return;
        }
        void Promise.all([import("~/utils/offline-library"), import("~/utils/offline-media")]).then(
          ([{ pruneOfflineMetadata }, { pruneOfflineMedia }]) => {
            if (!disposed && scope === session.offlineScope) {
              void Promise.allSettled([pruneOfflineMetadata(scope), pruneOfflineMedia(scope)]);
            }
          },
        );
      }, 3000);
      onCleanup(() => clearTimeout(timer));
    },
  );
  onBeforeUnmount(() => {
    disposed = true;
    stopNetworkActivity?.();
    clearOsOfflineTimer();
    pauseBackgroundProbes();
    for (const listener of networkListeners) {
      void listener.remove();
    }
    void player.setOwner("");
  });
}
