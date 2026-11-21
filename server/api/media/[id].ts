import { useRuntimeConfig } from "nitropack/runtime";
import { createError, defineEventHandler, getQuery, getRouterParam, sendNoContent } from "h3";
import { and, eq, gt } from "drizzle-orm";
import { session, user } from "../../database/auth-schema";
import { files } from "../../database/library-schema";
import { libraryDatabase } from "../../utils/library";
import { verifyMedia } from "../../utils/media-access";
import { mediaBucket } from "../../utils/media-bucket";
import { serveMedia } from "../../utils/serve-media";

export default defineEventHandler(async (event) => {
  if (!["GET", "HEAD"].includes(event.method)) {
    throw createError({ statusCode: 405 });
  }
  const id = getRouterParam(event, "id");
  const { sid, expires, sig } = getQuery(event);
  if (
    !id ||
    typeof sid !== "string" ||
    typeof expires !== "string" ||
    typeof sig !== "string" ||
    !(await verifyMedia(useRuntimeConfig(event).mediaSigningSecret, id, sid, Number(expires), sig))
  ) {
    return sendNoContent(event, 403);
  }
  const db = libraryDatabase(event);
  const row = await db
    .select({
      userId: user.id,
      contentType: files.contentType,
      bytes: files.bytes,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .leftJoin(files, and(eq(files.id, id), eq(files.ownerId, user.id), eq(files.state, "ready")))
    .where(and(eq(session.id, sid), gt(session.expiresAt, new Date()), eq(user.emailVerified, true)))
    .get();
  if (!row) {
    return sendNoContent(event, 403);
  }
  if (!row.contentType || !row.bytes) {
    return sendNoContent(event, 404);
  }
  return serveMedia(event, mediaBucket(event), id, row.contentType, row.bytes);
});
