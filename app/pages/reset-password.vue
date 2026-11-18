<script setup lang="ts">
import { useSessionStore } from "~/stores/session";
import AccountForm from "~/components/AccountForm.vue";
import { computed } from "vue";
import { definePageMeta } from "#imports";
import { NuxtLink } from "#components";
import { useHead, useRoute, useRouter } from "#app";
defineOptions({ name: "ResetPasswordPage" });
definePageMeta({ layout: "account" });
useHead({ title: "重置密码 · inYue" });

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const token = computed(() =>
  !route.query.error && typeof route.query.token === "string" ? route.query.token : undefined,
);

function passwordReset() {
  session.loginFeedback = { notice: "密码已重置，请登录。" };
  void router.replace("/login");
}
</script>

<template>
  <h2 class="text-2xl font-bold tracking-tight">重置密码</h2>
  <AccountForm :key="token" mode="reset" :token="token" @success="passwordReset">
    <template #default="{ busy, invalidReset }">
      <NuxtLink v-if="invalidReset" to="/forgot-password" class="btn btn-ghost btn-sm">
        重新申请
      </NuxtLink>
      <NuxtLink to="/login" class="btn btn-ghost btn-sm" :inert="busy">返回登录</NuxtLink>
    </template>
  </AccountForm>
</template>
