import { defineEventHandler, setResponseHeader } from "h3";
import { requireAccountSession } from "~~/server/utils/account-session";
import { and, eq, sum } from "drizzle-orm";
import { account as authAccounts } from "../database/auth-schema";
import { files } from "../database/library-schema";
import { userProfiles } from "../database/profile-schema";
import { accountProfile } from "../utils/account-profile";
import { libraryDatabase, libraryQuota } from "../utils/library";
import { offlineExpiryHeader } from "~~/shared/offline-library";

export default defineEventHandler(async (event) => {
  const { user, session } = await requireAccountSession(event, { user: { emailVerified: true } });
  setResponseHeader(event, offlineExpiryHeader, String(new Date(session.expiresAt).getTime()));
  const db = libraryDatabase(event);
  const [[usage], [profile], [googleAccount]] = await db.batch([
    db
      .select({ bytes: sum(files.bytes) })
      .from(files)
      .where(eq(files.ownerId, user.id)),
    db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)),
    db
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, "google")))
      .limit(1),
  ]);
  return {
    ...accountProfile(user, profile),
    email: user.email,
    google: Boolean(googleAccount),
    storage: { usedBytes: Number(usage?.bytes ?? 0), quotaBytes: libraryQuota(event) },
  };
});
