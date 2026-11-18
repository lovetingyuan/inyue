<script setup lang="ts">
defineOptions({ name: "LogoutConfirmDialog" });

const emit = defineEmits<{ confirm: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const titleId = useId();

function confirmLogout() {
  dialog.value?.close();
  emit("confirm");
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
  >
    <div class="modal-box max-w-sm">
      <h2 :id="titleId" class="text-lg font-semibold">确定退出登录？</h2>
      <div class="modal-action">
        <form method="dialog">
          <button class="btn">取消</button>
        </form>
        <button type="button" class="btn btn-error" @click="confirmLogout">退出登录</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>取消退出登录</button>
    </form>
  </dialog>
</template>
