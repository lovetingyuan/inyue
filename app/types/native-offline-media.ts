type Scope = { scope: string };
type AudioKey = Scope & { id: string };
type MediaKey = AudioKey & { kind: "audio" | "cover" };

export interface NativeOfflineMediaPlugin {
  read(options: MediaKey): Promise<{ uri?: string }>;
  listAudio(options: Scope): Promise<{ sources: Record<string, string> }>;
  download(options: MediaKey & { url: string; origin: string }): Promise<void>;
  removeAudio(options: AudioKey): Promise<void>;
  clean(options: Scope & { removeScope?: boolean }): Promise<void>;
}
