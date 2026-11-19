export const profileNameMaxLength = 40;
export const avatarSize = 256;
export const avatarMaxBytes = 64 * 1024;

export function isProfileName(name: string) {
  return name.length > 0 && [...name].length <= profileNameMaxLength;
}
