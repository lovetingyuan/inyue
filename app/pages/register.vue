<script setup lang="ts">
import { useSessionStore } from "~/stores/session";
import AccountForm from "~/components/AccountForm.vue";
import { computed } from "vue";
import { definePageMeta } from "#imports";
import { NuxtLink } from "#components";
import { useHead, useRoute, useRouter } from "#app";
import { libraryReturnPath } from "~/utils/account-navigation";

defineOptions({ name: "RegisterPage" });
definePageMeta({ layout: "account" });
useHead({ title: "注册 · inYue" });

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const login = computed(() => ({
  path: "/login",
  query: { redirect: libraryReturnPath(route.query.redirect) },
}));

function registered(email: string) {
  session.loginFeedback = { notice: "请查收验证邮件。", email };
  void router.replace(login.value);
}
</script>

<template>
  <AccountForm mode="register" @success="registered">
    <template #default="{ busy }">
      <NuxtLink :to="login" class="btn btn-ghost btn-sm" :inert="busy">返回登录</NuxtLink>
    </template>
  </AccountForm>
</template>
