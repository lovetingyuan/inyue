<script setup lang="ts">
import { useDocumentVisibility } from "@vueuse/core";
import { storeToRefs } from "pinia";

defineOptions({ name: "PlaybackProgress" });
defineProps<{ layout: "inline" | "stacked" }>();

const player = usePlayerStore();
const { current: track, position } = storeToRefs(player);
const preview = ref<number>();
const duration = computed(() => track.value?.duration || 0);
const displayedPosition = computed(() => preview.value ?? position.value);
const fill = computed(() =>
  duration.value ? Math.min(1, Math.max(0, displayedPosition.value / duration.value)) : 0,
);

function resetPreview() {
  preview.value = undefined;
}

function commitSeek(value: number) {
  resetPreview();
  void player.seek(value);
}

watch(() => track.value?.id, resetPreview, { flush: "sync" });
watch(useDocumentVisibility(), resetPreview);
defineExpose({ resetPreview });
</script>

<template>
  <div
    class="grid w-full items-center tabular-nums"
    :class="
      layout === 'inline'
        ? 'grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 text-[11px] text-neutral-content/75'
        : 'grid-cols-2 text-xs text-base-content/70'
    "
  >
    <span :class="{ 'row-start-2': layout === 'stacked' }">{{
      formatMusicTime(displayedPosition)
    }}</span>
    <PlaybackSlider
      :key="track?.id"
      data-playback-seek
      aria-label="播放进度"
      class="w-full min-w-0"
      :class="layout === 'inline' ? 'text-neutral-content' : 'range-primary col-span-2 row-start-1'"
      :fill="fill"
      :max="duration"
      step="0.1"
      :value="displayedPosition"
      :disabled="!duration"
      @input="preview = $event"
      @change="commitSeek"
      @pointercancel="resetPreview"
      @blur="resetPreview"
    />
    <span class="justify-self-end">{{ formatMusicTime(duration) }}</span>
  </div>
</template>
