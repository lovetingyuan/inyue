import { desc, eq } from "drizzle-orm";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { playlists } from "../../database/library-schema";
import { libraryDatabase } from "../../utils/library";
import { playlistFields } from "../../utils/library-playlists";

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event, { user: { emailVerified: true } });
  setResponseHeader(event, offlineOwnerHeader, user.id);
  return libraryDatabase(event)
    .select(playlistFields)
    .from(playlists)
    .where(eq(playlists.ownerId, user.id))
    .orderBy(desc(playlists.createdAt), desc(playlists.id))
    .all();
});
