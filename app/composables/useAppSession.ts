import { useMutationCache, useQueryCache } from "@pinia/colada";
import { useEventListener, useOnline } from "@vueuse/core";
import { offlineSessionKey } from "~~/shared/offline-library";
import { libraryKeys } from "~/utils/music-query-keys";

export function useAppSession() {
  const session = useSessionStore();
  const app = useAppStore();
  const library = useLibraryStore();
  const player = usePlayerStore();
  const cache = useQueryCache();
  const mutations = useMutationCache();
  const online = useOnline();
  const integrationPlayback = useRuntimeConfig().public.integrationPlayback;

  watch(online, (isOnline) => {
    if (session.mounted) void session.setConnection(isOnline);
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
  watch(
    [() => session.userId, () => app.offline, () => session.refreshing],
    ([id, offline, refreshing]) => {
      if (integrationPlayback) return;
      if (!id || (offline && app.native)) void player.setOwner("");
      else if (!refreshing) void player.setOwner(id);
    },
  );

  onMounted(() => {
    void session.setConnection(online.value);
    session.mounted = true;
  });
  watch(() => session.offlineScope, async (scope) => {
    if (!scope) return;
    const [{ pruneOfflineMetadata }, { pruneOfflineMedia }] = await Promise.all([
      import("~/utils/offline-library"), import("~/utils/offline-media"),
    ]);
    void Promise.allSettled([pruneOfflineMetadata(scope), pruneOfflineMedia(scope)]);
  });
  onBeforeUnmount(() => {
    void player.setOwner("");
  });
}
