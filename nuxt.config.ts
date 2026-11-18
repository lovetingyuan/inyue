import { execFileSync } from "node:child_process";
import { lstatSync, readlinkSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineNuxtConfig } from "nuxt/config";
import { vueVitePlugin } from "vite-plugin-dom-source";
import webManifest from "./public/manifest.json";
import { devPort } from "./shared/dev-server.mjs";
import { defaultQuotaBytes } from "./shared/library-limits";

const require = createRequire(import.meta.url);
const nitroRoot = dirname(require.resolve("nitropack/package.json"));
const betterAuthRoot = dirname(fileURLToPath(import.meta.resolve("@nuxtjs/better-auth")));

function getGitHash() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

const buildTime = process.env.VITE_BUILD_TIME || Date.now().toString();
const buildHash = process.env.VITE_GIT_HASH || getGitHash();

export default defineNuxtConfig({
  telemetry: false,
  experimental: { appManifest: false },
  imports: { autoImport: false, scan: false },
  components: {
    dirs: [],
    transform: { exclude: [/^(?!.*[\\/]node_modules[\\/]).*[\\/]app[\\/]/] },
  },
  alias: {
    // Better Auth exposes its server session helpers through Nitro's import registry.
    "#better-auth-session": resolve(betterAuthRoot, "runtime/server/utils/session.js"),
  },

  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],

  app: {
    head: {
      htmlAttrs: { lang: "zh-CN" },
      title: "inYue",
      viewport: "width=device-width, initial-scale=1.0, viewport-fit=cover",
      script: [
        {
          src: `/build-info.js?time=${buildTime}&hash=${encodeURIComponent(buildHash)}`,
        },
      ],
      link: [
        { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
        { rel: "icon", type: "image/svg+xml", sizes: "any", href: "/assets/icon/inyue.svg" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      ],
      meta: [
        {
          name: "theme-color",
          content: "#ffffff",
          media: "(prefers-color-scheme: light)",
        },
        {
          name: "theme-color",
          content: "#16171d",
          media: "(prefers-color-scheme: dark)",
        },
      ],
    },
  },

  vite: {
    plugins: [tailwindcss(), vueVitePlugin()],
  },

  nitro: {
    imports: { autoImport: false },
    preset: "cloudflare_module",
    externals: {
      // The generated Better Auth module imports the local TypeScript adapter.
      inline: [(id) => id.replaceAll("\\", "/").endsWith("/better-auth/database.mjs")],
    },
    alias: {
      "#music-worker-base": resolve(
        nitroRoot,
        "dist/presets/cloudflare/runtime/cloudflare-module.mjs",
      ),
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
    hooks: {
      "prerender:config"(config) {
        // The Cloudflare entry point can only run in the deployed Worker.
        delete config.entry;
      },
    },
  },

  modules: [
    "nitro-cloudflare-dev",
    "@nuxtjs/better-auth",
    "@vite-pwa/nuxt",
    "@pinia/nuxt",
    "@pinia/colada-nuxt",
  ],

  pwa: {
    registerType: "prompt",
    client: { periodicSyncForUpdates: 60 * 60 },
    manifest: { ...webManifest, display: "standalone" },
    generateSW: {
      cleanURLs: false,
      // Nuxt adds a payload glob when prerendering, but the SPA shell has no payload file.
      globStrict: false,
      clientsClaim: true,
      skipWaiting: true,
      cleanupOutdatedCaches: true,
      globPatterns: [
        "200.html",
        "assets/**/*",
        "*.ico",
        "apple-touch-icon.png",
        "_nuxt/**/*.{js,css,woff,woff2}",
      ],
      navigateFallback: "",
      runtimeCaching: [
        {
          urlPattern: ({ url, sameOrigin }) =>
            sameOrigin && url.pathname === "/api/auth-providers" && !url.search,
          handler: "NetworkFirst",
          options: {
            cacheName: "inyue-public-api-v1",
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 1, maxAgeSeconds: 86_400, purgeOnQuotaError: true },
          },
        },
      ],
    },
  },

  hooks: {
    ready(nuxt) {
      if (nuxt.options.dev || !nuxt.options.ssr) return;

      nuxt.hook("pwa:beforeBuildServiceWorker", ({ generateSW }) => {
        generateSW?.runtimeCaching?.unshift({
          urlPattern: ({ request, sameOrigin, url }) =>
            sameOrigin && request.mode === "navigate" &&
            /^(?:\/|\/(?:login|register|forgot-password|reset-password|songs\/new)\/?)$/.test(url.pathname),
          handler: "NetworkOnly",
          // The Nuxt PWA module maps 200.html to its Cloudflare asset URL /200.
          options: { precacheFallback: { fallbackURL: "/200" } },
        });
      });
    },
    "app:resolve"(app) {
      // The app initializes its session through /api/account, including in the Android WebView.
      app.plugins = app.plugins.filter(({ src }) => {
        const path = src.replaceAll("\\", "/");
        return !path.includes("/@nuxtjs/better-auth/") || !/\/session\.client(?:\.js)?$/.test(path);
      });
    },
    listen(server) {
      const address = server.address();
      if (address && typeof address !== "string" && address.port === devPort) return;
      console.error(`开发端口固定为 ${devPort}。`);
      process.exit(1);
    },
    "nitro:config"(config) {
      if (!config.dev && config.preset === "cloudflare_module") {
        config.entry = resolve("server/worker.ts");
        config.prerender ??= {};
        config.prerender.routes = [...(config.prerender.routes ?? []), "/200.html"];
      }
    },
    "better-auth:database:providers"(providers) {
      providers.d1 = {
        priority: 10,
        buildDatabaseCode: () => `
          export { createAuthDatabase as createDatabase } from ${JSON.stringify(resolve("server/utils/auth-database.ts"))}
          export const db = undefined
          export function isRequestScopedDatabase() { return true }
        `,
      };
    },
  },

  runtimeConfig: {
    resendApiKey: "",
    mailFrom: "",
    mailPreview: false,
    mediaSigningSecret: "",
    libraryQuotaBytes: defaultQuotaBytes,
    integrationPlayback: false,
    googleClientSecret: "",
    public: {
      siteUrl: "",
      mobileApiOrigin: "",
      mobileLocalTest: false,
      googleClientId: "",
      androidOrigin: "https://localhost",
      integrationPlayback: false,
    },
  },

  routeRules: {
    "/": { headers: { "cache-control": "private, no-store" } },
    "/login": { headers: { "cache-control": "private, no-store" } },
    "/register": { headers: { "cache-control": "private, no-store" } },
    "/forgot-password": { headers: { "cache-control": "private, no-store" } },
    "/reset-password": { headers: { "cache-control": "private, no-store" } },
    "/songs/new": { headers: { "cache-control": "private, no-store" } },
    "/api/**": { headers: { "cache-control": "private, no-store" } },
  },

  $env: {
    capacitor: {
      ssr: false,
      pwa: {
        disable: process.env.NODE_ENV === "development",
        generateSW: {
          skipWaiting: false,
          globPatterns: ["build-info.js"],
          manifestTransforms: [(entries) => ({
            // Capacitor intercepts /favicon.ico and serves navigation from the APK.
            manifest: entries.filter(({ url }) => !/(?:^|\/)favicon\.ico$|\.html$/.test(url)),
            warnings: [],
          })],
          ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^(?:time|hash)$/],
          runtimeCaching: [
            {
              urlPattern: ({ url, request }) =>
                url.pathname === "/api/auth-providers" && !url.search &&
                request.cache !== "no-store" && request.credentials === "omit" &&
                !request.headers.has("authorization"),
              handler: "NetworkFirst",
              options: {
                cacheName: "inyue-android-public-api-v1",
                networkTimeoutSeconds: 3,
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 3, maxAgeSeconds: 86_400, purgeOnQuotaError: true },
              },
            },
            {
              urlPattern: ({ request, sameOrigin, url }) =>
                sameOrigin && !request.headers.has("authorization") &&
                /^(image|script|style|font|worker)$/.test(request.destination) &&
                /^\/(?:assets|_nuxt)\//.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "inyue-android-assets-v1",
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 64, maxAgeSeconds: 2_592_000, purgeOnQuotaError: true },
              },
            },
          ],
        },
      },
      auth: { clientOnly: process.env.NODE_ENV !== "development" },
      hooks: {
        close(nuxt) {
          if (nuxt.options.dev) return;

          // Nuxt adds a legacy dist link after the static build.
          const root = nuxt.options.rootDir;
          const dist = resolve(root, "dist");
          if (
            lstatSync(dist, { throwIfNoEntry: false })?.isSymbolicLink() &&
            resolve(root, readlinkSync(dist)) === resolve(root, ".output-capacitor/public")
          ) {
            unlinkSync(dist);
          }
        },
      },
      nitro: {
        preset: "static",
        // Dev server cleanup must not remove the packaged mobile assets.
        output:
          process.env.NODE_ENV === "development"
            ? undefined
            : {
                dir: ".output-capacitor",
                publicDir: ".output-capacitor/public",
              },
        cloudflare: { deployConfig: false },
      },
    },
  },
});
