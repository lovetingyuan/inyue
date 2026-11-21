import { createError, defineEventHandler, getRouterParam, setResponseHeader } from "h3";
import { requireAccountSession } from "~~/server/utils/account-session";
import { memberships, songs } from "../../database/library-schema";
import { and, eq } from "drizzle-orm";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { libraryDatabase } from "../../utils/library";
import { songFields, songOwner } from "../../utils/library-songs";

export default defineEventHandler(async (event) => {
  const { user } = await requireAccountSession(event, { user: { emailVerified: true } });
  setResponseHeader(event, offlineOwnerHeader, user.id);
  const db = libraryDatabase(event);
  const id = getRouterParam(event, "id") ?? "";
  const [[song], rows] = await db.batch([
    db.select(songFields).from(songs).where(songOwner(user.id, id)),
    db
      .select({ id: memberships.playlistId })
      .from(memberships)
      .where(and(eq(memberships.ownerId, user.id), eq(memberships.songId, id))),
  ]);
  if (!song) {
    throw createError({ statusCode: 404, statusMessage: "SONG_NOT_FOUND" });
  }
  return { ...song, playlistIds: rows.map((row) => row.id) };
});
