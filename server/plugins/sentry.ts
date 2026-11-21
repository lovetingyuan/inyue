import { sentryCloudflareNitroPlugin } from "@sentry/nuxt/module/plugins";
import { isError } from "h3";
import { defineNitroPlugin, useRuntimeConfig } from "nitropack/runtime";
import { sentryDataCollection } from "../../shared/sentry-data-collection";

const setupSentry = sentryCloudflareNitroPlugin(() => {
  const { sentryServerDsn, public: config } = useRuntimeConfig();
  const environment = config.sentryEnvironment || "production";

  return {
    dsn: sentryServerDsn || undefined,
    environment,
    release: config.sentryRelease,
    tracesSampleRate: environment === "development" ? 1 : 0.1,
    enableLogs: true,
    dataCollection: sentryDataCollection,
    beforeSend(event, { originalException }) {
      if (
        isError(originalException) &&
        originalException.statusCode >= 300 &&
        originalException.statusCode < 500
      ) {
        return null;
      }
      return event;
    },
  };
});

export default defineNitroPlugin((nitroApp) => {
  if (!import.meta.dev) {
    setupSentry(nitroApp);
  }
});
