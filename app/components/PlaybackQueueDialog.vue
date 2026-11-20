<script setup lang="ts">
import { showMusicDialog } from "~/utils/music-dialog";
import { useCoverQuery } from "~/composables/useLibraryQueries";
import PlayingBars from "~/components/PlayingBars.vue";
import MusicArtwork from "~/components/MusicArtwork.vue";
import { ref, useTemplateRef } from "vue";
import { X } from "@lucide/vue";
import type { Track } from "~~/shared/types/library";

defineOptions({ name: "PlaybackQueueDialog" });
const props = defineProps<{
  shortcutsEnabled: boolean;
  queue: Track[];
  currentTrackId?: string;
  playing: boolean;
}>();
const emit = defineEmits<{ play: [trackId: string] }>();

const dialog = useTemplateRef("dialog");
const open = ref(false);
const { urls: covers } = useCoverQuery(() =>
  open.value ? props.queue.flatMap(({ coverId }) => (coverId ? [coverId] : [])) : [],
);

defineExpose({
  open: () => {
    showMusicDialog(dialog.value);
    open.value = Boolean(dialog.value?.open);
  },
  close: () => dialog.value?.close(),
});
</script>

<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:modal-middle"
    aria-labelledby="queue-title"
    data-playback-shortcuts
    @close="open = false"
  >
    <div
      class="modal-box safe-panel grid max-h-[75dvh] grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden"
    >
      <div class="flex items-center justify-between gap-2">
        <h2
          id="queue-title"
          class="text-lg font-bold"
          :tabindex="shortcutsEnabled ? -1 : undefined"
          :autofocus="shortcutsEnabled"
        >
          播放队列
          <span class="text-sm font-medium text-base-content/65">{{ queue.length }} 首</span>
        </h2>
        <form method="dialog">
          <button class="btn btn-ghost btn-circle btn-sm" aria-label="关闭播放队列">
            <X class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </form>
      </div>
      <ol class="grid content-start overflow-y-auto">
        <li v-for="item in queue" :key="item.id" class="min-w-0">
          <button
            type="button"
            class="btn btn-ghost flex h-auto w-full gap-3 p-2 text-left focus-visible:-outline-offset-2"
            :aria-current="item.id === currentTrackId ? 'true' : undefined"
            :class="{ 'bg-primary/10': item.id === currentTrackId }"
            @click="emit('play', item.id)"
          >
            <MusicArtwork :src="item.coverId ? covers[item.coverId] : item.coverUrl" class="w-9" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">{{ item.title }}</span>
              <span class="block truncate text-xs font-normal text-base-content/65">{{
                item.artist
              }}</span>
            </span>
            <PlayingBars
              v-if="playing && item.id === currentTrackId"
              class="size-4 shrink-0 text-primary mr-1"
            />
          </button>
        </li>
      </ol>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button aria-label="关闭播放队列">关闭</button>
    </form>
  </dialog>
</template>
