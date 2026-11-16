<script setup lang="ts">
defineOptions({ name: "IntegrationPlaybackView" });

const session = useSessionStore();
const player = useTemplateRef("player");
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
        @click="session.logout(() => player?.release())"
      >
        退出登录
      </button>
    </div>
    <IntegrationPlayer ref="player" />
    <p v-if="session.logoutError" class="alert alert-error" role="alert">
      {{ session.logoutError }}
    </p>
  </template>
</template>
