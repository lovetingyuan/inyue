import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(root, "package.json");
const packageLockPath = join(root, "package-lock.json");
const buildGradlePath = join(root, "android", "app", "build.gradle");
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

let prompt;

try {
  const originUrl = checkReleaseEnvironment();
  const current = readCurrentVersions();
  const latestTag = getLatestTag();

  console.log("发布环境检查通过（main 分支，工作区干净）。");
  console.log(
    `当前版本：package.json ${current.packageVersion} | Android versionName "${current.versionName}" (versionCode ${current.versionCode})`,
  );
  if (latestTag) {
    console.log(`最新 Tag：${latestTag}`);
  }
  console.log("");

  prompt = createPrompt();
  const newVersion = await promptVersion(prompt);
  const tagName = `v${newVersion}`;
  const nextVersionCode = current.versionCode + 1;

  console.log("");
  const changelog = await promptChangelog(prompt);

  console.log("");
  console.log("发布确认：");
  console.log(`- 新版本：${newVersion}（Tag: ${tagName}）`);
  console.log(`- Android versionCode：${current.versionCode} -> ${nextVersionCode}`);
  console.log(
    `- 更新文件：package.json${existsSync(packageLockPath) ? ", package-lock.json" : ""}, android/app/build.gradle`,
  );
  console.log("- 更新日志：");
  for (const line of changelog.split("\n")) {
    console.log(`  ${line}`);
  }
  console.log("");

  const confirmed = await prompt.ask("确认更新版本号、提交、打 Tag 并推送到 origin？(y/N) ");
  prompt.close();
  prompt = undefined;

  if (!/^y(?:es)?$/i.test(confirmed.trim())) {
    console.log("已取消发布。");
    process.exitCode = 0;
  } else {
    executeRelease({ newVersion, tagName, nextVersionCode, changelog, originUrl });
  }
} catch (error) {
  if (error.name === "AbortError") {
    console.log("\n已取消发布。");
    process.exitCode = 130;
  } else {
    console.error(`发布失败：${error.message}`);
    process.exitCode = 1;
  }
} finally {
  prompt?.close();
}

function checkReleaseEnvironment() {
  const branch = getCurrentBranch();
  if (branch !== "main") {
    throw new Error(`当前分支为 "${branch}"，请切换到 main 分支后再发布。`);
  }

  const status = git(["status", "--porcelain"]);
  if (status) {
    throw new Error(`工作区不干净，请先提交或清理以下改动后再发布：\n${status}`);
  }

  let originUrl;
  try {
    originUrl = git(["remote", "get-url", "origin"]).trim();
  } catch {
    throw new Error("未配置 origin 远程仓库，无法推送发布。");
  }

  console.log("正在同步远端 main 分支与 Tag...");
  gitInherit(["fetch", "origin", "main", "--tags"]);

  if (gitSucceeds(["rev-parse", "--verify", "origin/main"])) {
    const behindCount = Number(git(["rev-list", "--count", "HEAD..origin/main"]).trim());
    if (behindCount > 0) {
      throw new Error(
        `本地 main 分支落后于 origin/main ${behindCount} 个提交，请先执行 git pull。`,
      );
    }
  }

  return originUrl;
}

function getCurrentBranch() {
  try {
    return git(["symbolic-ref", "--short", "HEAD"]).trim();
  } catch {
    return "HEAD (detached)";
  }
}

function readCurrentVersions() {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const gradle = readFileSync(buildGradlePath, "utf8");
  const versionCodeMatch = gradle.match(/\bversionCode\s+(\d+)\b/);
  const versionNameMatch = gradle.match(/\bversionName\s+"([^"]+)"/);

  if (!versionCodeMatch || !versionNameMatch) {
    throw new Error("无法从 android/app/build.gradle 解析 versionCode 或 versionName。");
  }

  return {
    packageVersion: String(pkg.version ?? ""),
    versionCode: Number(versionCodeMatch[1]),
    versionName: versionNameMatch[1],
  };
}

function getLatestTag() {
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname"]).trim();
  if (!tags) {
    return "";
  }
  return tags.split(/\r?\n/)[0] ?? "";
}

async function promptVersion(prompt) {
  while (true) {
    const raw = (await prompt.ask("请输入新版本号（例如 1.0.1 或 v1.0.1）：")).trim();
    const version = raw.replace(/^v/i, "");

    if (!semverPattern.test(version)) {
      console.log("版本号格式无效，请使用 SemVer 格式（例如 1.0.1 或 1.2.0-beta.1）。");
      continue;
    }

    const tagName = `v${version}`;
    if (gitSucceeds(["rev-parse", "-q", "--verify", `refs/tags/${tagName}`])) {
      console.log(`Tag ${tagName} 已存在，请输入其他版本号。`);
      continue;
    }

    return version;
  }
}

