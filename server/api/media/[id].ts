import { useRuntimeConfig } from "nitropack/runtime";
import { createError, defineEventHandler, getQuery, getRouterParam, sendNoContent } from "h3";
import { and, eq, gt } from "drizzle-orm";
import { session, user } from "../../database/auth-schema";
import { files } from "../../database/library-schema";
import { requireAccountSession } from "../../utils/account-session";
import { libraryDatabase } from "../../utils/library";
import { verifyMedia, verifyMediaSession } from "../../utils/media-access";
import { mediaBucket } from "../../utils/media-bucket";
import { serveMedia } from "../../utils/serve-media";

export default defineEventHandler(async (event) => {
  if (!["GET", "HEAD"].includes(event.method)) {
    throw createError({ statusCode: 405 });
  }
  const id = getRouterParam(event, "id");
  if (!id) {
    return sendNoContent(event, 403);
  }
  const { sid, expires, sig } = getQuery(event);
  const db = libraryDatabase(event);
  if (typeof sid === "string" || typeof expires === "string" || typeof sig === "string") {
    const secret = useRuntimeConfig(event).mediaSigningSecret;
    const expiry = Number(expires);
    const valid =
      typeof sid === "string" &&
      typeof sig === "string" &&
      ((await verifyMediaSession(secret, sid, expiry, sig)) ||
        (await verifyMedia(secret, id, sid, expiry, sig)));
    if (!valid) {
      return sendNoContent(event, 403);
    }
    const row = await db
      .select({
        userId: user.id,
        contentType: files.contentType,
        bytes: files.bytes,
      })
      .from(session)
      .innerJoin(user, eq(user.id, session.userId))
      .leftJoin(files, and(eq(files.id, id), eq(files.ownerId, user.id), eq(files.state, "ready")))
      .where(
        and(eq(session.id, sid), gt(session.expiresAt, new Date()), eq(user.emailVerified, true)),
      )
      .get();
    if (!row) {
      return sendNoContent(event, 403);
    }
    if (!row.contentType || !row.bytes) {
      return sendNoContent(event, 404);
    }
    return serveMedia(event, mediaBucket(event), id, row.contentType, row.bytes);
  }

  let userId: string;
  try {
    const auth = await requireAccountSession(event, { user: { emailVerified: true } });
    userId = auth.user.id;
  } catch {
    return sendNoContent(event, 403);
  }
  const file = await db
    .select({
      contentType: files.contentType,
      bytes: files.bytes,
    })
    .from(files)
    .where(and(eq(files.id, id), eq(files.ownerId, userId), eq(files.state, "ready")))
    .get();
  if (!file) {
    return sendNoContent(event, 404);
  }
  return serveMedia(event, mediaBucket(event), id, file.contentType, file.bytes);
});
