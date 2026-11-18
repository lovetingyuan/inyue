import { Capacitor } from "@capacitor/core";
import type { NitroFetchOptions, NitroFetchRequest } from "nitropack";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { responseStatus } from "~/utils/library-error";

const sessionKey = "music-session";

export function useMusicApi() {
  const config = useRuntimeConfig().public;
  const native = Capacitor.isNativePlatform();
  const pinia = usePinia();
  const event = useRequestEvent();
  const cookie = useRequestHeader("cookie");

  function apiOrigin() {
    if (!native || (import.meta.dev && !config.mobileApiOrigin)) return "";
    try {
      const api = new URL(config.mobileApiOrigin);
      const local = config.mobileLocalTest && api.origin === "http://127.0.0.1:8794";
      if (api.href === `${api.origin}/` && (local || api.protocol === "https:")) return api.origin;
    } catch {
      // Report invalid and missing origins in the same way.
    }
    throw new Error("请配置 Android API 地址。");
  }

  async function request<T>(path: string, options?: NitroFetchOptions<NitroFetchRequest>) {
    const method = options?.method?.toUpperCase() ?? "GET";
    const publicRequest = method === "GET" && path === "/api/auth-providers";
    const library = /^\/api\/(songs|playlists|integration)(\/|$)/.test(path);
    const authorize = path === "/api/media/authorize";
    const hasOwner =
      authorize ||
      (method === "GET" && /^\/api\/(songs|playlists)(\/|$)/.test(path)) ||
      (method === "POST" && path === "/api/songs") ||
      (method === "PATCH" && path.startsWith("/api/songs/"));
    const session = import.meta.client && (library || authorize) ? useSessionStore(pinia) : undefined;
    const userId = session?.userId;
    const generation = session?.generation;
    const write = method !== "GET" && method !== "HEAD";
    const app = import.meta.client ? useAppStore(pinia) : undefined;
    if (app?.offline && (write || session)) throw new Error("当前离线。");
    const headers = new Headers(options?.headers);
    const baseURL = apiOrigin();
    const localEvent = import.meta.server && path.startsWith("/api/") ? event : undefined;
    if (localEvent && cookie) headers.set("cookie", cookie);
    if (native && !publicRequest) {
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      const token = await SecureStorage.getItem(sessionKey);
      if (token) headers.set("authorization", `Bearer ${token}`);
    }
    if (app?.offline && (write || session)) throw new Error("当前离线。");
    try {
      const response = await $fetch.raw<T>(path, {
        retry: 0,
        timeout: (native || localEvent) && method === "GET" ? 5000 : undefined,
        ...options,
        ...(localEvent ? { context: localEvent.context } : {}),
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
      // Keep request headers and API responses out of the serialized query errors.
      if (import.meta.server) throw createError({ statusCode: status ?? 503 });
      if (userId && generation !== undefined && (status === 401 || status === 403))
        session?.rejectSession(userId, generation);
      if (native && session && !options?.signal?.aborted &&
          (status === 502 || status === 503 || status === 504 ||
            (status === undefined && error instanceof Error && error.name === "FetchError")))
        void session.setConnection(false);
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

  return { apiOrigin, native, request, signIn, signOut };
}
