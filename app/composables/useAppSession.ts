import { useMutationCache, useQueryCache } from "@pinia/colada";
import { useOnline } from "@vueuse/core";
import { accountQueryKey, libraryKeys } from "~/utils/music-query-keys";

export function useAppSession() {
  const session = useSessionStore();
  const app = useAppStore();
  const library = useLibraryStore();
  const player = usePlayerStore();
  const cache = useQueryCache();
  const mutations = useMutationCache();
  const online = useOnline();
  const integrationPlayback = useRuntimeConfig().public.integrationPlayback;

  function updateConnection(isOnline: boolean) {
    const wasOffline = app.offline;
    if (!isOnline) cache.cancelQueries({ key: accountQueryKey });
    if (wasOffline && isOnline && !session.signingOut) void session.refreshAccount();
    app.offline = !isOnline;
  }

  watch(online, (isOnline) => {
    if (session.mounted) updateConnection(isOnline);
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
      if (!id || offline) void player.setOwner("");
      else if (!refreshing) void player.setOwner(id);
    },
  );

  onMounted(() => {
    updateConnection(online.value);
    session.mounted = true;
  });
  onBeforeUnmount(() => {
    void player.setOwner("");
  });
}
