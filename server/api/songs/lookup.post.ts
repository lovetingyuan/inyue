import { createError, defineEventHandler, readBody, setResponseHeader } from "h3";
import { and, eq, inArray } from "drizzle-orm";
import { requireAccountSession } from "~~/server/utils/account-session";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { songs } from "../../database/library-schema";
import { libraryDatabase } from "../../utils/library";
import { songFields } from "../../utils/library-songs";

function validIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 80 &&
    value.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id))
  );
}

export default defineEventHandler(async (event) => {
  const { user } = await requireAccountSession(event, { user: { emailVerified: true } });
  const body = await readBody<{ ids?: unknown } | null>(event);
  const ids = body?.ids ?? [];
  if (!validIds(ids)) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_SONG_IDS" });
  }
  setResponseHeader(event, offlineOwnerHeader, user.id);
  if (!ids.length) {
    return { items: [] };
  }
  const db = libraryDatabase(event);
  const items = await db
    .select(songFields)
    .from(songs)
    .where(and(eq(songs.ownerId, user.id), inArray(songs.id, ids)))
    .all();
  return { items };
});
