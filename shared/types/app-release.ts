export type ReleaseNoteBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string };

export interface AppReleaseInfo {
  tag: string;
  version: string;
  title: string;
  publishedAt: string | null;
  releaseUrl: string;
  apkUrl: string | null;
  apkName: string | null;
  apkSize: string | null;
  notes: ReleaseNoteBlock[];
}

export interface AppReleaseResponse {
  release: AppReleaseInfo | null;
}
