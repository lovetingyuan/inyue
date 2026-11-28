import type { PluginListenerHandle } from "@capacitor/core";

export type NativeAppUpdateStatus =
  | "idle"
  | "downloading"
  | "completed"
  | "installing"
  | "permission_required"
  | "error";

export interface NativeAppUpdateState {
  status: NativeAppUpdateStatus;
  version: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  message?: string;
}

export interface NativeAppUpdateDownloadOptions {
  url: string;
  version: string;
  fileName?: string;
}

export interface NativeAppUpdatePlugin {
  getState(): Promise<NativeAppUpdateState>;
  downloadAndInstall(options: NativeAppUpdateDownloadOptions): Promise<NativeAppUpdateState>;
  cancelDownload(): Promise<NativeAppUpdateState | void>;
  installDownloadedApk(): Promise<NativeAppUpdateState>;
  addListener(
    eventName: "statusChange",
    listenerFunc: (state: NativeAppUpdateState) => void,
  ): Promise<PluginListenerHandle>;
}
