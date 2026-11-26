export const accountQueryKey = ["account"] as const;
export const offlineAudioChanged = "offline-audio-changed";
export const networkActivityEvent = "network-activity";

export const libraryKeys = {
  user: (userId: string) => ["library", userId] as const,
  playlists: (userId: string) => ["library", userId, "playlists"] as const,
  songs: (userId: string) => ["library", userId, "songs"] as const,
  songPages: (userId: string, filters: { playlist: string; q: string }) =>
    ["library", userId, "songs", "pages", filters] as const,
  details: (userId: string) => ["library", userId, "song"] as const,
  song: (userId: string, songId: string) => ["library", userId, "song", songId] as const,
};
