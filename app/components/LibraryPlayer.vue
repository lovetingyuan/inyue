<script setup lang="ts">
import { useAppStore } from "~/stores/app";
import AsyncButton from "~/components/AsyncButton.vue";
import { usePlayerStore } from "~/stores/player";
import PlaybackSlider from "~/components/PlaybackSlider.vue";
import PlaybackQueueDialog from "~/components/PlaybackQueueDialog.vue";
import PlaybackProgress from "~/components/PlaybackProgress.vue";
import NowPlayingDialog from "~/components/NowPlayingDialog.vue";
import MusicArtwork from "~/components/MusicArtwork.vue";
import { computed, ref, useTemplateRef, watch } from "vue";
import {
  ListMusic,
  ListOrdered,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "@lucide/vue";
import { useAsyncState, useEventListener, useTimeoutFn } from "@vueuse/core";
import { useRouter } from "#app";
import { storeToRefs } from "pinia";
import type { PlaybackMode } from "~~/shared/types/library";

defineOptions({ name: "LibraryPlayer" });

const app = useAppStore();
const player = usePlayerStore();
const { currentRoute } = useRouter();
const { current: track, queue, volume, playing, loading, mode, error } = storeToRefs(player);
const shortcutsEnabled = computed(() => !app.native && currentRoute.value.path === "/");
const { isLoading: refreshingQueue, executeImmediate: refreshQueue } = useAsyncState(
  player.refresh,
  undefined,
  { immediate: false },
);
const nowPlaying = useTemplateRef("nowPlaying");
const queueDialog = useTemplateRef("queueDialog");
const playbackModes = {
  sequential: { label: "顺序播放", icon: ListOrdered },
  loop: { label: "列表循环", icon: Repeat },
  shuffle: { label: "随机播放", icon: Shuffle },
};
const playbackMode = computed(() => playbackModes[mode.value]);
const modeLabel = computed(() => `切换播放模式，当前为${playbackMode.value.label}`);
const muteLabel = computed(() => (volume.value === 0 ? "取消静音" : "静音"));
let lastAudibleVolume = 1;
const changingMode = ref(false);
const {
  isPending: showModeNotice,
  start: revealModeNotice,
  stop: hideModeNotice,
} = useTimeoutFn(() => {}, 1500, { immediate: false });

watch(
  volume,
  (value) => {
    if (value > 0) {
      lastAudibleVolume = value;
    }
  },
  { immediate: true, flush: "sync" },
);

watch(
  () => track.value?.id,
  (trackId) => {
    if (trackId) {
      return;
    }
    hideModeNotice();
    queueDialog.value?.close();
    nowPlaying.value?.close();
  },
  { flush: "sync" },
);

function toggleMute() {
  return player.setVolume(volume.value === 0 ? lastAudibleVolume : 0);
}

if (!app.native) {
  useEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const toggle = !event.shiftKey && event.key === " ";
    const step = event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight");
    if (
      !(toggle || step) ||
      !shortcutsEnabled.value ||
      !track.value ||
      app.drawerOpen ||
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    ) {
      return;
    }

    const target = event.target;
    if (
      !(target instanceof Element) ||
      (target instanceof HTMLElement && target.isContentEditable) ||
      target.closest(
        'input, textarea, select, [role="textbox"], [role="combobox"], [role="slider"]',
      ) ||
      (toggle && target.closest('button, a[href], summary, [role="button"]')) ||
      (step && document.getSelection()?.isCollapsed === false) ||
      document.querySelector("dialog[open]:not([data-playback-shortcuts])")
    ) {
      return;
    }

    event.preventDefault();
    if (event.repeat) {
      return;
    }
    if (toggle) {
      void player.toggle();
    } else {
      void player.step(event.key === "ArrowLeft" ? -1 : 1);
    }
  });
}

async function cycleMode() {
  if (changingMode.value) {
    return;
  }
  const previousMode = mode.value;
  let nextMode: PlaybackMode = "sequential";
  if (previousMode === "sequential") {
    nextMode = queue.value.length > 1 ? "loop" : "shuffle";
  } else if (previousMode === "loop") {
    nextMode = "shuffle";
  }

  changingMode.value = true;
  try {
    await player.setMode(nextMode);
    if (mode.value === nextMode && track.value) {
      revealModeNotice();
    }
  } finally {
    changingMode.value = false;
  }
}
</script>

