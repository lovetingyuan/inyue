import { Capacitor } from "@capacitor/core";
import { init } from "@sentry/nuxt";
import { useRuntimeConfig } from "#app";
import { sentryDataCollection } from "./shared/sentry-data-collection";

const config = useRuntimeConfig().public;
const native = Capacitor.isNativePlatform();
const dsn = native ? config.sentryAndroidDsn : config.sentryWebDsn;

if (!import.meta.dev && dsn) {
  const environment = config.sentryEnvironment || "production";
  const options = {
    dsn,
    environment,
    release: config.sentryRelease,
    tracesSampleRate: environment === "development" ? 1 : 0.1,
    tracePropagationTargets: [/^\/api\//],
    enableLogs: true,
    dataCollection: sentryDataCollection,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
  };

  if (native) {
    const SentryCapacitor = await import("@sentry/capacitor");
    SentryCapacitor.init(options, init);
  } else {
    init(options);
  }
}
