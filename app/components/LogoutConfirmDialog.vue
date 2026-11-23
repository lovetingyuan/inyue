<script setup lang="ts">
import { useAppStore } from "~/stores/app";
import { useSessionStore } from "~/stores/session";
import { showMusicDialog } from "~/utils/music-dialog";
import { useId, useTemplateRef } from "vue";
defineOptions({ name: "LogoutConfirmDialog" });

const props = defineProps<{ releasePlayer?: () => Promise<void> | undefined }>();
const session = useSessionStore();
const app = useAppStore();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const titleId = useId();

async function confirmLogout() {
  if (session.signingOut || app.offline) {
    return;
  }
  await session.logout(props.releasePlayer);
  if (!session.logoutError) {
    dialog.value?.close();
  }
}

defineExpose({
  open: () => showMusicDialog(dialog.value),
});
</script>

<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:modal-middle"
    :aria-labelledby="titleId"
    @cancel="session.signingOut && $event.preventDefault()"
  >
    <div class="modal-box sm:max-w-sm">
      <h2 :id="titleId" class="text-lg font-semibold">确定退出登录？</h2>
      <p v-if="session.logoutError" class="alert alert-error mt-3" role="alert">
        {{ session.logoutError }}
      </p>
      <div class="modal-action">
        <form method="dialog">
          <button class="btn" :disabled="session.signingOut">取消</button>
        </form>
        <button
          type="button"
          class="btn btn-error"
          :disabled="session.signingOut || app.offline"
          :aria-busy="session.signingOut"
          @click="confirmLogout"
        >
          <span
            v-if="session.signingOut"
            class="loading loading-spinner loading-xs"
            aria-hidden="true"
          />
          退出登录
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" :disabled="session.signingOut">取消退出登录</button>
    </form>
  </dialog>
</template>
