import { defineEventHandler, setResponseHeader } from "h3";
import { requireUserSession } from "#better-auth-session";
import { eq, sum } from "drizzle-orm";
import { files } from "../database/library-schema";
import { userProfiles } from "../database/profile-schema";
import { accountProfile } from "../utils/account-profile";
import { libraryDatabase, libraryQuota } from "../utils/library";
import { offlineExpiryHeader } from "~~/shared/offline-library";

export default defineEventHandler(async (event) => {
  const { user, session } = await requireUserSession(event, { user: { emailVerified: true } });
  setResponseHeader(event, offlineExpiryHeader, String(new Date(session.expiresAt).getTime()));
  const db = libraryDatabase(event);
  const [[usage], [profile]] = await db.batch([
    db
      .select({ bytes: sum(files.bytes) })
      .from(files)
      .where(eq(files.ownerId, user.id)),
    db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)),
  ]);
  return {
    ...accountProfile(user, profile),
    email: user.email,
    storage: { usedBytes: Number(usage?.bytes ?? 0), quotaBytes: libraryQuota(event) },
  };
});
