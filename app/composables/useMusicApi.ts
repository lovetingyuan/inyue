import { useSessionStore } from "~/stores/session";
import { useAppStore } from "~/stores/app";
import { createError, useNuxtApp, useRequestEvent, useRequestHeader, useRuntimeConfig } from "#app";
import { Capacitor } from "@capacitor/core";
import { useEventBus } from "@vueuse/core";
import type { NitroFetchOptions, NitroFetchRequest } from "nitropack";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { responseStatus } from "~/utils/library-error";
import { networkActivityEvent } from "~/utils/music-query-keys";

const sessionKey = "music-session";
let nativeToken: string | null | undefined;
let nativeTokenRead: Promise<string | null> | undefined;
let nativeTokenVersion = 0;

function readNativeToken() {
  if (nativeToken !== undefined) {
    return Promise.resolve(nativeToken);
  }
  if (!nativeTokenRead) {
    const version = nativeTokenVersion;
    nativeTokenRead = import("@aparajita/capacitor-secure-storage")
      .then(({ SecureStorage }) => SecureStorage.getItem(sessionKey))
      .then((value) => {
        const token = typeof value === "string" && value ? value : null;
        if (version === nativeTokenVersion) {
          nativeToken = token;
        }
        return token;
      })
      .finally(() => {
        nativeTokenRead = undefined;
      });
  }
  return nativeTokenRead;
}

export function useMusicApi() {
  const config = useRuntimeConfig().public;
  const native = Capacitor.isNativePlatform();
  const pinia = useNuxtApp().$pinia;
  const event = useRequestEvent();
  const cookie = useRequestHeader("cookie");
  const networkActivity = import.meta.client
    ? useEventBus<"reachable" | "unreachable">(networkActivityEvent)
    : undefined;

  function apiOrigin() {
    if (!native || (import.meta.dev && !config.mobileApiOrigin)) {
      return "";
    }
    try {
      const api = new URL(config.mobileApiOrigin);
      const local = config.mobileLocalTest && api.origin === "http://127.0.0.1:8794";
      if (api.href === `${api.origin}/` && (local || api.protocol === "https:")) {
        return api.origin;
      }
    } catch {
      // Report invalid and missing origins in the same way.
    }
    throw new Error("请配置 Android API 地址。");
  }

  async function request<T>(path: string, options?: NitroFetchOptions<NitroFetchRequest>) {
    const method = options?.method?.toUpperCase() ?? "GET";
    const isHealthProbe = path === "/api/health";
    const publicRequest =
      (method === "GET" || method === "HEAD") && (path === "/api/auth-providers" || isHealthProbe);
    const library = /^\/api\/(songs|playlists|integration)(\/|$)/.test(path);
    const hasOwner =
      (method === "GET" && /^\/api\/(songs|playlists)(\/|$)/.test(path)) ||
      (method === "POST" && (path === "/api/songs" || path === "/api/songs/lookup")) ||
      (method === "PATCH" && path.startsWith("/api/songs/"));
    const session = import.meta.client && library ? useSessionStore(pinia) : undefined;
    const userId = session?.userId;
    const generation = session?.generation;
    const write = method !== "GET" && method !== "HEAD";
    const app = import.meta.client ? useAppStore(pinia) : undefined;
    if (app?.offline && (write || session)) {
      throw new Error("当前离线。");
    }
    const headers = new Headers(options?.headers);
    const baseURL = apiOrigin();
    const localEvent = import.meta.server && path.startsWith("/api/") ? event : undefined;
    if (localEvent && cookie) {
      headers.set("cookie", cookie);
    }
    if (native && !publicRequest) {
      const token = await readNativeToken();
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
    }
    if (app?.offline && (write || session)) {
      throw new Error("当前离线。");
    }
    try {
      const response = await globalThis.$fetch.raw<T>(path, {
        retry: 0,
        timeout: method === "GET" ? (localEvent ? 5000 : native ? 10_000 : undefined) : undefined,
        ...options,
        ...(localEvent ? { context: localEvent.context } : {}),
        headers,
        baseURL,
        credentials: native ? "omit" : "same-origin",
      });
      if (!isHealthProbe) {
        networkActivity?.emit("reachable");
      }
      if (session && userId && generation !== undefined) {
        if (session.generation !== generation) {
          throw new DOMException("Account changed", "AbortError");
        }
        if (hasOwner && response.headers.get(offlineOwnerHeader) !== userId) {
          session.rejectSession(userId, generation);
          throw new Error("登录状态已变化，请重新登录。");
        }
      }
      return response;
    } catch (error) {
      const status = responseStatus(error);
      // Keep request headers and API responses out of the serialized query errors.
      if (import.meta.server) {
        throw createError({ statusCode: status ?? 503 });
      }
      if (userId && generation !== undefined && (status === 401 || status === 403)) {
        session?.rejectSession(userId, generation);
      }
      if (!isHealthProbe && !options?.signal?.aborted) {
        if (status !== undefined && status !== 502 && status !== 503 && status !== 504) {
          networkActivity?.emit("reachable");
        } else if (
          status === 502 ||
          status === 503 ||
          status === 504 ||
          (status === undefined && error instanceof Error && error.name === "FetchError")
        ) {
          networkActivity?.emit("unreachable");
        }
      }
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
      if (!token) {
        throw new Error("登录响应缺少会话凭据。");
      }
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      nativeTokenVersion++;
      nativeToken = token;
      try {
        await SecureStorage.setItem(sessionKey, token);
      } catch (error) {
        nativeTokenVersion++;
        nativeToken = undefined;
        throw error;
      }
    }
  }

  async function signOut() {
    await request("/api/auth/sign-out", { method: "POST", body: {} });
    if (native) {
      const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
      nativeTokenVersion++;
      nativeToken = null;
      try {
        await SecureStorage.removeItem(sessionKey);
      } catch (error) {
        nativeTokenVersion++;
        nativeToken = undefined;
        throw error;
      }
    }
  }

  function mediaUrl(fileId: string) {
    if (!fileId) {
      return "";
    }
    if (!native) {
      return import.meta.client
        ? new URL(`/api/media/${fileId}`, location.origin).href
        : `/api/media/${fileId}`;
    }
    const session = useSessionStore(pinia);
    session.ensureFreshMediaAuth();
    const query = session.mediaAuth;
    if (!query || (session.mediaAuthExpires && session.mediaAuthExpires <= Date.now() + 30_000)) {
      return "";
    }
    const origin = apiOrigin() || location.origin;
    return `${origin}/api/media/${fileId}?${query}`;
  }

  return { apiOrigin, mediaUrl, native, request, signIn, signOut };
}
