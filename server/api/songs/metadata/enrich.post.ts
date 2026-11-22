import { createError, defineEventHandler, readBody, setResponseHeader } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";
import { requireAccountSession } from "~~/server/utils/account-session";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { enrichSongMetadata } from "../../../utils/song-metadata";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default defineEventHandler(async (event) => {
  const { user } = await requireAccountSession(event, { user: { emailVerified: true } });
  setResponseHeader(event, offlineOwnerHeader, user.id);

  const body: unknown = await readBody(event);
  if (!isRecord(body)) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_METADATA" });
  }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 250) : "";
  const artist = typeof body.artist === "string" ? body.artist.trim().slice(0, 250) : "";
  if (!title || !artist) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_METADATA" });
  }
  const album = typeof body.album === "string" ? body.album.trim().slice(0, 250) || null : null;
  const year =
    typeof body.year === "number" &&
    Number.isInteger(body.year) &&
    body.year >= 1000 &&
    body.year <= 9999
      ? body.year
      : null;
  const duration =
    typeof body.duration === "number" && Number.isFinite(body.duration) && body.duration > 0
      ? body.duration
      : null;

  const config = useRuntimeConfig(event);
  return enrichSongMetadata(
    {
      title,
      artist,
      album,
      year,
      duration,
      needCredits: body.needCredits !== false,
      needLyrics: body.needLyrics !== false,
      needDescription: body.needDescription !== false,
    },
    {
      deepseekApiKey: config.deepseekApiKey,
      deepseekBaseUrl: config.deepseekBaseUrl,
      deepseekModel: config.deepseekModel,
    },
  );
});
