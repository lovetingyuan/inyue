import { useRuntimeConfig } from "nitropack/runtime";
import { createError, defineEventHandler, getRequestURL, readBody, setResponseHeader } from "h3";
import { requireAccountSession } from "~~/server/utils/account-session";
import { and, eq, inArray } from "drizzle-orm";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { files, songs } from "../../database/library-schema";
import { libraryDatabase } from "../../utils/library";
import { signMedia } from "../../utils/media-access";

function validIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 80 &&
    value.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id))
  );
}

export default defineEventHandler(async (event) => {
  const auth = await requireAccountSession(event, { user: { emailVerified: true } });
  const body = await readBody<{ songIds?: unknown; coverIds?: unknown } | null>(event);
  const songIds = body?.songIds ?? [];
  const coverIds = body?.coverIds ?? [];
  if (!validIds(songIds) || !validIds(coverIds)) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_MEDIA_IDS" });
  }
  const db = libraryDatabase(event);
  const userId = auth.user.id;
  setResponseHeader(event, offlineOwnerHeader, userId);
  const [tracks, covers] = await Promise.all([
    songIds.length
      ? db
          .select({
            id: songs.id,
            title: songs.title,
            artist: songs.artist,
            album: songs.album,
            year: songs.year,
            lyrics: songs.lyrics,
            duration: songs.duration,
            audioId: songs.audioId,
            coverId: songs.coverId,
          })
          .from(songs)
          .innerJoin(files, and(eq(songs.audioId, files.id), eq(files.state, "ready")))
          .where(and(eq(songs.ownerId, userId), inArray(songs.id, songIds)))
          .all()
      : [],
    coverIds.length
      ? db
          .select({ id: files.id })
          .from(files)
          .where(
            and(
              eq(files.ownerId, userId),
              eq(files.state, "ready"),
              inArray(files.id, coverIds),
              inArray(files.contentType, ["image/jpeg", "image/png", "image/webp"]),
            ),
          )
          .all()
      : [],
  ]);
  const config = useRuntimeConfig(event);
  const expires = Date.now() + 24 * 60 * 60 * 1000;
  const sid = auth.session.id;
  async function address(id: string) {
    const sig = await signMedia(config.mediaSigningSecret, id, sid, expires);
    const url = new URL(`/api/media/${id}`, config.public.siteUrl || getRequestURL(event).origin);
    url.search = new URLSearchParams({ sid, expires: String(expires), sig }).toString();
    return url.href;
  }
  return {
    tracks: await Promise.all(
      tracks.map(async ({ audioId, coverId, ...track }) => ({
        ...track,
        coverId,
        url: await address(audioId),
        coverUrl: coverId ? await address(coverId) : null,
      })),
    ),
    covers: Object.fromEntries(
      await Promise.all(covers.map(async ({ id }) => [id, await address(id)])),
    ),
  };
});
