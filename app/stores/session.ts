import { useQuery, useQueryCache } from "@pinia/colada";
import { defineStore } from "pinia";
import { offlineExpiryHeader } from "~~/shared/offline-library";
import type { Account } from "~~/shared/types/library";
import type { OfflineState } from "~/types/offline-library";
import { responseStatus } from "~/utils/library-error";
import { accountQueryKey, libraryKeys } from "~/utils/music-query-keys";

export const useSessionStore = defineStore("session", () => {
  const { request, native } = useMusicApi();
  const execute = useAccountActions();
  const app = useAppStore();
  const router = useRouter();
  const cache = useQueryCache();
  const mounted = ref(false);
  const signingOut = ref(false);
  const logoutError = ref("");
  const loginFeedback = shallowRef<{ notice: string; email?: string }>();
  const web = import.meta.client && !native;
  const offlineState = shallowRef<OfflineState>();
  const offlineReady = ref(!web);
  let connectionRevision = 0;
  let revokedScope: string | undefined;

  const accountQuery = useQuery({
    key: accountQueryKey,
    enabled: () => mounted.value && !app.offline && !signingOut.value,
    refetchOnReconnect: false,
    // Login awaits refetch(), so the retry must finish before it returns.
    retry: 0,
    query: async ({ signal }) => {
      const storage = web ? await import("~/utils/offline-library") : undefined;
      const state = await storage?.readOfflineState().catch(() => undefined);
      signal.throwIfAborted();
      try {
        const response = await request<Account>("/api/account", {
          retry: 1,
          timeout: 5000,
          signal,
        });
        const account = response._data ?? null;
        const expiresAt = Number(response.headers.get(offlineExpiryHeader));
        signal.throwIfAborted();
        if (storage && account) {
          const profile = expiresAt > Date.now() ? { account, expiresAt } : undefined;
          const verified = await storage
            .changeOfflineAccount(state?.revision, profile)
            .catch(() => undefined);
          signal.throwIfAborted();
          offlineState.value = verified?.profile?.account.id === account.id ? verified : undefined;
          if (offlineState.value?.revision !== revokedScope) revokedScope = undefined;
          if (verified?.profile && verified.profile.account.id !== account.id) return null;
        }
        return account;
      } catch (cause) {
        signal.throwIfAborted();
        const status = responseStatus(cause);
        if (status === 401 || status === 403) {
          revokedScope = state?.revision;
          offlineState.value = undefined;
          await storage?.changeOfflineAccount(state?.revision).catch(() => undefined);
          return null;
        }
        if (web && status === undefined) {
          offlineState.value = state?.revision === revokedScope ? undefined : state;
          offlineReady.value = true;
          app.offline = true;
        }
        throw cause;
      }
    },
  });
  const account = computed(() => {
    if (web && app.offline) {
      const profile = offlineState.value?.profile;
      return profile && profile.expiresAt > Date.now() ? profile.account : null;
    }
    return accountQuery.data.value ?? null;
  });
  const accountError = computed(() =>
    accountQuery.error.value && !account.value ? "暂时无法连接音乐库。" : "",
  );
  const ready = computed(
    () =>
      mounted.value &&
      (web && app.offline ? offlineReady.value : !accountQuery.isPending.value || app.offline),
  );
  const userId = computed(() => account.value?.id ?? "");
  const offlineScope = computed(() => {
    const state = offlineState.value;
    return state?.profile?.account.id === userId.value ? state?.revision : undefined;
  });
  const generation = ref(0);
  watch(
    userId,
    () => {
      generation.value++;
    },
    { flush: "sync" },
  );

  watch(
    () => offlineState.value?.profile?.expiresAt,
    (expires, _, cleanup) => {
      if (!expires) return;
      const timer = setTimeout(
        async () => {
          const previous = offlineState.value;
          if (!previous) return;
          const storage = await import("~/utils/offline-library");
          const latest = await storage.readOfflineState().catch(() => undefined);
          if (offlineState.value !== previous) return;
          if (
            latest?.revision === previous.revision &&
            latest.profile &&
            latest.profile.expiresAt > Date.now()
          ) {
            offlineState.value = latest;
            return;
          }
          offlineState.value = undefined;
          await storage.changeOfflineAccount(previous.revision).catch(() => undefined);
        },
        Math.min(2_147_483_647, Math.max(0, expires - Date.now())),
      );
      cleanup(() => clearTimeout(timer));
    },
  );

  async function setConnection(online: boolean) {
    if (!web) {
      if (!online) cache.cancelQueries({ key: accountQueryKey });
      if (app.offline && online && !signingOut.value) void accountQuery.refetch();
      app.offline = !online;
      return;
    }
    const revision = ++connectionRevision;
    if (!online) {
      cache.cancelQueries({ key: accountQueryKey });
      app.offline = true;
      const storage = await import("~/utils/offline-library");
      const state = await storage.readOfflineState().catch(() => undefined);
      if (revision !== connectionRevision) return;
      offlineState.value = state?.revision === revokedScope ? undefined : state;
      offlineReady.value = true;
    } else if (app.offline && !signingOut.value) {
      const result = await accountQuery.refetch();
      if (revision === connectionRevision && result.status === "success") {
        // Mark the online queries stale before switching keys so each refetch starts once.
        if (result.data)
          await cache.invalidateQueries({ key: libraryKeys.user(result.data.id) }, false);
        if (revision !== connectionRevision) return;
        app.offline = false;
      }
    }
  }

  async function clearOfflineAccount(scope: string | undefined) {
    revokedScope = scope;
    offlineState.value = undefined;
    if (scope) {
      const storage = await import("~/utils/offline-library");
      await storage.changeOfflineAccount(scope).catch(() => undefined);
    }
  }

  function rejectSession(id: string, revision: number) {
    if (!web || id !== userId.value || revision !== generation.value || signingOut.value) return;
    const scope = offlineScope.value;
    cache.cancelQueries({ key: accountQueryKey });
    cache.setQueryData(accountQueryKey, null);
    void clearOfflineAccount(scope);
  }

  async function syncOfflineSession() {
    const storage = await import("~/utils/offline-library");
    const state = await storage.readOfflineState().catch(() => undefined);
    if (state?.revision === offlineState.value?.revision) return;
    revokedScope = offlineState.value?.revision;
    connectionRevision++;
    cache.cancelQueries({ key: accountQueryKey });
    cache.setQueryData(accountQueryKey, null);
    offlineState.value = undefined;
    offlineReady.value = true;
    if (navigator.onLine && !signingOut.value) {
      if (app.offline) await setConnection(true);
      else await accountQuery.refetch();
    }
  }

  async function logout(releaseIntegrationPlayer?: () => Promise<void> | undefined) {
    if (signingOut.value || app.offline) return;
    const id = userId.value;
    const scope = offlineScope.value;
    signingOut.value = true;
    logoutError.value = "";
    cache.cancelQueries({ key: accountQueryKey });
    try {
      await execute({ type: "logout" });
      const releaseIntegration = releaseIntegrationPlayer?.();
      const releaseLibrary = usePlayerStore().setOwner("");
      if (id) {
        try {
          localStorage.removeItem(`music-playback:${id}`);
        } catch {
          /* Storage may be unavailable. */
        }
      }
      cache.setQueryData(accountQueryKey, null);
      await Promise.allSettled([releaseLibrary, releaseIntegration, clearOfflineAccount(scope)]);
      await router.replace("/login");
    } catch {
      logoutError.value = "操作失败，请检查网络和输入后重试。";
    } finally {
      signingOut.value = false;
    }
  }

  return {
    account,
    accountError,
    generation,
    loginFeedback,
    logout,
    logoutError,
    mounted,
    offlineScope,
    ready,
    rejectSession,
    refreshing: accountQuery.isLoading,
    refreshAccount: accountQuery.refetch,
    setConnection,
    signingOut,
    syncOfflineSession,
    userId,
  };
});
