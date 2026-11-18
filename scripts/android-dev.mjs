import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { devOrigin, devPort } from "../shared/dev-server.mjs";

const require = createRequire(import.meta.url);
const capacitor = require.resolve("@capacitor/cli/bin/capacitor");
const windows = process.platform === "win32";
const host = new URL(devOrigin).hostname;
const port = String(devPort);
const args = process.argv.slice(2);

try {
  if (args.includes("--list") || args.includes("--version") || args.includes("-V")) {
    run(process.execPath, [capacitor, "run", "android", ...args]);
  } else if (args.includes("--help") || args.includes("-h")) {
    console.log("用法：npm run android [-- --target <ID>]，查看设备：npm run android:devices");
  } else {
    const { values } = parseArgs({
      args,
      options: {
        target: { type: "string" },
        port: { type: "string", default: port },
        forwardPorts: { type: "string", default: `${port}:${port}` },
      },
    });
    if (values.port !== port || values.forwardPorts !== `${port}:${port}`) {
      throw new Error(`Android 开发端口固定为 ${port}。`);
    }
    await develop(values.target ?? process.env.ANDROID_SERIAL);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function develop(target) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const adb = sdk ? join(sdk, "platform-tools", windows ? "adb.exe" : "adb") : "adb";
  const devices = execFileSync(adb, ["devices"], { encoding: "utf8" })
    .split(/\r?\n/)
    .flatMap((line) => /^(\S+)\s+device$/.exec(line.trim())?.slice(1) ?? []);
  if (devices.length === 0 || (target && !devices.includes(target))) {
    throw new Error("未找到可用的 Android 设备。请连接并授权真机，或启动模拟器。");
  }
  if (devices.length > 1 && !target) {
    throw new Error(`检测到多个设备，请用 --target 指定设备：${devices.join("、")}`);
  }

  let release = lockDeployment();
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let server;
  let exited;
  try {
    if (hasProjectServer()) {
      console.log(`复用 Nuxt 开发服务 ${devOrigin}`);
    } else {
      const nuxt = join(dirname(require.resolve("nuxt/package.json")), "bin/nuxt.mjs");
      server = spawn(
        process.execPath,
        [nuxt, "dev", "--host", host, "--port", port, "--strictPort", "--no-takeover", "--no-fork"],
        { stdio: "inherit" },
      );
      exited = new Promise((resolve) => {
        server.once("error", resolve);
        server.once("exit", () => resolve(new Error(`Nuxt 开发服务已退出（${devOrigin}）。`)));
      });
    }

    await waitForServer(server, exited, shutdown.signal);
    await installApp(adb, target ?? devices[0], shutdown.signal);
    release();
    release = undefined;
    console.log(`Web 和 Android 开发已就绪：${devOrigin}`);

    if (exited) {
      const stopped = new Promise((resolve) =>
        shutdown.signal.addEventListener("abort", resolve, { once: true }),
      );
      const error = await Promise.race([exited, stopped]);
      if (error && !shutdown.signal.aborted) throw error;
    }
  } catch (error) {
    if (!shutdown.signal.aborted) throw error;
  } finally {
    release?.();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (server?.exitCode === null && server.signalCode === null) server.kill();
  }
}

function lockDeployment() {
  mkdirSync("temp", { recursive: true });
  const lock = "temp/android-deploy.lock";
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = Number(readFileSync(lock, "utf8"));
    if (!owner || isRunning(owner)) throw new Error("已有 Android 部署正在运行，请等它完成。");
    rmSync(lock, { force: true });
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  }
  return () => rmSync(lock, { force: true });
}

function isRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function hasProjectServer(pid) {
  try {
    const lock = JSON.parse(readFileSync(".nuxt/nuxt.lock", "utf8"));
    return (
      lock.command === "dev" &&
      lock.url === devOrigin &&
      resolve(lock.cwd) === process.cwd() &&
      (pid === undefined || lock.pid === pid) &&
      isRunning(lock.pid)
    );
  } catch {
    return false;
  }
}

async function waitForServer(server, exited, signal) {
  const timeout = AbortSignal.timeout(90_000);
  const startup = new AbortController();
  exited?.then((error) => {
    startup.abort(error);
  });
  const waiting = AbortSignal.any([signal, timeout, startup.signal]);
  try {
    while (!waiting.aborted) {
      if (hasProjectServer(server?.pid) && (await nuxtResponds(waiting))) return;
      await setTimeout(400, undefined, { signal: waiting });
    }
  } catch (error) {
    if (!waiting.aborted) throw error;
  }
  startup.signal.throwIfAborted();
  signal.throwIfAborted();
  throw new Error(`Nuxt 开发服务未在 ${devOrigin} 就绪。`);
}

async function nuxtResponds(signal) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(3_000)]);
  const checks = await Promise.all(
    [
      ["/login", "text/html"],
      ["/_nuxt/@vite/client", "javascript"],
    ].map(async ([path, type]) => {
      const response = await fetch(new URL(path, devOrigin), {
        method: "HEAD",
        redirect: "error",
        signal: requestSignal,
      }).catch(() => null);
      return response?.ok && response.headers.get("content-type")?.includes(type);
    }),
  );
  return checks.every(Boolean);
}

async function installApp(adb, device, signal) {
  const configPath = "android/app/src/main/assets/capacitor.config.json";
  const original = existsSync(configPath) ? readFileSync(configPath) : undefined;
  try {
    run(process.execPath, [capacitor, "sync", "android"], {
      env: { ...process.env, INYUE_ANDROID_DEV: "1" },
    });
    if (windows)
      run(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "gradlew.bat", "assembleDebug"], {
        cwd: "android",
      });
    else run("./gradlew", ["assembleDebug"], { cwd: "android" });
  } finally {
    if (original) writeFileSync(configPath, original);
    else rmSync(configPath, { force: true });
  }

  run(adb, ["-s", device, "install", "-r", "android/app/build/outputs/apk/debug/app-debug.apk"]);
  const ready = await nuxtResponds(signal);
  signal.throwIfAborted();
  if (!ready) throw new Error(`Android 安装完成，但 Nuxt 开发服务已断开（${devOrigin}）。`);
  run(adb, ["-s", device, "reverse", `tcp:${port}`, `tcp:${port}`]);
  // Start after forwarding and let the WebView render without blocking ADB.
  run(adb, ["-s", device, "shell", "am", "start", "-S", "-n", "com.tingyuan.inyue/.MainActivity"]);
}

function run(command, args, options) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}
