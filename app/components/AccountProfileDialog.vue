<script setup lang="ts">
import AccountAvatar from "~/components/AccountAvatar.vue";
import { useAppStore } from "~/stores/app";
import { useSessionStore } from "~/stores/session";
import { libraryErrorCode, responseStatus } from "~/utils/library-error";
import { showMusicDialog } from "~/utils/music-dialog";
import { avatarFileTypes, prepareAvatar } from "~/utils/prepare-avatar";
import { useObjectUrl } from "@vueuse/core";
import { computed, nextTick, ref, shallowRef, useId, useTemplateRef } from "vue";
import { isProfileName, profileNameMaxLength } from "~~/shared/account-profile";
import type { AccountProfile } from "~~/shared/types/library";

defineOptions({ name: "AccountProfileDialog" });

const app = useAppStore();
const session = useSessionStore();
const dialog = useTemplateRef("dialog");
const fileInput = useTemplateRef("fileInput");
const fieldId = useId();
const original = shallowRef<AccountProfile>();
const name = ref("");
const avatar = shallowRef<Blob>();
const preview = useObjectUrl(avatar);
const resetAvatar = ref(false);
const preparing = ref(false);
const saving = ref(false);
const nameError = ref("");
const avatarError = ref("");
const formError = ref("");
const nameChanged = computed(() => name.value.trim() !== original.value?.name.trim());
const dirty = computed(() => nameChanged.value || Boolean(avatar.value) || resetAvatar.value);
const disabled = computed(() => saving.value || preparing.value || app.offline);

function clearDraft() {
  original.value = undefined;
  avatar.value = undefined;
  resetAvatar.value = false;
  preparing.value = false;
  nameError.value = "";
  avatarError.value = "";
  formError.value = "";
}

async function open(account: AccountProfile) {
  if (app.offline || session.signingOut || dialog.value?.open) {
    return;
  }
  clearDraft();
  original.value = { ...account };
  name.value = account.name;
  await nextTick();
  showMusicDialog(dialog.value);
}

async function selectAvatar(event: Event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const file = input.files?.[0];
  const snapshot = original.value;
  if (!file || !snapshot || preparing.value) {
    return;
  }
  avatarError.value = "";
  preparing.value = true;
  try {
    const result = await prepareAvatar(file);
    if (original.value === snapshot) {
      avatar.value = result;
      resetAvatar.value = false;
    }
  } catch (error) {
    if (original.value === snapshot) {
      avatarError.value = error instanceof Error ? error.message : "无法处理头像。";
      input.value = "";
    }
  } finally {
    if (original.value === snapshot) {
      preparing.value = false;
    }
  }
}

function toggleDefaultAvatar() {
  resetAvatar.value =
    !avatar.value && Boolean(original.value?.hasCustomAvatar) && !resetAvatar.value;
  avatar.value = undefined;
  avatarError.value = "";
  if (fileInput.value) {
    fileInput.value.value = "";
  }
}

async function save() {
  const id = original.value?.id;
  if (!id || disabled.value || !dirty.value) {
    return;
  }
  formError.value = "";
  const nextName = name.value.trim();
  if (nameChanged.value && !isProfileName(nextName)) {
    nameError.value = `请输入 1–${profileNameMaxLength} 个字符的昵称。`;
    return;
  }
  const body = new FormData();
  if (nameChanged.value) {
    body.set("name", nextName);
  }
  if (avatar.value) {
    body.set("avatar", avatar.value, "avatar.jpg");
  } else if (resetAvatar.value) {
    body.set("resetAvatar", "true");
  }
  saving.value = true;
  try {
    await session.saveAccountProfile(id, body);
    dialog.value?.close();
  } catch (error) {
    const status = responseStatus(error);
    switch (libraryErrorCode(error)) {
      case "INVALID_PROFILE_NAME":
        nameError.value = `请输入 1–${profileNameMaxLength} 个字符的昵称。`;
        break;
      case "INVALID_AVATAR":
      case "AVATAR_SIZE":
      case "UPLOAD_SIZE":
        avatarError.value = "无法保存这张头像，请重新选择图片。";
        break;
      default:
        if (status === 401 || status === 403) {
          formError.value = "请重新登录后再编辑资料。";
        } else if (
          status === 409 ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          formError.value = "账户已切换，请重新打开设置。";
          void session.refreshAccount();
        } else {
          formError.value = "保存失败，请检查网络后重试。";
        }
    }
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:modal-middle"
    :aria-labelledby="`${fieldId}-title`"
    @cancel="saving && $event.preventDefault()"
    @close="clearDraft"
  >
    <div class="modal-box safe-panel max-w-md">
      <form v-if="original" class="grid gap-3" novalidate @submit.prevent="save">
        <h2 :id="`${fieldId}-title`" class="text-lg font-semibold">编辑资料</h2>
        <div class="flex items-center gap-3">
          <AccountAvatar :image="preview ?? original.image" :name="name" class="size-16 text-xl" />
          <div class="grid min-w-0 flex-1 gap-1">
            <label :for="`${fieldId}-avatar`" class="text-sm font-medium">选择头像</label>
            <input
              :id="`${fieldId}-avatar`"
              ref="fileInput"
              class="file-input file-input-sm w-full"
              type="file"
              :accept="avatarFileTypes"
              :disabled="disabled"
              :aria-invalid="Boolean(avatarError)"
              :aria-describedby="avatarError ? `${fieldId}-avatar-error` : undefined"
              @change="selectAvatar"
            />
            <p
              v-if="preparing"
              class="flex items-center gap-1.5 text-sm text-base-content/70"
              role="status"
            >
              <span class="loading loading-spinner loading-xs" aria-hidden="true" /> 正在处理头像…
            </p>
            <p v-else-if="resetAvatar" class="text-sm text-base-content/70" role="status">
              保存后恢复默认头像
            </p>
          </div>
        </div>
        <button
          v-if="original.hasCustomAvatar || avatar"
          type="button"
          class="btn btn-ghost btn-sm justify-self-start"
          :disabled="disabled"
          @click="toggleDefaultAvatar"
        >
          {{ avatar ? "撤销更换" : resetAvatar ? "撤销恢复" : "恢复默认头像" }}
        </button>
        <p
          v-if="avatarError"
          :id="`${fieldId}-avatar-error`"
          class="text-sm text-error"
          role="alert"
        >
          {{ avatarError }}
        </p>
        <div class="grid gap-1 text-sm">
          <label :for="`${fieldId}-name`" class="font-medium">昵称</label>
          <input
            :id="`${fieldId}-name`"
            v-model="name"
            class="input w-full"
            autocomplete="nickname"
            required
            :disabled="saving || app.offline"
            :aria-invalid="Boolean(nameError)"
            :aria-describedby="nameError ? `${fieldId}-name-error` : undefined"
            @input="nameError = ''"
          />
          <p v-if="nameError" :id="`${fieldId}-name-error`" class="text-error" role="alert">
            {{ nameError }}
          </p>
        </div>
        <p v-if="formError" class="text-sm text-error" role="alert">{{ formError }}</p>
        <p v-if="app.offline" class="text-sm text-base-content/70" role="status">
          联网后可保存资料。
        </p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-ghost" :disabled="saving" @click="dialog?.close()">
            取消
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="disabled || !dirty"
            :aria-busy="saving"
          >
            <span v-if="saving" class="loading loading-spinner loading-xs" aria-hidden="true" />
            保存
          </button>
        </div>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" :disabled="saving">关闭资料编辑</button>
    </form>
  </dialog>
</template>
