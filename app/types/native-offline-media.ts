type OwnerScope = {
  owner: string;
  legacyScope?: string;
};

type AudioKey = OwnerScope & { id: string };
type MediaKey = AudioKey & { kind: "audio" | "cover" };
type MediaBatchKey = OwnerScope & { kind: "audio" | "cover"; ids: string[] };
type CleanOptions = {
  owner?: string;
  legacyScope?: string;
  removeScope?: boolean;
};

export interface NativeOfflineStorageInfo {
  mode: "private" | "directory";
  directoryLabel?: string;
  directoryAvailable: boolean;
  audioCount: number;
  totalBytes: number;
}

export interface PickNativeOfflineDirectoryResult extends NativeOfflineStorageInfo {
  canceled?: boolean;
  migratedCount?: number;
}

export interface NativeOfflineMediaPlugin {
  read(options: MediaKey): Promise<{ uri?: string }>;
  readMany(options: MediaBatchKey): Promise<{ uris: Record<string, string> }>;
  listAudio(options: OwnerScope): Promise<{ sources: Record<string, string> }>;
  download(options: MediaKey & { url: string; origin: string }): Promise<void>;
  removeAudio(options: AudioKey): Promise<void>;
  clean(options: CleanOptions): Promise<void>;
  getStorageInfo(options: OwnerScope): Promise<NativeOfflineStorageInfo>;
  pickDirectory(options: OwnerScope): Promise<PickNativeOfflineDirectoryResult>;
  resetDirectory(options: OwnerScope): Promise<NativeOfflineStorageInfo>;
}
