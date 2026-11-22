import { defineEventHandler, getQuery, setResponseHeader } from "h3";
import { requireAccountSession } from "~~/server/utils/account-session";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { searchSongMetadata } from "../../../utils/song-metadata";

export default defineEventHandler(async (event) => {
  const { user } = await requireAccountSession(event, { user: { emailVerified: true } });
  setResponseHeader(event, offlineOwnerHeader, user.id);
  const query = getQuery(event);
  const raw = typeof query.q === "string" ? query.q.trim() : "";
  if (!raw) {
    return { items: [] };
  }
  return searchSongMetadata(raw.slice(0, 120));
});
