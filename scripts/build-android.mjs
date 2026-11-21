import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lockAndroidBuild } from "./android-build-lock.mjs";
import { removePublicSourcemaps, uploadSentrySourcemaps } from "./sentry-sourcemaps.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = join(root, "android");
const apkPath = join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const productionOrigin = "https://inyue.tingyuan.nz";
const windows = process.platform === "win32";
const environment = {
  ...process.env,
  NODE_ENV: "production",
  INYUE_ANDROID_DEV: "0",
  NUXT_PUBLIC_MOBILE_API_ORIGIN: productionOrigin,
  NUXT_PUBLIC_SITE_URL: productionOrigin,
  NUXT_PUBLIC_MOBILE_LOCAL_TEST: "false",
  NUXT_PUBLIC_INTEGRATION_PLAYBACK: "false",
};

let release;
try {
  release = lockAndroidBuild(root);
  const nuxt = join(dirname(require.resolve("nuxt/package.json")), "bin/nuxt.mjs");
  const capacitor = require.resolve("@capacitor/cli/bin/capacitor");

  console.log(`构建正式环境 Android APK：${productionOrigin}`);
  run(process.execPath, [nuxt, "generate", "--envName", "capacitor"]);
  if (environment.INYUE_SENTRY_SOURCEMAPS === "1") {
    const clientAssets = join(root, ".output-capacitor", "public", "_nuxt");
    uploadSentrySourcemaps(root, "inyue-android", clientAssets);
    removePublicSourcemaps(clientAssets);
  }
  run(process.execPath, [capacitor, "sync", "android"]);

  if (windows) {
    run(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "gradlew.bat", "assembleDebug"], {
      cwd: androidDir,
    });
  } else {
    run("./gradlew", ["assembleDebug"], { cwd: androidDir });
  }

  const apk = statSync(apkPath);
  if (!apk.isFile() || apk.size === 0) {
    throw new Error("APK 文件为空。");
  }

  console.log(`APK：${apkPath}`);
  console.log(`大小：${(apk.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`相对路径：${relative(root, apkPath).replaceAll("\\", "/")}`);
} catch (error) {
  console.error(`Android 构建失败：${error.message}`);
  process.exitCode = 1;
} finally {
  release?.();
}

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, env: environment, stdio: "inherit", ...options });
}
