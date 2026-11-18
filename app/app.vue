<script setup lang="ts">
import { useStorage } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { libraryReturnPath } from "~/utils/account-navigation";

defineOptions({ name: "App" });

const app = useAppStore();
const session = useSessionStore();
const router = useRouter();
const route = router.currentRoute;
const nuxtApp = useNuxtApp();
const integrationPlayback = useRuntimeConfig().public.integrationPlayback;

useAppSession();

const theme = useStorage("music-theme", storeToRefs(app).theme, undefined, {
  initOnMounted: true,
  listenToStorageChanges: false,
  writeDefaults: false,
  serializer: {
    read: (value) => (value === "light" || value === "dark" ? value : "system"),
    write: (value) => value,
  },
});
useHead({
  htmlAttrs: {
    "data-theme": () => (theme.value === "system" ? undefined : theme.value),
  },
});

const accountRoute = computed(() => route.value.meta.layout === "account");
const libraryVisible = computed(
  () => session.account && !accountRoute.value && !integrationPlayback,
);
const showIntegration = computed(() => session.account && integrationPlayback && !app.offline);
const redirect = computed(() => {
  if (!session.ready || app.offline || session.signingOut) return;
  const { path, query } = route.value;
  if (path === "/") {
    if (typeof query.token === "string" || query.error === "INVALID_TOKEN") {
      return session.account
        ? { path: "/" }
        : { path: "/reset-password", query: { token: query.token, error: query.error } };
    }
    if (query.google === "failed") {
      return session.account
        ? { path: "/" }
        : { path: "/login", query: { google: "failed", error: query.error } };
    }
  }
  if (session.account && accountRoute.value)
    return { path: libraryReturnPath(query.redirect) ?? "/" };
  if (!session.account && !accountRoute.value) {
    return { path: "/login", query: { redirect: libraryReturnPath(path) } };
  }
});
const showStartup = computed(
  () =>
    !session.ready ||
    Boolean(redirect.value) ||
    (!app.offline && !session.account && !accountRoute.value),
);

if (import.meta.server) {
  onServerPrefetch(async () => {
    await session.refreshAccount();
    const target = redirect.value;
    if (target) await nuxtApp.runWithContext(() => navigateTo(target));
  });
} else {
  watch(redirect, (target) => {
    if (target) void router.replace(target);
  });
}
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtPwaManifest />
  <StartupScreen v-if="showStartup" />
  <NuxtLayout v-else :name="libraryVisible ? 'library' : 'account'">
    <IntegrationPlaybackView v-if="showIntegration" :key="session.userId" />
    <NuxtPage
      v-else-if="libraryVisible || (!session.account && accountRoute)"
      :key="session.userId"
    />
  </NuxtLayout>
</template>
