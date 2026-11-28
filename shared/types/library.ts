export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  lyricist: string | null;
  composer: string | null;
  description: string | null;
  lyrics: string | null;
  duration: number | null;
  audioId?: string;
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
  google?: boolean;
  storage: { usedBytes: number; quotaBytes: number };
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  lyrics: string | null;
  duration: number | null;
  audioId?: string;
  url: string;
  coverId: string | null;
  coverUrl: string | null;
}

export type PlaybackMode = "sequential" | "loop" | "single" | "shuffle";

export interface PlaybackSnapshot {
  ids: string[];
  order: string[];
  id: string;
  position: number;
  mode: PlaybackMode;
  volume: number;
  queueKey?: string;
}

export interface LrcLine {
  time: number;
  lines: string[];
}
