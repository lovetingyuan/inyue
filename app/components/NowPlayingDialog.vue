<script setup lang="ts">
import { ChevronDown, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "@lucide/vue";
import { storeToRefs } from "pinia";
import type { Component } from "vue";

defineOptions({ name: "NowPlayingDialog" });
defineProps<{
  duration: number;
  displayedPosition: number;
  progress: number;
  showLoadingRing: boolean;
  playbackMode: { label: string; icon: Component };
  modeLabel: string;
  changingMode: boolean;
  muteLabel: string;
}>();
const emit = defineEmits<{
  previewSeek: [value: number | undefined];
  seek: [value: number];
  cycleMode: [];
  toggleMute: [];
}>();

const player = usePlayerStore();
const { current: track, volume, playing, loading, error } = storeToRefs(player);
const dialog = useTemplateRef("dialog");

defineExpose({
  open: () => showMusicDialog(dialog.value),
  close: () => dialog.value?.close(),
});
</script>

<template>
  <dialog ref="dialog" class="modal" aria-labelledby="now-playing-title">
    <div
      class="modal-box safe-panel flex h-dvh max-h-dvh w-screen max-w-none flex-col rounded-none bg-base-100 bg-linear-to-b from-primary/10 to-transparent to-70% p-0 sm:h-auto sm:max-h-[90dvh] sm:w-md sm:rounded-box"
    >
      <header
        class="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-5 pt-[calc(0.5rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] pb-1 sm:pt-3"
      >
        <form method="dialog" class="justify-self-start">
          <button class="btn btn-ghost btn-circle min-h-11 min-w-11" aria-label="收起正在播放">
            <ChevronDown class="size-6 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </form>
        <h2 id="now-playing-title" class="text-sm font-semibold text-base-content/70">正在播放</h2>
      </header>
      <div v-if="track" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-2.5 sm:px-8">
        <div class="m-auto grid w-full max-w-sm shrink-0 gap-[clamp(0.875rem,2.2dvh,1.375rem)]">
          <MusicArtwork
            :src="track.coverUrl"
            class="ml-0! w-full max-w-[min(18rem,42dvh)] justify-self-center rounded-[1.5rem]! shadow-xl shadow-base-content/15 ring-1 ring-base-content/8 sm:max-w-[min(16.5rem,36dvh)]"
          />
          <div class="min-w-0">
            <p
              class="truncate text-[clamp(1.5rem,5vw,1.875rem)] leading-tight font-bold tracking-tight"
              :title="track.title"
            >
              {{ track.title }}
            </p>
            <p class="mt-1 flex items-baseline gap-2 text-sm text-base-content/70">
              <span class="truncate">
                {{ track.artist }}<template v-if="track.album"> · {{ track.album }}</template>
              </span>
              <span v-if="track.year != null" class="shrink-0 tabular-nums">
                <span class="mr-1" aria-hidden="true">·</span>
                {{ track.year }}年
              </span>
            </p>
          </div>
          <div>
            <PlaybackSlider
              :key="track.id"
              data-playback-seek
              aria-label="播放进度"
              class="range-primary w-full"
              :fill="progress"
              :max="duration"
              step="0.1"
              :value="displayedPosition"
              :disabled="!duration"
              @input="emit('previewSeek', $event)"
              @change="emit('seek', $event)"
              @pointercancel="emit('previewSeek', undefined)"
              @blur="emit('previewSeek', undefined)"
            />
            <div class="flex justify-between text-xs text-base-content/70 tabular-nums">
              <span>{{ formatMusicTime(displayedPosition) }}</span
              ><span>{{ formatMusicTime(duration) }}</span>
            </div>
          </div>
          <div class="flex items-center justify-center gap-6 sm:gap-8">
            <button
              type="button"
              class="btn btn-ghost btn-circle btn-lg"
              aria-label="上一首"
              @click="player.step(-1)"
            >
              <SkipBack
                class="size-6 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
                fill="currentColor"
              />
            </button>
            <button
              type="button"
              class="btn btn-primary btn-circle relative size-16 shadow-lg shadow-primary/20"
              :aria-label="playing ? '暂停' : '播放'"
              :aria-busy="loading"
              @click="player.toggle()"
            >
              <span
                v-if="showLoadingRing"
                aria-hidden="true"
                class="pointer-events-none absolute -inset-1 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
              />
              <component
                :is="playing ? Pause : Play"
                class="size-7 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
                fill="currentColor"
              />
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-circle btn-lg"
              aria-label="下一首"
              @click="player.step(1)"
            >
              <SkipForward
                class="size-6 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
                fill="currentColor"
              />
            </button>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2xl bg-base-200/75 p-1">
            <button
              type="button"
              class="btn btn-ghost h-11 shrink-0 gap-2 rounded-xl px-3 aria-disabled:opacity-60"
              :aria-label="modeLabel"
              :aria-disabled="changingMode"
              @click="emit('cycleMode')"
            >
              <component
                :is="playbackMode.icon"
                class="size-4 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
              />
              <span aria-live="polite">{{ playbackMode.label }}</span>
            </button>
            <div class="flex min-w-0 max-w-32 flex-1 items-center gap-1 pr-3 text-base-content/70">
              <button
                type="button"
                class="btn btn-ghost btn-circle btn-sm shrink-0"
                :aria-label="muteLabel"
                :title="muteLabel"
                @click="emit('toggleMute')"
              >
                <component
                  :is="volume === 0 ? VolumeX : Volume2"
                  class="size-4"
                  aria-hidden="true"
                />
              </button>
              <PlaybackSlider
                aria-label="音量"
                data-playback-volume
                class="min-w-0 flex-1"
                :fill="volume"
                max="1"
                step="0.05"
                :value="volume"
                @input="player.setVolume"
              />
            </div>
          </div>
          <div
            v-if="error"
            class="flex items-center justify-between gap-2 text-sm text-error"
            role="alert"
          >
            {{ error }} <button class="btn btn-xs" @click="player.refresh()">刷新队列</button>
          </div>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" aria-label="收起正在播放">关闭</button>
    </form>
  </dialog>
</template>
