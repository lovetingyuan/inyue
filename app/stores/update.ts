import { computed, ref, shallowRef, watch } from "vue";
import { useRuntimeConfig } from "#app";
import type { PluginListenerHandle } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { defineStore } from "pinia";
import { isNewerVersion, normalizeVersion } from "~~/shared/app-version";
import type { AppReleaseInfo, AppReleaseResponse } from "~~/shared/types/app-release";
import { useMusicApi } from "~/composables/useMusicApi";
import { useAppStore } from "~/stores/app";
import type { NativeAppUpdateState } from "~/types/native-app-update";

const checkCooldownMs = 30 * 60_000;

const idleDownloadState: NativeAppUpdateState = {
  status: "idle",
  version: "",
  downloadedBytes: 0,
  totalBytes: -1,
  percent: -1,
};

export const useUpdateStore = defineStore("update", () => {
  const config = useRuntimeConfig().public;
  const app = useAppStore();
  const { request } = useMusicApi();

  const currentVersion = ref(normalizeVersion(config.appVersion));
  const latestRelease = shallowRef<AppReleaseInfo | null>(null);
  const checking = ref(false);
  const downloadState = shallowRef<NativeAppUpdateState>({ ...idleDownloadState });

  let initialized = false;
  let lastCheckedAt = 0;
  let nativeVersionLoaded = false;
  let statusListener: PluginListenerHandle | undefined;

  const isAndroidNative = computed(
    () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android",
  );

  const hasUpdate = computed(() =>
    Boolean(
      latestRelease.value && isNewerVersion(latestRelease.value.version, currentVersion.value),
    ),
  );

  const downloading = computed(() => downloadState.value.status === "downloading");

  const readyToInstall = computed(
    () =>
      isAndroidNative.value &&
      downloadState.value.version === latestRelease.value?.version &&
      (downloadState.value.status === "completed" ||
        downloadState.value.status === "installing" ||
        downloadState.value.status === "permission_required"),
  );

  async function loadCurrentVersion() {
    if (nativeVersionLoaded || !Capacitor.isNativePlatform()) {
      return;
    }
    nativeVersionLoaded = true;
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      if (info.version) {
        currentVersion.value = normalizeVersion(info.version);
      }
    } catch {
      // Fall back to the bundled package version.
    }
  }

  async function attachNativeUpdater() {
    if (!isAndroidNative.value || statusListener) {
      return;
    }
    try {
      const {
        getNativeAppUpdateState,
        isNativeAndroidUpdaterAvailable,
        listenNativeAppUpdate,
      } = await import("~/utils/native-app-update");
      if (!isNativeAndroidUpdaterAvailable()) {
        return;
      }
      statusListener = await listenNativeAppUpdate((state) => {
        downloadState.value = state;
      });
      const state = await getNativeAppUpdateState();
      downloadState.value = state;
    } catch {
      // Ignore if native updater bridge is unavailable.
    }
  }

  async function checkForUpdate(force = false) {
    if (!import.meta.client || app.offline || checking.value) {
      return;
    }
    if (!force && lastCheckedAt > 0 && Date.now() - lastCheckedAt < checkCooldownMs) {
      return;
    }
    checking.value = true;
    try {
      await loadCurrentVersion();
      const { _data } = await request<AppReleaseResponse>("/api/app-release", {
        cache: "no-store",
      });
      latestRelease.value = _data?.release ?? null;
      lastCheckedAt = Date.now();
    } catch {
      // Update checks are best-effort and must not disrupt playback or offline state.
    } finally {
      checking.value = false;
    }
  }

  async function init() {
    if (!import.meta.client || initialized) {
      return;
    }
    initialized = true;
    await Promise.all([loadCurrentVersion(), attachNativeUpdater()]);
    if (!app.offline) {
      void checkForUpdate();
    }
  }

  async function downloadUpdate() {
    const release = latestRelease.value;
    if (!release?.apkUrl) {
      return;
    }
    if (isAndroidNative.value) {
      try {
        const { isNativeAndroidUpdaterAvailable, startNativeApkUpdate } =
          await import("~/utils/native-app-update");
        if (isNativeAndroidUpdaterAvailable()) {
          downloadState.value = await startNativeApkUpdate({
            url: release.apkUrl,
            version: release.version,
            fileName: release.apkName ?? undefined,
          });
          return;
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "下载更新失败，请稍后重试。";
        downloadState.value = {
          status: "error",
          version: release.version,
          downloadedBytes: 0,
          totalBytes: -1,
          percent: -1,
          message,
        };
        app.showToast(message, { tone: "error" });
        return;
      }
    }

    const link = document.createElement("a");
    link.href = release.apkUrl;
    link.rel = "noopener noreferrer";
    if (release.apkName) {
      link.download = release.apkName;
    }
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function installUpdate() {
    if (!isAndroidNative.value) {
      return;
    }
    try {
      const { installDownloadedNativeApk } = await import("~/utils/native-app-update");
      downloadState.value = await installDownloadedNativeApk();
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "无法启动安装程序，请重新下载。";
      downloadState.value = {
        ...downloadState.value,
        status: "error",
        message,
      };
      app.showToast(message, { tone: "error" });
    }
  }

  async function cancelUpdate() {
    if (!isAndroidNative.value) {
      return;
    }
    try {
      const { cancelNativeApkUpdate } = await import("~/utils/native-app-update");
      await cancelNativeApkUpdate();
    } catch {
      // Ignore cancellation errors if the download already ended.
    }
  }

  if (import.meta.client) {
    watch(
      () => app.offline,
      (isOffline) => {
        if (!isOffline && initialized && !latestRelease.value) {
          void checkForUpdate();
        }
      },
    );
  }

  return {
    currentVersion,
    latestRelease,
    checking,
    downloadState,
    isAndroidNative,
    hasUpdate,
    downloading,
    readyToInstall,
    init,
    checkForUpdate,
    downloadUpdate,
    installUpdate,
    cancelUpdate,
  };
});
