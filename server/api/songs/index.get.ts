import { createError, defineEventHandler, getQuery, setResponseHeader } from "h3";
import { requireUserSession } from "#better-auth-session";
import { and, desc, eq, exists, inArray, notExists, or, sql } from "drizzle-orm";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import type { SongDetails } from "~~/shared/types/library";
import { memberships, playlists, songs } from "../../database/library-schema";
import { libraryDatabase } from "../../utils/library";
import { songFields } from "../../utils/library-songs";

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event, { user: { emailVerified: true } });
  setResponseHeader(event, offlineOwnerHeader, user.id);
  const db = libraryDatabase(event);
  const query = getQuery(event);
  const term = typeof query.q === "string" ? query.q.trim().slice(0, 250).toLowerCase() : "";
  const filter = typeof query.playlist === "string" ? query.playlist : "";
  const offset = Number(query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw createError({ statusCode: 400, statusMessage: "INVALID_OFFSET" });
  const membership = db
    .select({ id: memberships.songId })
    .from(memberships)
    .where(
      and(
        eq(memberships.songId, songs.id),
        eq(memberships.ownerId, user.id),
        filter && filter !== "default" ? eq(memberships.playlistId, filter) : undefined,
      ),
    );
  if (
    filter &&
    filter !== "default" &&
    !(await db
      .select({ id: playlists.id })
      .from(playlists)
      .where(and(eq(playlists.id, filter), eq(playlists.ownerId, user.id)))
      .get())
  ) {
    throw createError({ statusCode: 404, statusMessage: "PLAYLIST_NOT_FOUND" });
  }
  const where = and(
    eq(songs.ownerId, user.id),
    term
      ? or(
          ...[songs.title, songs.artist, songs.album].map(
            (column) => sql`instr(lower(${column}), ${term}) > 0`,
          ),
        )
      : undefined,
    filter === "default" ? notExists(membership) : filter ? exists(membership) : undefined,
  );
  const order = [desc(songs.createdAt), desc(songs.id)];
  if (query.ids === "true") {
    const ids = await db
      .select({ id: songs.id })
      .from(songs)
      .where(where)
      .orderBy(...order)
      .all();
    return { ids: ids.map(({ id }) => id), items: [], nextOffset: null };
  }
  const page = await db
    .select(songFields)
    .from(songs)
    .where(where)
    .orderBy(...order)
    .limit(51)
    .offset(offset)
    .all();
  const nextOffset = page.length > 50 ? offset + 50 : null;
  const total =
    term && offset === 0
      ? nextOffset === null
        ? page.length
        : await db.$count(songs, where)
      : undefined;
  const items = page.slice(0, 50);
  const bySong = new Map<string, SongDetails>(items.map((song) => [song.id, { ...song, playlistIds: [] }]));
  if (items.length) {
    const rows = await db
      .select({ songId: memberships.songId, playlistId: memberships.playlistId })
      .from(memberships)
      .where(and(eq(memberships.ownerId, user.id), inArray(memberships.songId, [...bySong.keys()])))
      .all();
    for (const row of rows) bySong.get(row.songId)?.playlistIds.push(row.playlistId);
  }
  return { items: [...bySong.values()], nextOffset, total };
});
