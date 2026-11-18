import { useSessionStore } from "~/stores/session";
import { usePlayerStore } from "~/stores/player";
import { useLibraryStore } from "~/stores/library";
import { useAppStore } from "~/stores/app";
import { useMusicApi } from "~/composables/useMusicApi";
import { nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { useNuxtApp, useRuntimeConfig } from "#app";
import { useMutationCache, useQueryCache } from "@pinia/colada";
import type { PluginListenerHandle } from "@capacitor/core";
import { useDocumentVisibility, useEventListener, useIntervalFn, useOnline } from "@vueuse/core";
import { offlineSessionKey } from "~~/shared/offline-library";
import { responseStatus } from "~/utils/library-error";
import { libraryKeys } from "~/utils/music-query-keys";

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
  let nativeOnline: boolean | undefined;
  let networkRevision = 0;
  let probing = false;
  let disposed = false;
  const networkListeners: PluginListenerHandle[] = [];

  function setNativeConnection(connected: boolean) {
    if (disposed) return;
    if (nativeOnline !== connected) networkRevision++;
    nativeOnline = connected;
    if (connected) {
      if (!session.mounted || app.offline) void probeNativeApi();
    } else {
      void session.setConnection(false);
      session.mounted = true;
    }
  }

  async function probeNativeApi() {
    if (probing) return;
    const revision = networkRevision;
    probing = true;
    let reachable = true;
    try {
      await request("/api/auth-providers", { cache: "no-store", timeout: 3000 });
    } catch (error) {
      const status = responseStatus(error);
      reachable = status !== undefined && status !== 502 && status !== 503 && status !== 504;
    } finally {
      probing = false;
    }
    if (!disposed && revision === networkRevision) {
      void session.setConnection(reachable);
      session.mounted = true;
    } else if (!disposed && nativeOnline && (!session.mounted || app.offline)) {
      void probeNativeApi();
    }
  }

  useIntervalFn(() => {
    if (
      !app.native ||
      !session.mounted ||
      visible.value !== "visible" ||
      !(nativeOnline ?? online.value)
    )
      return;
    // A VPN can report a validated connection after its underlying network goes away.
    void probeNativeApi();
  }, 15_000);

  watch(online, (isOnline) => {
    if (session.mounted && (nativeOnline === undefined || !isOnline))
      void session.setConnection(isOnline);
  });
  useEventListener("storage", ({ key }) => {
    if (!app.native && key === offlineSessionKey) void session.syncOfflineSession();
  });
  useEventListener("pageshow", ({ persisted }) => {
    if (!app.native && persisted) void session.syncOfflineSession();
  });
  useEventListener("focus", () => {
    if (!app.native && app.offline && online.value) void session.setConnection(true);
  });
  watch(
    () => session.userId,
    async (_, previousId) => {
      if (!previousId) return;
      const filters = { key: libraryKeys.user(previousId) };
      cache.cancelQueries(filters);
      for (const entry of mutations.getEntries(filters)) mutations.remove(entry);
      library.reset();
      app.drawerOpen = false;
      await nextTick();
      if (session.userId !== previousId) {
        for (const entry of cache.getEntries(filters)) cache.remove(entry);
      }
    },
    { flush: "sync" },
  );
  watch([() => session.userId, () => session.refreshing], ([id, refreshing]) => {
    if (integrationPlayback) return;
    if (!id) void player.setOwner("");
    else if (!refreshing) void player.setOwner(id);
  });

  onMounted(async () => {
    if (!app.native) {
      void session.setConnection(online.value);
      session.mounted = true;
      if (serverRendered && online.value) void session.refreshAccount();
      return;
    }
    try {
      const [{ Network }, { App }] = await Promise.all([
        import("@capacitor/network"),
        import("@capacitor/app"),
      ]);
      let statusRevision = 0;
      async function refreshStatus() {
        const revision = ++statusRevision;
        const status = await Network.getStatus().catch(() => undefined);
        if (revision !== statusRevision) return;
        const connected = status?.connected ?? online.value;
        const checkApi = connected && session.mounted;
        setNativeConnection(connected);
        if (checkApi && !disposed) void probeNativeApi();
      }
      const add = (listener: PluginListenerHandle) => {
        if (disposed) void listener.remove();
        else networkListeners.push(listener);
      };
      await Promise.all([
        Network.addListener("networkStatusChange", ({ connected }) => {
          statusRevision++;
          setNativeConnection(connected);
        }).then(add),
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) void refreshStatus();
        }).then(add),
      ]);
      if (!disposed) await refreshStatus();
    } catch {
      if (!disposed && !session.mounted) {
        void session.setConnection(online.value);
        session.mounted = true;
      }
    }
  });
  watch(
    () => session.offlineScope,
    async (scope) => {
      if (!scope) return;
      const [{ pruneOfflineMetadata }, { pruneOfflineMedia }] = await Promise.all([
        import("~/utils/offline-library"),
        import("~/utils/offline-media"),
      ]);
      void Promise.allSettled([pruneOfflineMetadata(scope), pruneOfflineMedia(scope)]);
    },
  );
  onBeforeUnmount(() => {
    disposed = true;
    for (const listener of networkListeners) void listener.remove();
    void player.setOwner("");
  });
}
