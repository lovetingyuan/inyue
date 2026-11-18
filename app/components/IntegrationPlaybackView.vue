<script setup lang="ts">
import { useSessionStore } from "~/stores/session";
import LogoutConfirmDialog from "~/components/LogoutConfirmDialog.vue";
import IntegrationPlayer from "~/components/IntegrationPlayer.vue";
import { useTemplateRef } from "vue";
defineOptions({ name: "IntegrationPlaybackView" });

type LogoutConfirmDialogExpose = { open: () => void };

const session = useSessionStore();
const player = useTemplateRef("player");
const logoutConfirm = useTemplateRef<LogoutConfirmDialogExpose>("logoutConfirm");

function confirmLogout() {
  void session.logout(() => player.value?.release());
}
</script>

<template>
  <template v-if="session.account">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="card-title">{{ session.account.name }}</h2>
        <p class="break-all text-sm">{{ session.account.email }}</p>
      </div>
      <button
        class="btn btn-sm"
        type="button"
        :disabled="session.signingOut"
        @click="logoutConfirm?.open()"
      >
        退出登录
      </button>
    </div>
    <IntegrationPlayer ref="player" />
    <p v-if="session.logoutError" class="alert alert-error" role="alert">
      {{ session.logoutError }}
    </p>
    <LogoutConfirmDialog ref="logoutConfirm" @confirm="confirmLogout" />
  </template>
</template>
