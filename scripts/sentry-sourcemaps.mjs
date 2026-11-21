import { execFileSync } from "node:child_process";
import { globSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export function uploadSentrySourcemaps(root, project, directory) {
  execFileSync("sentry", ["sourcemap", "upload", directory], {
    cwd: root,
    env: { ...process.env, SENTRY_ORG: "tingyuan-tw", SENTRY_PROJECT: project },
    stdio: "inherit",
  });
}

export function removePublicSourcemaps(directory) {
  for (const path of globSync("**/*.map", { cwd: directory })) {
    unlinkSync(join(directory, path));
  }
}
