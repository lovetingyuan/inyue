<script setup lang="ts">
import { AudioLines, X } from "@lucide/vue";
import type { Track } from "~~/shared/types/library";

defineOptions({ name: "PlaybackQueueDialog" });
defineProps<{ queue: Track[]; currentTrackId?: string }>();

const dialog = useTemplateRef("dialog");

defineExpose({
  open: () => showMusicDialog(dialog.value),
  close: () => dialog.value?.close(),
});
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle" aria-labelledby="queue-title">
    <div
      class="modal-box safe-panel grid max-h-[75dvh] grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden"
    >
      <div class="flex items-center justify-between gap-2">
        <h2 id="queue-title" class="text-xl font-bold">
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
        <li
          v-for="item in queue"
          :key="item.id"
          class="flex items-center gap-3 rounded-field p-2"
          :aria-current="item.id === currentTrackId ? 'true' : undefined"
          :class="{ 'bg-primary/10': item.id === currentTrackId }"
        >
          <MusicArtwork :src="item.coverUrl" class="w-9" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ item.title }}</span>
            <span class="block truncate text-xs text-base-content/65">{{ item.artist }}</span>
          </span>
          <AudioLines
            v-if="item.id === currentTrackId"
            class="size-4 text-primary shrink-0"
            :stroke-width="1.8"
            aria-hidden="true"
          />
        </li>
      </ol>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button aria-label="关闭播放队列">关闭</button>
    </form>
  </dialog>
</template>
