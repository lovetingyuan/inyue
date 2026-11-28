import { defineEventHandler } from "h3";
import type { AppReleaseResponse } from "~~/shared/types/app-release";
import { getLatestGitHubRelease } from "../utils/github-release";

export default defineEventHandler(async (): Promise<AppReleaseResponse> => ({
  release: await getLatestGitHubRelease(),
}));
