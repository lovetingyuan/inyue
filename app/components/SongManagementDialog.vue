<script setup lang="ts">
import type { Song } from "~~/shared/types/library";

defineProps<{ coverUrls: Record<string, string> }>();

const app = useAppStore();
const library = useLibraryStore();
const { data: details } = useSongDetailsState();
const dialog = useTemplateRef("dialog");
const songEditor = useTemplateRef("songEditor");
const playlistPicker = useTemplateRef("playlistPicker");
const editing = shallowRef<Song>();
const selectedSong = shallowRef<Song>();
const panel = ref<"song" | "details" | "delete">();
const libraryDelete = useLibraryDelete();
const pending = libraryDelete.isLoading;
const dialogError = ref("");

function closePanel() {
  panel.value = undefined;
  selectedSong.value = undefined;
  editing.value = undefined;
  library.songId = undefined;
}

function openSong(song: Song) {
  editing.value = song;
  panel.value = "song";
}

async function open(song: Song) {
  selectedSong.value = song;
  library.songId = song.id;
  dialogError.value = "";
  panel.value = "details";
  await nextTick();
  showMusicDialog(dialog.value);
}

async function removeSong() {
  const id = details.value?.id;
  if (!id || pending.value || app.offline) return;
  dialogError.value = "";
  try {
    await libraryDelete.mutateAsync({ kind: "song", id });
    dialog.value?.close();
  } catch (cause) {
    dialogError.value = libraryError(cause);
  }
}

onBeforeUnmount(() => {
  library.songId = undefined;
});

defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:modal-middle"
    :aria-label="panel === 'details' ? '歌曲详情' : '管理歌曲'"
    @cancel="(pending || songEditor?.busy) && $event.preventDefault()"
    @close="closePanel"
  >
    <div
      class="modal-box"
      :class="
        panel === 'details'
          ? 'flex max-h-[min(85dvh,42rem)] flex-col overflow-hidden p-0'
          : 'safe-panel'
      "
    >
      <SongEditor
        v-if="panel === 'song' && editing"
        ref="songEditor"
        :song="editing"
        :cover-url="editing.coverId ? coverUrls[editing.coverId] : undefined"
        @cancel="dialog?.close()"
        @saved="dialog?.close()"
      />
      <SongDetails
        v-else-if="panel === 'details' && selectedSong"
        :initial-song="selectedSong"
        :initial-cover-url="selectedSong.coverId ? coverUrls[selectedSong.coverId] : undefined"
        @close="dialog?.close()"
        @edit="openSong"
        @delete="panel = 'delete'"
        @playlists="playlistPicker?.open()"
      />
      <div v-else-if="panel === 'delete'" class="grid gap-3">
        <h2 class="text-lg font-semibold">删除《{{ details?.title }}》？</h2>
        <p v-if="dialogError" class="text-sm text-error" role="alert">{{ dialogError }}</p>
        <div class="flex justify-end gap-2">
          <button class="btn" :disabled="pending" @click="dialog?.close()">取消</button>
          <button class="btn btn-error" :disabled="pending || app.offline" @click="removeSong">
            确认删除
          </button>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" :disabled="pending || songEditor?.busy">关闭曲库弹窗</button>
    </form>
  </dialog>
  <SongPlaylistPicker v-if="panel === 'details' && details" ref="playlistPicker" />
</template>
