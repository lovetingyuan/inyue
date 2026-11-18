<script setup lang="ts">
import { showMusicDialog } from "~/utils/music-dialog";
import { libraryError, libraryFormError } from "~/utils/library-error";
import { useAppStore } from "~/stores/app";
import { usePlaylistState } from "~/composables/useLibraryQueries";
import { useLibraryDelete, usePlaylistSave } from "~/composables/useLibraryMutations";
import MusicArtwork from "~/components/MusicArtwork.vue";
import { computed, nextTick, reactive, ref, shallowRef, useId, useTemplateRef } from "vue";
import { X } from "@lucide/vue";
import { useObjectUrl } from "@vueuse/core";
import { coverMaxBytes } from "~~/shared/library-limits";
import type { Playlist } from "~~/shared/types/library";

const app = useAppStore();
const { covers } = usePlaylistState();
const dialog = useTemplateRef("dialog");
const panel = ref<"playlist" | "delete">();
const playlistName = ref("");
const playlistEdit = ref<Playlist>();
const playlistCover = shallowRef<File>();
const playlistCoverPreview = useObjectUrl(() =>
  panel.value === "playlist" ? playlistCover.value : undefined,
);
const removeCover = ref(false);
const hasPlaylistCover = computed(() =>
  Boolean(playlistCover.value || (playlistEdit.value?.coverId && !removeCover.value)),
);
const playlistSave = usePlaylistSave();
const libraryDelete = useLibraryDelete();
const pending = computed(() => playlistSave.isLoading.value || libraryDelete.isLoading.value);
const dialogError = ref("");
const playlistErrors = reactive({ name: "", cover: "" });
const playlistFieldId = useId();

async function open(item?: Playlist) {
  playlistEdit.value = item;
  playlistName.value = item?.name ?? "";
  playlistCover.value = undefined;
  removeCover.value = false;
  playlistErrors.name = "";
  playlistErrors.cover = "";
  dialogError.value = "";
  panel.value = "playlist";
  await nextTick();
  showMusicDialog(dialog.value);
}

function selectPlaylistCover(event: Event) {
  playlistCover.value =
    event.target instanceof HTMLInputElement ? event.target.files?.[0] : undefined;
  playlistErrors.cover =
    (playlistCover.value?.size ?? 0) > coverMaxBytes ? "封面不能超过 1 MiB。" : "";
}

function clearPlaylistCover() {
  playlistCover.value = undefined;
  removeCover.value = Boolean(playlistEdit.value?.coverId);
  playlistErrors.cover = "";
}

async function savePlaylist() {
  if (pending.value || app.offline) {
    return;
  }
  dialogError.value = "";
  if (!playlistName.value) {
    playlistErrors.name = "请填写歌单名称。";
  }
  if (!playlistName.value || (playlistCover.value?.size ?? 0) > coverMaxBytes) {
    return;
  }
  const body = new FormData();
  body.set("name", playlistName.value);
  if (playlistCover.value) {
    body.set("cover", playlistCover.value);
  } else if (removeCover.value) {
    body.set("removeCover", "true");
  }
  try {
    await playlistSave.mutateAsync({ playlistId: playlistEdit.value?.id, body });
    dialog.value?.close();
  } catch (cause) {
    const { field, message } = libraryFormError(cause);
    if (field === "name" || field === "cover") {
      playlistErrors[field] = message;
    } else {
      dialogError.value = message;
    }
  }
}

async function removePlaylist() {
  const id = playlistEdit.value?.id;
  if (!id || pending.value || app.offline) {
    return;
  }
  dialogError.value = "";
  try {
    await libraryDelete.mutateAsync({ kind: "playlist", id });
    dialog.value?.close();
  } catch (cause) {
    dialogError.value = libraryError(cause);
  }
}

function closePanel() {
  panel.value = undefined;
  playlistEdit.value = undefined;
  playlistCover.value = undefined;
}

defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:modal-middle"
    :aria-label="panel === 'delete' ? '删除歌单' : playlistEdit ? '编辑歌单' : '新建歌单'"
    @cancel="pending && $event.preventDefault()"
    @close="closePanel"
  >
    <div class="modal-box safe-panel">
      <form
        v-if="panel === 'playlist'"
        class="grid gap-3"
        novalidate
        @submit.prevent="savePlaylist"
      >
        <h2 class="text-lg font-semibold">{{ playlistEdit ? "编辑歌单" : "新建歌单" }}</h2>
        <div class="grid gap-1">
          <label :for="`${playlistFieldId}-name`">歌单名称</label>
          <input
            :id="`${playlistFieldId}-name`"
            v-model.trim="playlistName"
            class="input validator w-full"
            required
            maxlength="250"
            :disabled="pending"
            :aria-invalid="!!playlistErrors.name"
            :aria-describedby="playlistErrors.name ? `${playlistFieldId}-name-error` : undefined"
            @input="playlistErrors.name = ''"
          />
          <p
            v-if="playlistErrors.name"
            :id="`${playlistFieldId}-name-error`"
            class="validator-hint mt-0"
            role="alert"
          >
            {{ playlistErrors.name }}
          </p>
        </div>
        <div class="grid gap-1">
          <span v-if="hasPlaylistCover">封面</span>
          <label v-else :for="`${playlistFieldId}-cover`">封面</label>
          <div v-if="hasPlaylistCover" class="relative w-fit">
            <MusicArtwork
              :src="
                playlistCoverPreview ??
                (playlistEdit?.coverId ? covers[playlistEdit.coverId] : undefined)
              "
              class="w-28"
            />
            <button
              type="button"
              class="btn btn-circle btn-sm absolute top-1 right-1"
              aria-label="移除封面"
              :disabled="pending"
              @click="clearPlaylistCover"
            >
              <X class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
            </button>
          </div>
          <input
            v-else
            :id="`${playlistFieldId}-cover`"
            class="file-input validator w-full"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            :disabled="pending"
            :aria-invalid="!!playlistErrors.cover"
            :aria-describedby="playlistErrors.cover ? `${playlistFieldId}-cover-error` : undefined"
            @change="selectPlaylistCover"
          />
          <p
            v-if="playlistErrors.cover"
            :id="`${playlistFieldId}-cover-error`"
            class="validator-hint mt-0"
            role="alert"
          >
            {{ playlistErrors.cover }}
          </p>
        </div>
        <p v-if="dialogError" class="text-sm text-error" role="alert">{{ dialogError }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button
            v-if="playlistEdit"
            type="button"
            class="btn btn-error btn-outline mr-auto"
            :disabled="pending || app.offline"
            @click="
              dialogError = '';
              panel = 'delete';
            "
          >
            删除歌单
          </button>
          <button type="button" class="btn" :disabled="pending" @click="dialog?.close()">
            取消
          </button>
          <button type="submit" class="btn btn-primary" :disabled="pending || app.offline">
            保存
          </button>
        </div>
      </form>
      <div v-else-if="panel === 'delete'" class="grid gap-3">
        <h2 class="text-lg font-semibold">删除歌单「{{ playlistEdit?.name }}」？</h2>
        <p>歌单中的歌曲会保留。</p>
        <p v-if="dialogError" class="text-sm text-error" role="alert">{{ dialogError }}</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn" :disabled="pending" @click="dialog?.close()">
            取消
          </button>
          <button
            type="button"
            class="btn btn-error"
            :disabled="pending || app.offline"
            @click="removePlaylist"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" :disabled="pending">关闭歌单弹窗</button>
    </form>
  </dialog>
</template>
