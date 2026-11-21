import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { removePublicSourcemaps, uploadSentrySourcemaps } from "./sentry-sourcemaps.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const nuxt = join(dirname(require.resolve("nuxt/package.json")), "bin/nuxt.mjs");
const wrangler = join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
const deployOptions = ["--config", ".output/server/wrangler.json", "--env", "production"];
const clientAssets = join(root, ".output/public/_nuxt");
const temp = join(root, "temp");

mkdirSync(temp, { recursive: true });
const workerBundle = mkdtempSync(join(temp, "sentry-worker-"));

execFileSync(process.execPath, [nuxt, "build"], {
  cwd: root,
  env: { ...process.env, INYUE_SENTRY_SOURCEMAPS: "1" },
  stdio: "inherit",
});
uploadSentrySourcemaps(root, "inyue-web", clientAssets);
removePublicSourcemaps(clientAssets);

runWrangler(["deploy", ...deployOptions, "--dry-run", "--outdir", workerBundle]);
uploadSentrySourcemaps(root, "inyue-server", workerBundle);
// Ship the exact bundle whose debug ID was uploaded to Sentry.
runWrangler(["deploy", join(workerBundle, "index.js"), ...deployOptions, "--no-bundle"]);

function runWrangler(args) {
  execFileSync(process.execPath, [wrangler, ...args], { cwd: root, stdio: "inherit" });
}
