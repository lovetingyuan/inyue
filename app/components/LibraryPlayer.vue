<script setup lang="ts">
import {
  AudioLines,
  ChevronDown,
  ListMusic,
  ListOrdered,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "@lucide/vue";
import { useTimeoutFn } from "@vueuse/core";
import { storeToRefs } from "pinia";
import type { PlaybackMode } from "~~/shared/types/library";

const player = usePlayerStore();
const { current: track, queue, position, volume, playing, mode, error } = storeToRefs(player);
const nowPlaying = useTemplateRef("nowPlaying");
const queueDialog = useTemplateRef("queueDialog");
const playbackModes = {
  sequential: { label: "顺序播放", icon: ListOrdered },
  loop: { label: "列表循环", icon: Repeat },
  shuffle: { label: "随机播放", icon: Shuffle },
};
const modeLabel = computed(() => `切换播放模式，当前为${playbackModes[mode.value].label}`);
const changingMode = ref(false);
const {
  isPending: showModeNotice,
  start: revealModeNotice,
  stop: hideModeNotice,
} = useTimeoutFn(() => {}, 1500, { immediate: false });
const duration = computed(() => track.value?.duration || 0);
const seekPreview = ref<number>();
const displayedPosition = computed(() => seekPreview.value ?? position.value);
const progress = computed(() =>
  duration.value ? Math.min(1, Math.max(0, displayedPosition.value / duration.value)) : 0,
);

watch(
  () => track.value?.id,
  (trackId) => {
    seekPreview.value = undefined;
    if (trackId) return;
    hideModeNotice();
    queueDialog.value?.close();
    nowPlaying.value?.close();
  },
  { flush: "sync" },
);

function rangeValue(event: Event) {
  return event.target instanceof HTMLInputElement ? event.target.valueAsNumber : 0;
}

function commitSeek(event: Event) {
  seekPreview.value = undefined;
  void player.seek(rangeValue(event));
}

async function cycleMode() {
  if (changingMode.value) return;
  const previousMode = mode.value;
  let nextMode: PlaybackMode = "sequential";
  if (previousMode === "sequential") nextMode = queue.value.length > 1 ? "loop" : "shuffle";
  else if (previousMode === "loop") nextMode = "shuffle";

  changingMode.value = true;
  try {
    await player.setMode(nextMode);
    if (mode.value === nextMode && track.value) revealModeNotice();
  } finally {
    changingMode.value = false;
  }
}
</script>

<template>
  <footer v-if="track || error" class="shrink-0 px-3 pb-2 pt-2 sm:px-4 sm:pb-3">
    <div v-if="error" role="alert" class="alert alert-error alert-soft mb-2 text-sm">
      {{ error }} <button class="btn btn-xs" @click="player.refresh()">刷新队列</button>
    </div>
    <div
      v-if="track"
      class="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-box bg-neutral px-2.5 py-2 text-neutral-content shadow-lg sm:px-4 md:grid-cols-[minmax(0,1fr)_minmax(14rem,1.4fr)_minmax(0,1fr)]"
    >
      <div
        role="status"
        class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2"
      >
        <span
          v-if="showModeNotice"
          class="badge badge-neutral badge-sm h-auto whitespace-nowrap rounded-full px-3 py-1 shadow-sm"
        >
          {{ playbackModes[mode].label }}
        </span>
      </div>
      <button
        type="button"
        class="flex min-w-0 cursor-pointer items-center gap-3 rounded-field text-left"
        aria-haspopup="dialog"
        aria-label="打开正在播放"
        @click="showMusicDialog(nowPlaying)"
      >
        <MusicArtwork :src="track.coverUrl" class="w-11" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold">{{ track.title }}</span>
          <span class="block truncate text-xs text-neutral-content/70">{{ track.artist }}</span>
        </span>
      </button>
      <div class="contents md:flex md:flex-col md:items-center">
        <div class="flex items-center gap-0.5 md:gap-2">
          <button
            type="button"
            class="btn btn-ghost btn-circle text-neutral-content hover:bg-neutral-content/12"
            aria-label="上一首"
            @click="player.step(-1)"
          >
            <SkipBack
              class="size-4 shrink-0"
              :stroke-width="1.8"
              aria-hidden="true"
              fill="currentColor"
            />
          </button>
          <button
            type="button"
            class="btn btn-circle size-10 border-0 bg-neutral-content text-neutral hover:bg-neutral-content/85"
            :aria-label="playing ? '暂停' : '播放'"
            @click="player.toggle()"
          >
            <component
              :is="playing ? Pause : Play"
              class="size-5 shrink-0"
              :stroke-width="1.8"
              aria-hidden="true"
              fill="currentColor"
            />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-circle text-neutral-content hover:bg-neutral-content/12"
            aria-label="下一首"
            @click="player.step(1)"
          >
            <SkipForward
              class="size-4 shrink-0"
              :stroke-width="1.8"
              aria-hidden="true"
              fill="currentColor"
            />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-circle text-neutral-content hover:bg-neutral-content/12 aria-disabled:opacity-60"
            :aria-label="modeLabel"
            :title="modeLabel"
            :aria-disabled="changingMode"
            @click="cycleMode"
          >
            <component
              :is="playbackModes[mode].icon"
              class="size-5 shrink-0"
              :stroke-width="1.8"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-circle text-neutral-content hover:bg-neutral-content/12 md:hidden"
            aria-label="播放队列"
            aria-haspopup="dialog"
            @click="showMusicDialog(queueDialog)"
          >
            <ListMusic class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </div>
        <div
          class="col-span-full flex w-full items-center gap-2 text-[11px] text-neutral-content/75 tabular-nums"
        >
          <span>{{ formatMusicTime(displayedPosition) }}</span>
          <input
            :key="track.id"
            data-playback-seek
            aria-label="播放进度"
            class="range range-xs min-h-6 min-w-0 flex-1 touch-none text-neutral-content"
            type="range"
            min="0"
            :max="duration"
            step="0.1"
            :value="displayedPosition"
            :disabled="!duration"
            @input="seekPreview = rangeValue($event)"
            @change="commitSeek"
            @pointercancel="seekPreview = undefined"
            @blur="seekPreview = undefined"
          />
          <span>{{ formatMusicTime(duration) }}</span>
        </div>
      </div>
      <div class="hidden items-center justify-end gap-3 md:flex">
        <label class="hidden items-center gap-2 lg:flex">
          <Volume2 class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          <input
            aria-label="音量"
            data-playback-volume
            class="range range-xs min-h-6 w-18 touch-none text-neutral-content"
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="volume"
            @input="player.setVolume(rangeValue($event))"
          />
        </label>
        <button
          type="button"
          class="btn btn-ghost btn-circle text-neutral-content hover:bg-neutral-content/12"
          aria-label="播放队列"
          aria-haspopup="dialog"
          @click="showMusicDialog(queueDialog)"
        >
          <ListMusic class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </div>
    </div>
  </footer>

  <dialog ref="nowPlaying" class="modal" aria-labelledby="now-playing-title">
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
      <div
        v-if="track"
        class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-2.5 sm:px-8"
      >
        <div class="m-auto grid w-full max-w-sm shrink-0 gap-[clamp(0.875rem,2.2dvh,1.375rem)]">
          <MusicArtwork
            :src="track.coverUrl"
            class="ml-0! w-full max-w-[min(18rem,42dvh)] justify-self-center rounded-[1.5rem]! shadow-xl shadow-base-content/15 ring-1 ring-base-content/8 sm:max-w-[min(16.5rem,36dvh)]"
          />
          <div class="min-w-0">
            <p class="truncate text-[clamp(1.5rem,5vw,1.875rem)] leading-tight font-bold tracking-tight" :title="track.title">
              {{ track.title }}
            </p>
            <p class="mt-1 flex items-baseline gap-2 text-sm text-base-content/70">
              <span class="truncate">
                {{ track.artist }}<template v-if="track.album"> · {{ track.album }}</template>
              </span>
              <span v-if="track.year != null" class="shrink-0 tabular-nums">
                <span class="mr-1" aria-hidden="true">·</span> {{ track.year }}
              </span>
            </p>
          </div>
          <div>
            <input
              :key="track.id"
              data-playback-seek
              aria-label="播放进度"
              class="range range-primary range-xs min-h-6 w-full touch-none"
              type="range"
              min="0"
              :max="duration"
              step="0.1"
              :value="displayedPosition"
              :disabled="!duration"
              @input="seekPreview = rangeValue($event)"
              @change="commitSeek"
              @pointercancel="seekPreview = undefined"
              @blur="seekPreview = undefined"
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
              class="btn btn-primary btn-circle size-16 shadow-lg shadow-primary/20"
              :aria-label="playing ? '暂停' : '播放'"
              @click="player.toggle()"
            >
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
              @click="cycleMode"
            >
              <component
                :is="playbackModes[mode].icon"
                class="size-4 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
              />
              <span aria-live="polite">{{ playbackModes[mode].label }}</span>
            </button>
            <label class="flex min-w-0 max-w-32 flex-1 items-center gap-2 pr-3 text-base-content/70">
              <Volume2 class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
              <input
                aria-label="音量"
                data-playback-volume
                class="range range-xs min-h-6 min-w-0 flex-1 touch-none"
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="volume"
                @input="player.setVolume(rangeValue($event))"
              />
            </label>
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
  <dialog
    ref="queueDialog"
    class="modal modal-bottom sm:modal-middle"
    aria-labelledby="queue-title"
  >
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
          :aria-current="item.id === track?.id ? 'true' : undefined"
          :class="{ 'bg-primary/10': item.id === track?.id }"
        >
          <MusicArtwork :src="item.coverUrl" class="w-9" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ item.title }}</span>
            <span class="block truncate text-xs text-base-content/65">{{ item.artist }}</span>
          </span>
          <AudioLines
            v-if="item.id === track?.id"
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

<style scoped>
[data-playback-seek] {
  --slider-value: v-bind(progress);
}

[data-playback-volume] {
  --slider-value: v-bind(volume);
}

[data-playback-seek],
[data-playback-volume] {
  --range-thumb-size: 0.625rem;
  --range-thumb: currentColor;
  --range-p: 0px;
  --range-bg: transparent;
  --range-fill: 0;
  --slider-stop: calc(
    var(--range-thumb-size) / 2 + (100% - var(--range-thumb-size)) * var(--slider-value)
  );
  background: linear-gradient(
      90deg,
      currentColor var(--slider-stop),
      color-mix(in oklab, currentColor 24%, transparent) 0
    )
    center / 100% 0.25rem no-repeat;
}

@media (forced-colors: active) {
  [data-playback-seek],
  [data-playback-volume] {
    appearance: auto;
    background: none;
  }
}
</style>
