import { usePlayerStore } from "~/stores/player";
import { useAppStore } from "~/stores/app";
import { useMusicApi } from "~/composables/useMusicApi";
import { useAccountActions } from "~/composables/useAccountActions";
import { computed, ref, shallowRef, watch } from "vue";
import { useRouter } from "#app";
import { useQuery, useQueryCache } from "@pinia/colada";
import { defineStore } from "pinia";
import { mediaAuthHeader, offlineExpiryHeader } from "~~/shared/offline-library";
import type { Account, AccountProfile } from "~~/shared/types/library";
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
  const offlineState = shallowRef<OfflineState>();
  const offlineReady = ref(false);
  const mediaAuth = ref("");
  const mediaAuthExpires = ref(0);
  let connectionRevision = 0;
  let reconnect: Promise<void> | undefined;
  let revokedScope: string | undefined;

  function clearMediaAuth() {
    mediaAuth.value = "";
    mediaAuthExpires.value = 0;
  }

  function updateMediaAuth(raw: string | null) {
    if (!raw) {
      if (!native) {
        clearMediaAuth();
      }
      return;
    }
    const expires = Number(new URLSearchParams(raw).get("expires"));
    if (Number.isFinite(expires) && expires > Date.now()) {
      mediaAuth.value = raw;
      mediaAuthExpires.value = expires;
    }
  }

  const accountQuery = useQuery({
    key: accountQueryKey,
    enabled: () => mounted.value && !app.offline && !signingOut.value,
    refetchOnReconnect: false,
    // Login awaits refetch(), so the retry must finish before it returns.
    retry: 0,
    query: async ({ signal }) => {
      const offlinePromise = import.meta.client
        ? import("~/utils/offline-library").then(async (storage) => ({
            storage,
            state: await storage.readOfflineState().catch(() => undefined),
          }))
        : undefined;
      try {
        const [response, offline] = await Promise.all([
          request<Account>("/api/account", {
            cache: "no-store",
            retry: app.offline ? 0 : 1,
            timeout: 8000,
            signal,
          }),
          offlinePromise,
        ]);
        const account = response._data ?? null;
        const expiresAt = Number(response.headers.get(offlineExpiryHeader));
        signal.throwIfAborted();
        if (account) {
          updateMediaAuth(response.headers.get(mediaAuthHeader));
        } else {
          clearMediaAuth();
        }
        if (offline && account) {
          const profile = native || expiresAt > Date.now() ? { account, expiresAt } : undefined;
          const verified = await offline.storage
            .changeOfflineAccount(offline.state?.revision, profile)
            .catch(() => undefined);
          signal.throwIfAborted();
          offlineState.value = verified?.profile?.account.id === account.id ? verified : undefined;
          if (offlineState.value) {
            offlineReady.value = true;
          }
          if (offlineState.value?.revision !== revokedScope) {
            revokedScope = undefined;
          }
          if (verified?.profile && verified.profile.account.id !== account.id) {
            return null;
          }
        }
        return account;
      } catch (cause) {
        signal.throwIfAborted();
        const offline = await offlinePromise;
        signal.throwIfAborted();
        const status = responseStatus(cause);
        if (status === 401 || status === 403) {
          clearMediaAuth();
          revokedScope = offline?.state?.revision;
          offlineState.value = undefined;
          await offline?.storage
            .changeOfflineAccount(offline.state?.revision)
            .catch(() => undefined);
          return null;
        }
        if (
          offline &&
          accountQuery.data.value === undefined &&
          (status === undefined || status === 502 || status === 503 || status === 504)
        ) {
          offlineState.value = offline.state?.revision === revokedScope ? undefined : offline.state;
          offlineReady.value = true;
          app.offline = true;
        }
        throw cause;
      }
    },
  });
  const account = computed(() => {
    if (app.offline) {
      const profile = offlineState.value?.profile;
      return profile && (native || profile.expiresAt > Date.now()) ? profile.account : null;
    }
    return accountQuery.data.value ?? null;
  });
  const accountError = computed(() =>
    accountQuery.error.value && !account.value ? "暂时无法连接音乐库。" : "",
  );
  const ready = computed(() =>
    app.offline ? mounted.value && offlineReady.value : !accountQuery.isPending.value,
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
      if (native || !expires) {
        return;
      }
      const timer = setTimeout(
        async () => {
          const previous = offlineState.value;
          if (!previous) {
            return;
          }
          const storage = await import("~/utils/offline-library");
          const latest = await storage.readOfflineState().catch(() => undefined);
          if (offlineState.value !== previous) {
            return;
          }
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
    if (!online) {
      if (app.offline && !reconnect && offlineReady.value) {
        return;
      }
      const revision = ++connectionRevision;
      reconnect = undefined;
      cache.cancelQueries({ key: accountQueryKey });
      app.offline = true;
      const storage = await import("~/utils/offline-library");
      const state = await storage.readOfflineState().catch(() => undefined);
      if (revision !== connectionRevision) {
        return;
      }
      offlineState.value = state?.revision === revokedScope ? undefined : state;
      offlineReady.value = true;
    } else if (app.offline && !signingOut.value) {
      if (reconnect) {
        return reconnect;
      }
      const revision = ++connectionRevision;
      const attempt = accountQuery
        .refetch()
        .then(async (result) => {
          if (revision !== connectionRevision || result.status !== "success") {
            return;
          }
          if (result.data) {
            await cache.invalidateQueries({ key: libraryKeys.user(result.data.id) }, false);
          }
          if (revision === connectionRevision) {
            app.offline = false;
          }
        })
        .finally(() => {
          if (reconnect === attempt) {
            reconnect = undefined;
          }
        });
      reconnect = attempt;
      return attempt;
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
    if (id !== userId.value || revision !== generation.value || signingOut.value) {
      return;
    }
    clearMediaAuth();
    const scope = offlineScope.value;
    cache.cancelQueries({ key: accountQueryKey });
    cache.setQueryData(accountQueryKey, null);
    void clearOfflineAccount(scope);
  }

  async function saveAccountProfile(id: string, body: FormData) {
    const revision = generation.value;
    const scope = offlineScope.value;
    if (userId.value !== id || signingOut.value) {
      throw new DOMException("Account changed", "AbortError");
    }
    body.set("accountId", id);
    const { _data: profile, headers } = await request<AccountProfile>("/api/account", {
      method: "PATCH",
      body,
      timeout: 15_000,
    });
    const current = account.value;
    if (
      current?.id !== id ||
      profile?.id !== id ||
      revision !== generation.value ||
      signingOut.value
    ) {
      throw new DOMException("Account changed", "AbortError");
    }

    const updated = { ...current, ...profile };
    cache.cancelQueries({ key: accountQueryKey });
    cache.setQueryData(accountQueryKey, updated);
    const expiresAt = Number(headers.get(offlineExpiryHeader));
    if (native || expiresAt > Date.now()) {
      const storage = await import("~/utils/offline-library");
      if (revision !== generation.value || signingOut.value) {
        return;
      }
      const saved = await storage
        .changeOfflineAccount(scope, { account: updated, expiresAt })
        .catch(() => undefined);
      if (revision === generation.value && !signingOut.value && saved?.profile?.account.id === id) {
        offlineState.value = saved;
        if (saved.revision !== revokedScope) {
          revokedScope = undefined;
        }
      }
    }
  }

  async function syncOfflineSession() {
    const storage = await import("~/utils/offline-library");
    const state = await storage.readOfflineState().catch(() => undefined);
    if (state?.revision === offlineState.value?.revision) {
      return;
    }
    revokedScope = offlineState.value?.revision;
    clearMediaAuth();
    connectionRevision++;
    reconnect = undefined;
    cache.cancelQueries({ key: accountQueryKey });
    cache.setQueryData(accountQueryKey, null);
    offlineState.value = undefined;
    offlineReady.value = true;
    if (navigator.onLine && !signingOut.value) {
      if (app.offline) {
        await setConnection(true);
      } else {
        await accountQuery.refetch();
      }
    }
  }

  async function logout(releaseIntegrationPlayer?: () => Promise<void> | undefined) {
    if (signingOut.value || app.offline) {
      return;
    }
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
      clearMediaAuth();
      cache.setQueryData(accountQueryKey, null);
      await Promise.allSettled([releaseLibrary, releaseIntegration, clearOfflineAccount(scope)]);
      await router.replace("/login");
    } catch {
      logoutError.value = "操作失败，请检查网络和输入后重试。";
    } finally {
      signingOut.value = false;
    }
  }

  function ensureFreshMediaAuth() {
    if (
      !native ||
      app.offline ||
      signingOut.value ||
      accountQuery.isLoading.value ||
      !userId.value
    ) {
      return;
    }
    if (!mediaAuth.value || mediaAuthExpires.value <= Date.now() + 60 * 60 * 1000) {
      void accountQuery.refetch();
    }
  }

  return {
    account,
    accountError,
    ensureFreshMediaAuth,
    generation,
    loginFeedback,
    logout,
    logoutError,
    mediaAuth,
    mediaAuthExpires,
    mounted,
    offlineScope,
    ready,
    rejectSession,
    refreshing: accountQuery.isLoading,
    refreshAccount: accountQuery.refetch,
    saveAccountProfile,
    setConnection,
    signingOut,
    syncOfflineSession,
    userId,
  };
});
