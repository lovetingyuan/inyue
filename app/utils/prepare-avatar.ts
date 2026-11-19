import { avatarMaxBytes, avatarSize } from "~~/shared/account-profile";

export const avatarFileTypes = "image/jpeg,image/png,image/webp";

export async function prepareAvatar(file: File) {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("图片不能超过 10 MiB。");
  }
  if (!avatarFileTypes.split(",").includes(file.type)) {
    throw new Error("请选择 JPEG、PNG 或 WebP 图片。");
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("无法读取这张图片，请重新选择。");
  });
  const canvas = document.createElement("canvas");
  canvas.width = avatarSize;
  canvas.height = avatarSize;
  const context = canvas.getContext("2d");
  try {
    if (!context) {
      throw new Error("无法处理头像，请重新选择。");
    }
    const { width, height } = bitmap;
    const side = Math.min(width, height);
    context.fillStyle = "white";
    context.fillRect(0, 0, avatarSize, avatarSize);
    context.drawImage(
      bitmap,
      (width - side) / 2,
      (height - side) / 2,
      side,
      side,
      0,
      0,
      avatarSize,
      avatarSize,
    );
  } finally {
    bitmap.close();
  }
  for (const quality of [0.88, 0.75, 0.6, 0.45]) {
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (jpeg?.type === "image/jpeg" && jpeg.size <= avatarMaxBytes) {
      return jpeg;
    }
  }
  throw new Error("无法将图片压缩为头像，请重新选择。");
}
