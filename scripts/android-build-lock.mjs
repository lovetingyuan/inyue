import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function lockAndroidBuild(root = process.cwd()) {
  const directory = join(root, "temp");
  const lock = join(directory, "android-deploy.lock");
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    const owner = Number(readFileSync(lock, "utf8"));
    if (!owner || isRunning(owner)) {
      throw new Error("已有 Android 构建或部署正在运行，请等它完成。");
    }
    rmSync(lock, { force: true });
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  }
  return () => rmSync(lock, { force: true });
}

export function isRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
