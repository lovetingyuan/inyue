<script setup lang="ts">
import { formatMusicTime } from "~/utils/format-music-time";
import { getNowPlayingTransitionStyle } from "~/utils/now-playing-transition";
import { usePlayerStore } from "~/stores/player";
import PlaybackSlider from "~/components/PlaybackSlider.vue";
import { computed, ref, watch } from "vue";
import { useDocumentVisibility } from "@vueuse/core";
import { storeToRefs } from "pinia";
import type {
  NowPlayingTransitionState,
  NowPlayingTransitionTarget,
} from "~/types/now-playing-transition";

defineOptions({ name: "PlaybackProgress" });
const props = defineProps<{
  layout: "inline" | "stacked";
  transitionState?: NowPlayingTransitionState;
  transitionOwner?: Exclude<NowPlayingTransitionTarget, "none">;
}>();

function transitionStyle(slot: "progress" | "elapsed" | "duration") {
  if (!props.transitionState || !props.transitionOwner) {
    return undefined;
  }
  return getNowPlayingTransitionStyle(props.transitionState, props.transitionOwner, slot);
}

const player = usePlayerStore();
const { current: track, position } = storeToRefs(player);
const preview = ref<number>();
const scrubbing = computed(() => preview.value !== undefined);
const duration = computed(() => track.value?.duration || 0);
const displayedPosition = computed(() => preview.value ?? position.value);
const fill = computed(() =>
  duration.value ? Math.min(1, Math.max(0, displayedPosition.value / duration.value)) : 0,
);
let seekSequence = 0;

function resetPreview() {
  seekSequence += 1;
  preview.value = undefined;
}

async function commitSeek(value: number) {
  const sequence = ++seekSequence;
  preview.value = value;
  try {
    await player.seek(value);
  } finally {
    if (sequence === seekSequence) {
      preview.value = undefined;
    }
  }
}

watch(() => track.value?.id, resetPreview, { flush: "sync" });
watch(useDocumentVisibility(), resetPreview);
defineExpose({ resetPreview, displayedPosition, scrubbing });
</script>

<template>
  <div
    data-drawer-gesture-ignore
    class="grid w-full items-center tabular-nums"
    :class="
      layout === 'inline'
        ? 'grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 text-[11px] text-neutral-content/75'
        : 'grid-cols-2 text-xs text-base-content/70'
    "
  >
    <span
      :class="{ 'row-start-2 justify-self-start': layout === 'stacked' }"
      :style="transitionStyle('elapsed')"
      >{{ formatMusicTime(displayedPosition) }}</span
    >
    <PlaybackSlider
      :key="track?.id"
      data-playback-seek
      aria-label="播放进度"
      class="w-full min-w-0"
      :class="layout === 'inline' ? 'text-neutral-content' : 'range-primary col-span-2 row-start-1'"
      :style="transitionStyle('progress')"
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
    <span class="justify-self-end" :style="transitionStyle('duration')">{{
      formatMusicTime(duration)
    }}</span>
  </div>
</template>
