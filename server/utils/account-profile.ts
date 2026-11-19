import type { Buffer } from "node:buffer";
import type { userProfiles } from "../database/profile-schema";
import { avatarSize } from "~~/shared/account-profile";
import type { AccountProfile } from "~~/shared/types/library";

export function accountProfile(
  user: Pick<AccountProfile, "id" | "name" | "image">,
  profile?: Pick<typeof userProfiles.$inferSelect, "name" | "avatar">,
): AccountProfile {
  const avatar = profile?.avatar;
  return {
    id: user.id,
    name: profile?.name ?? user.name,
    image: avatar ? `data:image/jpeg;base64,${avatar}` : (user.image ?? null),
    hasCustomAvatar: Boolean(avatar),
  };
}

export function isAvatarJpeg(data: Buffer) {
  if (
    data.length < 24 ||
    data.readUInt16BE(0) !== 0xffd8 ||
    data.readUInt16BE(data.length - 2) !== 0xffd9
  ) {
    return false;
  }
  let offset = 2;
  let hasFrame = false;
  while (offset + 4 < data.length) {
    if (data[offset++] !== 0xff) {
      return false;
    }
    const marker = data[offset++];
    if (marker === 0xff) {
      offset--;
      continue;
    }
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length >= data.length - 2) {
      return false;
    }
    if (marker === 0xc0 || marker === 0xc2) {
      if (
        hasFrame ||
        length < 11 ||
        data.readUInt16BE(offset + 3) !== avatarSize ||
        data.readUInt16BE(offset + 5) !== avatarSize
      ) {
        return false;
      }
      hasFrame = true;
    } else if (marker === 0xda) {
      return hasFrame && length >= 8;
    }
    offset += length;
  }
  return false;
}
