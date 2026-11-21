import { createError, defineEventHandler, setResponseHeader } from "h3";
import { requireAccountSession } from "~~/server/utils/account-session";
import { userProfiles } from "../database/profile-schema";
import { accountProfile, isAvatarJpeg } from "../utils/account-profile";
import { libraryDatabase } from "../utils/library";
import { uploadForm } from "../utils/library-upload";
import { avatarMaxBytes, isProfileName } from "~~/shared/account-profile";
import { offlineExpiryHeader } from "~~/shared/offline-library";

const profileFields = new Set(["accountId", "name", "avatar", "resetAvatar"]);

export default defineEventHandler(async (event) => {
  const { user, session } = await requireAccountSession(event, { user: { emailVerified: true } });
  const form = await uploadForm(event, avatarMaxBytes + 8 * 1024);
  const account = form.get("accountId");
  if (
    !account ||
    account.filename !== undefined ||
    [...form.keys()].some((key) => !key || !profileFields.has(key))
  ) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_FORM" });
  }
  if (account.data.toString("utf8") !== user.id) {
    throw createError({ statusCode: 409, statusMessage: "ACCOUNT_CHANGED" });
  }

  const nameField = form.get("name");
  const name = nameField?.data.toString("utf8").trim();
  if (nameField && (nameField.filename !== undefined || !name || !isProfileName(name))) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_PROFILE_NAME" });
  }

  const avatar = form.get("avatar");
  const reset = form.get("resetAvatar");
  if (reset && (avatar || reset.filename !== undefined || reset.data.toString("utf8") !== "true")) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_FORM" });
  }
  if (avatar && avatar.data.length > avatarMaxBytes) {
    throw createError({ statusCode: 413, statusMessage: "AVATAR_SIZE" });
  }
  if (avatar && (!avatar.filename || !isAvatarJpeg(avatar.data))) {
    throw createError({ statusCode: 415, statusMessage: "INVALID_AVATAR" });
  }
  if (name === undefined && !avatar && !reset) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_FORM" });
  }

  const changes = {
    ...(name !== undefined && { name }),
    ...(avatar && { avatar: avatar.data.toString("base64") }),
    ...(reset && { avatar: null }),
  };
  const profile = await libraryDatabase(event)
    .insert(userProfiles)
    .values({ userId: user.id, ...changes })
    .onConflictDoUpdate({ target: userProfiles.userId, set: changes })
    .returning()
    .get();
  setResponseHeader(event, offlineExpiryHeader, String(new Date(session.expiresAt).getTime()));
  return accountProfile(user, profile);
});
