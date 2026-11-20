export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  lyricist: string | null;
  composer: string | null;
  description: string | null;
  duration: number | null;
  coverId: string | null;
  createdAt: number;
}

export interface SongPage {
  items: SongDetails[];
  nextOffset: number | null;
  total?: number;
}

export interface Playlist {
  id: string;
  name: string;
  coverId: string | null;
}

export interface SongDetails extends Song {
  playlistIds: string[];
}

export interface AccountProfile {
  id: string;
  name: string;
  image?: string | null;
  hasCustomAvatar?: boolean;
}

export interface Account extends AccountProfile {
  email: string;
  storage: { usedBytes: number; quotaBytes: number };
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  duration: number | null;
  url: string;
  coverId: string | null;
  coverUrl: string | null;
}

export interface MediaAuthorization {
  tracks: Track[];
  covers: Record<string, string>;
}

export type PlaybackMode = "sequential" | "loop" | "shuffle";

export interface PlaybackSnapshot {
  ids: string[];
  order: string[];
  id: string;
  position: number;
  mode: PlaybackMode;
  volume: number;
  queueKey?: string;
}
