import { getClient, setUser } from "@sentry/nuxt";
import { defineNuxtPlugin } from "#app";
import { watch } from "vue";
import { useSessionStore } from "~/stores/session";

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:mounted", () => {
    const client = getClient();
    if (!client) {
      return;
    }

    const session = useSessionStore(nuxtApp.$pinia);
    watch(
      () => (session.signingOut ? null : session.account),
      (account) => {
        setUser(account ? { id: account.id, username: account.name, email: account.email } : null);
      },
      { immediate: true, flush: "sync" },
    );

    const loadReplay = () => {
      void import("~/utils/sentry-replay")
        .then(({ replayIntegration }) => {
          const activeClient = getClient();
          if (activeClient && !activeClient.getIntegrationByName("Replay")) {
            activeClient.addIntegration(replayIntegration());
          }
        })
        .catch(() => {});
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadReplay, { timeout: 2000 });
    } else {
      setTimeout(loadReplay, 1000);
    }
  });
});
