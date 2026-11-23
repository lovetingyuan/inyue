export type ItunesCountry = "hk" | "us";

export interface SongMetadataCandidate {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  duration: number | null;
  artworkUrl: string | null;
  coverUrl: string | null;
}

export interface SongMetadataSearchResult {
  items: SongMetadataCandidate[];
  unavailable?: boolean;
}

export interface SongMetadataEnrichRequest {
  title: string;
  artist: string;
  album?: string | null;
  year?: number | null;
  duration?: number | null;
  needCredits?: boolean;
  needLyrics?: boolean;
  needDescription?: boolean;
}

export interface SongMetadataEnrichResult {
  lyricist: string | null;
  composer: string | null;
  description: string | null;
  lyrics: string | null;
}
