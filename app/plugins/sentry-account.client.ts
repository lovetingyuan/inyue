import { getClient, setUser } from "@sentry/nuxt";
import { defineNuxtPlugin } from "#app";
import { watch } from "vue";
import { useSessionStore } from "~/stores/session";

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:mounted", () => {
    if (!getClient()) {
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
  });
});