async function promptChangelog(prompt) {
  while (true) {
    console.log("请输入更新日志（支持多行 Markdown，单独输入一行 END 或 . 结束）：");
    const lines = [];

    while (true) {
      const line = await prompt.readLine();
      const marker = line.trim();
      if (marker === "." || marker === "END") {
        break;
      }
      lines.push(line);
    }

    const changelog = lines.join("\n").trim();
    if (!changelog) {
      console.log("更新日志不能为空，请重新输入。\n");
      continue;
    }

    return changelog;
  }
}

function executeRelease({ newVersion, tagName, nextVersionCode, changelog, originUrl }) {
  const updatedFiles = updateVersionFiles(newVersion, nextVersionCode);

  gitInherit(["add", "--", ...updatedFiles]);
  gitInherit(["commit", "-m", `chore(release): ${tagName}`]);
  execFileSync("git", ["tag", "-a", tagName, "--cleanup=verbatim", "-F", "-"], {
    cwd: root,
    input: `${changelog}\n`,
    stdio: ["pipe", "inherit", "inherit"],
  });

  try {
    console.log(`正在推送 main 与 ${tagName} 到 origin...`);
    gitInherit(["push", "--atomic", "origin", "main", `refs/tags/${tagName}`]);
  } catch (error) {
    console.error("");
    console.error("本地提交与 Tag 已创建，但推送到 origin 失败。");
    console.error(`重试推送：git push --atomic origin main refs/tags/${tagName}`);
    console.error(`如需回滚：git tag -d ${tagName} && git reset --hard HEAD~1`);
    throw error;
  }

  console.log("");
  console.log(`已推送 ${tagName}，GitHub Actions 将自动构建 Release APK 并创建 Draft Release。`);
  const repoUrl = parseGitHubRepoUrl(originUrl);
  if (repoUrl) {
    console.log(`Actions：${repoUrl}/actions`);
    console.log(`Releases：${repoUrl}/releases`);
  }
}

function updateVersionFiles(newVersion, nextVersionCode) {
  const updatedFiles = ["package.json", "android/app/build.gradle"];

  const pkgContent = readFileSync(packageJsonPath, "utf8");
  const nextPkgContent = replaceOnce(
    pkgContent,
    /^(\s*"version"\s*:\s*)"[^"]*"/m,
    `$1"${newVersion}"`,
    "package.json 中的 version",
  );
  writeFileSync(packageJsonPath, nextPkgContent, "utf8");

  if (existsSync(packageLockPath)) {
    let lockContent = readFileSync(packageLockPath, "utf8");
    lockContent = replaceOnce(
      lockContent,
      /^(\{\r?\n(?: {2}"name":[^\n]*\r?\n)? {2}"version": )"[^"]*"/,
      `$1"${newVersion}"`,
      "package-lock.json 根级 version",
    );
    lockContent = replaceOnce(
      lockContent,
      /("": \{\r?\n(?: {6}"name":[^\n]*\r?\n)? {6}"version": )"[^"]*"/,
      `$1"${newVersion}"`,
      'package-lock.json packages[""].version',
    );
    writeFileSync(packageLockPath, lockContent, "utf8");
    updatedFiles.push("package-lock.json");
  }

  let gradleContent = readFileSync(buildGradlePath, "utf8");
  gradleContent = replaceOnce(
    gradleContent,
    /(\bversionCode\s+)\d+\b/,
    `$1${nextVersionCode}`,
    "android/app/build.gradle 中的 versionCode",
  );
  gradleContent = replaceOnce(
    gradleContent,
    /(\bversionName\s+)"[^"]*"/,
    `$1"${newVersion}"`,
    "android/app/build.gradle 中的 versionName",
  );
  writeFileSync(buildGradlePath, gradleContent, "utf8");

  return updatedFiles;
}

function replaceOnce(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`未找到 ${label}，无法自动更新。`);
  }
  return content.replace(pattern, replacement);
}

function parseGitHubRepoUrl(remoteUrl) {
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }

  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}`;
  }

  return "";
}

function createPrompt() {
  const rl = createInterface({ input: stdin, output: stdout });
  const queue = [];
  const waiters = [];
  let closed = false;
  let aborted = false;

  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(line);
    } else {
      queue.push(line);
    }
  });

  rl.on("SIGINT", () => {
    aborted = true;
    rl.close();
  });

  rl.on("close", () => {
    closed = true;
    const error = new Error(aborted ? "用户中断输入。" : "输入流已意外关闭。");
    error.name = "AbortError";
    while (waiters.length > 0) {
      waiters.shift().reject(error);
    }
  });

  function readLine() {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift());
    }
    if (closed) {
      const error = new Error(aborted ? "用户中断输入。" : "输入流已意外关闭。");
      error.name = "AbortError";
      return Promise.reject(error);
    }
    return new Promise((resolveLine, rejectLine) => {
      waiters.push({ resolve: resolveLine, reject: rejectLine });
    });
  }

  function ask(label) {
    stdout.write(label);
    return readLine();
  }

  function close() {
    rl.close();
  }

  return { ask, readLine, close };
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function gitInherit(args) {
  execFileSync("git", args, { cwd: root, stdio: "inherit" });
}

function gitSucceeds(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
