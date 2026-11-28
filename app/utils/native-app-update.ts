import { Capacitor, registerPlugin } from "@capacitor/core";
import type {
  NativeAppUpdateDownloadOptions,
  NativeAppUpdatePlugin,
  NativeAppUpdateState,
} from "~/types/native-app-update";

const nativeAppUpdate = registerPlugin<NativeAppUpdatePlugin>("AppUpdate");

export function isNativeAndroidUpdaterAvailable() {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "android" &&
    Capacitor.isPluginAvailable("AppUpdate")
  );
}

export function getNativeAppUpdateState() {
  return nativeAppUpdate.getState();
}

export function startNativeApkUpdate(options: NativeAppUpdateDownloadOptions) {
  return nativeAppUpdate.downloadAndInstall(options);
}

export function cancelNativeApkUpdate() {
  return nativeAppUpdate.cancelDownload();
}

export function installDownloadedNativeApk() {
  return nativeAppUpdate.installDownloadedApk();
}

export function listenNativeAppUpdate(listener: (state: NativeAppUpdateState) => void) {
  return nativeAppUpdate.addListener("statusChange", listener);
}
