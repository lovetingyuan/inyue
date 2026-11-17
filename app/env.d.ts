/// <reference types="../_cloudflare/env.d.ts" />

interface InyueBuildInfo {
  readonly time?: number;
  readonly hash: string;
}

interface Window {
  readonly __INYUE_BUILD_INFO__?: InyueBuildInfo;
}
