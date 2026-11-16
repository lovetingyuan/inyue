<script setup lang="ts">
import { useQuery } from "@pinia/colada";
import { googleLoginError, libraryReturnPath } from "~/utils/account-navigation";

defineOptions({ name: "LoginPage" });
definePageMeta({ layout: "account" });
useHead({ title: "登录 · inYue" });

const app = useAppStore();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const { request } = useMusicApi();
const feedback = session.loginFeedback;
session.loginFeedback = undefined;
const googleFailed = route.query.google === "failed";
const initialError = googleFailed ? googleLoginError(route.query.error) : undefined;
const redirect = computed(() => libraryReturnPath(route.query.redirect));
const { data: authProviders } = useQuery({
  key: ["auth-providers"],
  enabled: () => !app.offline && !session.account,
  retry: import.meta.server ? 0 : undefined,
  query: async ({ signal }) =>
    (await request("/api/auth-providers", { retry: import.meta.server ? 1 : 0, signal }))._data,
});

onMounted(() => {
  if (googleFailed) void router.replace({ path: "/login", query: { redirect: redirect.value } });
});
</script>

<template>
  <AccountForm
    mode="login"
    :initial-email="feedback?.email"
    :initial-notice="feedback?.notice"
    :initial-error="initialError"
    :google-client-id="authProviders?.googleClientId"
    :redirect="redirect"
  >
    <template #default="{ busy }">
      <NuxtLink
        :to="{ path: '/register', query: { redirect } }"
        class="btn btn-ghost btn-sm"
        :inert="busy"
      >
        注册
      </NuxtLink>
      <NuxtLink
        :to="{ path: '/forgot-password', query: { redirect } }"
        class="btn btn-ghost btn-sm"
        :inert="busy"
      >
        忘记密码
      </NuxtLink>
    </template>
  </AccountForm>
</template>
