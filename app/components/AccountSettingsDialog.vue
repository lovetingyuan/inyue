<script setup lang="ts">
import { storeToRefs } from "pinia";
import type { Account } from "~~/shared/types/library";

defineOptions({ name: "AccountSettingsDialog" });
defineProps<{ account: Account }>();

const session = useSessionStore();
const { theme, offline } = storeToRefs(useAppStore());
const profile = useTemplateRef<HTMLDialogElement>("profile");

function bytes(size: number) {
  return size >= 1024 ** 3
    ? `${(size / 1024 ** 3).toFixed(2)} GiB`
    : `${(size / 1024 ** 2).toFixed(1)} MiB`;
}

defineExpose({
  open: () => showMusicDialog(profile.value),
  close: () => profile.value?.close(),
});
</script>

<template>
  <dialog
    ref="profile"
    class="modal modal-bottom sm:modal-middle"
    aria-labelledby="profile-title"
    @cancel="session.signingOut && $event.preventDefault()"
  >
    <div class="modal-box safe-panel grid gap-4">
      <div>
        <h2 id="profile-title" class="text-xl font-bold">{{ account.name }}</h2>
        <p class="mt-1 break-all text-sm text-base-content/70">{{ account.email }}</p>
      </div>
      <label class="grid gap-1.5 text-sm font-medium"
        >存储用量 {{ bytes(account.storage.usedBytes) }} / {{ bytes(account.storage.quotaBytes) }}
        <progress
          class="progress progress-primary w-full"
          :value="account.storage.usedBytes"
          :max="account.storage.quotaBytes"
        />
      </label>
      <label class="grid gap-1.5 text-sm font-medium"
        >主题
        <select v-model="theme" class="select w-full">
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <p v-if="session.logoutError" class="alert alert-error" role="alert">
        {{ session.logoutError }}
      </p>
      <div class="flex justify-end gap-2">
        <form method="dialog">
          <button class="btn btn-ghost" :disabled="session.signingOut">关闭</button>
        </form>
        <button
          class="btn btn-error btn-outline"
          :disabled="session.signingOut || offline"
          @click="session.logout()"
        >
          退出登录
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" :disabled="session.signingOut">关闭账户弹窗</button>
    </form>
  </dialog>
</template>
