<script setup lang="ts">
import { libraryReturnPath } from "~/utils/account-navigation";

defineOptions({ name: "ForgotPasswordPage" });
definePageMeta({ layout: "account" });
useHead({ title: "找回密码 · inYue" });

const route = useRoute();
const login = computed(() => ({
  path: "/login",
  query: { redirect: libraryReturnPath(route.query.redirect) },
}));
</script>

<template>
  <h2 class="text-2xl font-bold tracking-tight">找回密码</h2>
  <AccountForm mode="forgot">
    <template #default="{ busy }">
      <NuxtLink :to="login" class="btn btn-ghost btn-sm" :inert="busy">返回登录</NuxtLink>
    </template>
  </AccountForm>
</template>