<template>
  <footer v-if="track || error || refreshingQueue" class="@container/player shrink-0">
    <div class="px-3 py-2 @min-[40rem]/player:px-4 @min-[40rem]/player:pb-3">
      <div
        v-if="error || refreshingQueue"
        role="alert"
        class="alert alert-error alert-soft mb-2 text-sm"
      >
        {{ error }}
        <button
          class="btn btn-xs"
          :disabled="refreshingQueue"
          :aria-busy="refreshingQueue"
          @click="refreshQueue()"
        >
          <span
            v-if="refreshingQueue"
            class="loading loading-spinner loading-xs"
            aria-hidden="true"
          />
          刷新队列
        </button>
      </div>
      <div
        v-if="track"
        class="relative grid grid-cols-[minmax(0,1fr)_auto_6rem] items-center gap-x-2 gap-y-1 rounded-box bg-neutral px-2.5 py-2 text-neutral-content shadow-lg @min-[40rem]/player:px-4 @min-[48rem]/player:grid-cols-[minmax(0,1fr)_minmax(14rem,1.4fr)_minmax(0,1fr)]"
      >
        <div
          role="status"
          class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2"
        >
          <span
            v-if="showModeNotice"
            class="badge badge-neutral badge-sm h-auto whitespace-nowrap rounded-full px-3 py-1 shadow-sm"
          >
            {{ playbackMode.label }}
          </span>
        </div>
        <button
          type="button"
          class="flex min-w-0 cursor-pointer items-center gap-3 rounded-field text-left"
          aria-haspopup="dialog"
          aria-label="打开正在播放"
          @click="nowPlaying?.open()"
        >
          <MusicArtwork :src="track.coverUrl" class="w-11" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ track.title }}</span>
            <span class="block truncate text-xs text-neutral-content/70">{{ track.artist }}</span>
          </span>
        </button>
        <div
          class="contents @min-[48rem]/player:flex @min-[48rem]/player:flex-col @min-[48rem]/player:items-center"
        >
          <div
            class="flex items-center gap-0.5 @max-[48rem]/player:col-span-2 @min-[48rem]/player:gap-2"
          >
            <AsyncButton
              class="btn btn-ghost btn-circle text-neutral-content hover:bg-neutral-content/12"
              aria-label="上一首"
              :aria-keyshortcuts="shortcutsEnabled ? 'Shift+ArrowLeft' : undefined"
              :title="shortcutsEnabled ? '上一首（Shift + ←）' : undefined"
              :action="() => player.step(-1)"
            >
              <template #icon>
                <SkipBack
                  class="size-4 shrink-0"
                  :stroke-width="1.8"
                  aria-hidden="true"
                  fill="currentColor"
                />
              </template>
            </AsyncButton>
            <AsyncButton
              class="btn btn-circle relative size-10 border-0 bg-neutral-content text-neutral hover:bg-neutral-content/85"
              :aria-label="playing ? '暂停' : '播放'"
              :loading="loading"
              :aria-keyshortcuts="shortcutsEnabled ? 'Space' : undefined"
              :title="shortcutsEnabled ? `${playing ? '暂停' : '播放'}（空格）` : undefined"
              :action="player.toggle"
            >
              <template #icon>
                <component
                  :is="playing ? Pause : Play"
                  class="size-5 shrink-0"
                  :stroke-width="1.8"
                  aria-hidden="true"
                  fill="currentColor"
                />
              </template>
            </AsyncButton>
            <AsyncButton
              class="btn btn-ghost btn-circle text-neutral-content hover:bg-neutral-content/12"
              aria-label="下一首"
              :aria-keyshortcuts="shortcutsEnabled ? 'Shift+ArrowRight' : undefined"
              :title="shortcutsEnabled ? '下一首（Shift + →）' : undefined"
              :action="() => player.step(1)"
            >
              <template #icon>
                <SkipForward
                  class="size-4 shrink-0"
                  :stroke-width="1.8"
                  aria-hidden="true"
                  fill="currentColor"
                />
              </template>
            </AsyncButton>
            <button
              type="button"
              class="btn btn-ghost btn-circle text-neutral-content hover:bg-neutral-content/12 disabled:opacity-60"
              :aria-label="modeLabel"
              :title="modeLabel"
              :disabled="changingMode"
              :aria-busy="changingMode"
              @click="cycleMode"
            >
              <span
                v-if="changingMode"
                class="loading loading-spinner loading-xs"
                aria-hidden="true"
              />
              <component
                v-else
                :is="playbackMode.icon"
                class="size-5 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-circle text-neutral-content hover:bg-neutral-content/12 @min-[48rem]/player:hidden"
              aria-label="播放队列"
              aria-haspopup="dialog"
              @click="queueDialog?.open()"
            >
              <ListMusic class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
            </button>
          </div>
          <PlaybackProgress layout="inline" class="@max-[48rem]/player:col-span-2" />
        </div>
        <div class="flex min-w-0 items-center justify-end @min-[48rem]/player:gap-2">
          <div class="flex min-w-0 items-center gap-1">
            <AsyncButton
              class="btn btn-ghost btn-circle btn-sm shrink-0 text-neutral-content hover:bg-neutral-content/12"
              :aria-label="muteLabel"
              :title="muteLabel"
              :action="toggleMute"
            >
              <template #icon>
                <component
                  :is="volume === 0 ? VolumeX : Volume2"
                  class="size-4"
                  aria-hidden="true"
                />
              </template>
            </AsyncButton>
            <PlaybackSlider
              aria-label="音量"
              data-playback-volume
              class="w-18 min-w-0 text-neutral-content"
              :fill="volume"
              max="1"
              step="0.05"
              :value="volume"
              @input="player.setVolume"
            />
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-circle hidden text-neutral-content hover:bg-neutral-content/12 @min-[48rem]/player:inline-flex"
            aria-label="播放队列"
            aria-haspopup="dialog"
            @click="queueDialog?.open()"
          >
            <ListMusic class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </footer>

  <NowPlayingDialog
    ref="nowPlaying"
    :shortcuts-enabled="shortcutsEnabled"
    :refreshing-queue="refreshingQueue"
    :playback-mode="playbackMode"
    :mode-label="modeLabel"
    :changing-mode="changingMode"
    :mute-label="muteLabel"
    :toggle-mute="toggleMute"
    @refresh-queue="refreshQueue()"
    @cycle-mode="cycleMode"
  />
  <PlaybackQueueDialog
    ref="queueDialog"
    :shortcuts-enabled="shortcutsEnabled"
    :queue="queue"
    :current-track-id="track?.id"
    :playing="playing"
  />
</template>
