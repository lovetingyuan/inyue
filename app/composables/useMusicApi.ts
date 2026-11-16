import { Capacitor } from "@capacitor/core";
import type { NitroFetchOptions, NitroFetchRequest } from "nitropack";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { responseStatus } from "~/utils/library-error";

const sessionKey = "music-session";

export function useMusicApi() {
  const config = useRuntimeConfig().public;
  const native = Capacitor.isNativePlatform();
  const pinia = usePinia();

  async function request<T>(path: string, options?: NitroFetchOptions<NitroFetchRequest>) {
    const headers = new Headers(options?.headers);
    let baseURL = "";
    if (native) {
      if (!import.meta.dev || config.mobileApiOrigin) {
        try {
          const api = new URL(config.mobileApiOrigin);
          const local = config.mobileLocalTest && api.origin === "http://127.0.0.1:8794";
          if (api.href !== `${api.origin}/` || (!local && api.protocol !== "https:"))
            throw new Error();
          baseURL = api.origin;
        } catch {
          throw new Error("请配置 Android API 地址。");
        }
      }
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      const token = await SecureStorage.getItem(sessionKey);
      if (token) headers.set("authorization", `Bearer ${token}`);
    }
    const method = options?.method?.toUpperCase() ?? "GET";
    const library = /^\/api\/(songs|playlists|integration)(\/|$)/.test(path);
    const authorize = path === "/api/media/authorize";
    const hasOwner =
      authorize ||
      (method === "GET" && /^\/api\/(songs|playlists)(\/|$)/.test(path)) ||
      (method === "POST" && path === "/api/songs") ||
      (method === "PATCH" && path.startsWith("/api/songs/"));
    const session =
      import.meta.client && !native && (library || authorize) ? useSessionStore(pinia) : undefined;
    const userId = session?.userId;
    const generation = session?.generation;
    if (session && useAppStore(pinia).offline) throw new Error("当前离线。");
    try {
      const response = await $fetch.raw<T>(path, {
        retry: 0,
        ...options,
        headers,
        baseURL,
        credentials: native ? "omit" : "same-origin",
      });
      if (session && userId && generation !== undefined) {
        if (session.generation !== generation)
          throw new DOMException("Account changed", "AbortError");
        if (hasOwner && response.headers.get(offlineOwnerHeader) !== userId) {
          session.rejectSession(userId, generation);
          throw new Error("登录状态已变化，请重新登录。");
        }
      }
      return response;
    } catch (error) {
      const status = responseStatus(error);
      if (userId && generation !== undefined && (status === 401 || status === 403))
        session?.rejectSession(userId, generation);
      throw error;
    }
  }

  async function signIn(
    body: { email: string; password: string } | { provider: "google"; idToken: { token: string } },
  ) {
    const endpoint = "provider" in body ? "social" : "email";
    const response = await request(`/api/auth/sign-in/${endpoint}`, { method: "POST", body });
    if (native) {
      const token = response.headers.get("set-auth-token");
      if (!token) throw new Error("登录响应缺少会话凭据。");
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      await SecureStorage.setItem(sessionKey, token);
    }
  }

  async function signOut() {
    await request("/api/auth/sign-out", { method: "POST", body: {} });
    if (native) {
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      await SecureStorage.removeItem(sessionKey);
    }
  }

  return { native, request, signIn, signOut };
}
