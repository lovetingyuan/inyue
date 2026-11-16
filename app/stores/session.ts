import { useQuery, useQueryCache } from "@pinia/colada";
import { defineStore } from "pinia";
import type { Account } from "~~/shared/types/library";
import { accountQueryKey } from "~/utils/music-query-keys";

export const useSessionStore = defineStore("session", () => {
  const { request } = useMusicApi();
  const execute = useAccountActions();
  const app = useAppStore();
  const router = useRouter();
  const cache = useQueryCache();
  const mounted = ref(false);
  const signingOut = ref(false);
  const logoutError = ref("");
  const loginFeedback = shallowRef<{ notice: string; email?: string }>();
  const accountQuery = useQuery({
    key: accountQueryKey,
    enabled: () => mounted.value && !app.offline && !signingOut.value,
    refetchOnReconnect: false,
    // Login awaits refetch(), so the retry must finish before it returns.
    retry: 0,
    query: async ({ signal }) => {
      try {
        return (await request<Account>("/api/account", { retry: 1, signal }))._data ?? null;
      } catch (cause) {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "statusCode" in cause &&
          [401, 403].includes(Number(cause.statusCode))
        ) {
          return null;
        }
        throw cause;
      }
    },
  });
  const account = computed(() => accountQuery.data.value ?? null);
  const accountError = computed(() =>
    accountQuery.error.value && !account.value ? "暂时无法连接音乐库。" : "",
  );
  const ready = computed(() => mounted.value && !accountQuery.isPending.value);
  const userId = computed(() => account.value?.id ?? "");
  const generation = ref(0);
  watch(
    userId,
    () => {
      generation.value++;
    },
    { flush: "sync" },
  );

  async function logout(releaseIntegrationPlayer?: () => Promise<void> | undefined) {
    if (signingOut.value) return;
    const id = userId.value;
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
      await Promise.allSettled([releaseLibrary, releaseIntegration]);
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
    ready,
    refreshing: accountQuery.isLoading,
    refreshAccount: accountQuery.refetch,
    signingOut,
    userId,
  };
});
