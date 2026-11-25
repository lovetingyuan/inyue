<script setup lang="ts">
import { showMusicDialog } from "~/utils/music-dialog";
import AsyncButton from "~/components/AsyncButton.vue";
import { usePlayerStore } from "~/stores/player";
import PlaybackSlider from "~/components/PlaybackSlider.vue";
import PlaybackProgress from "~/components/PlaybackProgress.vue";
import MusicArtwork from "~/components/MusicArtwork.vue";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { ChevronDown, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "@lucide/vue";
import { useTimeoutFn } from "@vueuse/core";
import { storeToRefs } from "pinia";
import {
  canStartNowPlayingTransition,
  getNowPlayingTransitionStyle,
  waitForArtworkDecode,
} from "~/utils/now-playing-transition";
import type { NowPlayingTransitionState } from "~/types/now-playing-transition";
import type { Component } from "vue";
import { parseLrc } from "~~/shared/lrc";

defineOptions({ name: "NowPlayingDialog" });
const MusicLyrics = defineAsyncComponent(() => import("~/components/MusicLyrics.vue"));
defineProps<{
  shortcutsEnabled: boolean;
  refreshingQueue: boolean;
  playbackMode: { label: string; icon: Component };
  modeLabel: string;
  changingMode: boolean;
  muteLabel: string;
  toggleMute: () => Promise<void>;
}>();
const emit = defineEmits<{
  cycleMode: [];
  refreshQueue: [];
}>();

const transitionState = defineModel<NowPlayingTransitionState>("transitionState", {
  required: true,
});
const player = usePlayerStore();
const { current: track, position, volume, playing, loading, error } = storeToRefs(player);
const dialog = useTemplateRef("dialog");
const modalBox = useTemplateRef("modalBox");
const progressBar = useTemplateRef("progressBar");
const dialogOpen = ref(false);
const contentMounted = ref(false);
const vtActive = ref(false);
const hasLyrics = computed(() =>
  Boolean(track.value?.lyrics && parseLrc(track.value.lyrics).length),
);
const showLyrics = ref(false);
const showCoverAura = computed(
  () =>
    contentMounted.value &&
    !vtActive.value &&
    playing.value &&
    !(hasLyrics.value && showLyrics.value),
);
const lyricPosition = computed(() => progressBar.value?.displayedPosition ?? position.value);
const scrubbing = computed(() => progressBar.value?.scrubbing ?? false);
const { start: scheduleUnmount, stop: cancelUnmount } = useTimeoutFn(finishClose, 350, {
  immediate: false,
});

watch(
  [() => track.value?.id, hasLyrics],
  () => {
    showLyrics.value = hasLyrics.value;
  },
  { immediate: true },
);

function resetTransition() {
  vtActive.value = false;
  transitionState.value = { target: "none", includeCover: false };
  delete document.documentElement.dataset.vtNowPlaying;
}

function finishClose() {
  cancelUnmount();
  if (dialogOpen.value) {
    return;
  }
  contentMounted.value = false;
  showLyrics.value = hasLyrics.value;
}

function handleBoxTransitionEnd(event: TransitionEvent) {
  if (
    event.target === event.currentTarget &&
    event.propertyName === "translate" &&
    !dialogOpen.value &&
    !vtActive.value
  ) {
    finishClose();
  }
}

async function open() {
  if (dialog.value?.open || vtActive.value) {
    return;
  }
  cancelUnmount();
  if (!track.value || !canStartNowPlayingTransition()) {
    showLyrics.value = hasLyrics.value;
    contentMounted.value = true;
    dialogOpen.value = true;
    showMusicDialog(dialog.value);
    return;
  }

  const includeCover = !hasLyrics.value;
  vtActive.value = true;
  document.documentElement.dataset.vtNowPlaying = "";
  transitionState.value = { target: "player", includeCover };
  await nextTick();

  if (!track.value || dialog.value?.open) {
    resetTransition();
    return;
  }

  try {
    const transition = document.startViewTransition(async () => {
      transitionState.value = { target: "dialog", includeCover };
      showLyrics.value = hasLyrics.value;
      contentMounted.value = true;
      dialogOpen.value = true;
      showMusicDialog(dialog.value);
      await nextTick();
      if (includeCover) {
        await waitForArtworkDecode(modalBox.value);
      }
    });
    await transition.finished;
  } catch {
    showLyrics.value = hasLyrics.value;
    contentMounted.value = true;
    dialogOpen.value = true;
    showMusicDialog(dialog.value);
  } finally {
    resetTransition();
  }
}

async function requestClose() {
  if (!dialog.value?.open || vtActive.value) {
    return;
  }
  if (!track.value || !canStartNowPlayingTransition()) {
    dialog.value.close();
    return;
  }

  const includeCover = !(hasLyrics.value && showLyrics.value);
  progressBar.value?.resetPreview();
  cancelUnmount();
  vtActive.value = true;
  document.documentElement.dataset.vtNowPlaying = "";
  transitionState.value = { target: "dialog", includeCover };
  await nextTick();

  if (!dialog.value?.open) {
    resetTransition();
    return;
  }

  try {
    const transition = document.startViewTransition(async () => {
      transitionState.value = { target: "player", includeCover };
      dialogOpen.value = false;
      contentMounted.value = false;
      showLyrics.value = hasLyrics.value;
      dialog.value?.close();
      await nextTick();
    });
    await transition.finished;
  } catch {
    if (dialog.value?.open) {
      dialog.value.close();
    }
    dialogOpen.value = false;
    contentMounted.value = false;
    showLyrics.value = hasLyrics.value;
  } finally {
    resetTransition();
  }
}

function handleCancel(event: Event) {
  if (vtActive.value) {
    event.preventDefault();
    return;
  }
  if (!track.value || !canStartNowPlayingTransition()) {
    return;
  }
  event.preventDefault();
  void requestClose();
}

function handleClose() {
  progressBar.value?.resetPreview();
  dialogOpen.value = false;
  if (vtActive.value) {
    return;
  }
  const duration = modalBox.value
    ? Number.parseFloat(getComputedStyle(modalBox.value).transitionDuration)
    : 0;
  if (!duration) {
    finishClose();
    return;
  }
  scheduleUnmount();
}

onBeforeUnmount(() => {
  if (vtActive.value) {
    resetTransition();
  }
});

defineExpose({
  open,
  close: () => dialog.value?.close(),
});
</script>

<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:place-items-center"
    aria-labelledby="now-playing-title"
    data-playback-shortcuts
    :data-vt-active="vtActive ? '' : undefined"
    @cancel="handleCancel"
    @close="handleClose"
  >
    <div
      ref="modalBox"
      class="modal-box safe-panel flex h-dvh max-h-dvh w-screen max-w-none flex-col rounded-none bg-base-100 bg-linear-to-b from-primary/10 to-transparent to-70% p-0 sm:h-auto sm:max-h-[90dvh] sm:w-md sm:rounded-box"
      :style="getNowPlayingTransitionStyle(transitionState, 'dialog', 'panel')"
      @transitionend="handleBoxTransitionEnd"
    >
      <header
        class="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-5 pt-[calc(0.5rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] pb-1 sm:pt-3"
      >
        <button
          type="button"
          class="btn btn-ghost btn-circle min-h-11 min-w-11 justify-self-start"
          aria-label="收起正在播放"
          @click="requestClose"
        >
          <ChevronDown class="size-6 shrink-0" :stroke-width="1.8" aria-hidden="true" />
        </button>
        <h2
          id="now-playing-title"
          class="text-sm font-semibold text-base-content/70"
          :tabindex="shortcutsEnabled ? -1 : undefined"
          :autofocus="shortcutsEnabled"
        >
          正在播放
        </h2>
      </header>
      <div
        v-if="contentMounted && track"
        class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-5 pb-2.5 sm:px-8"
      >
        <div class="m-auto grid w-full max-w-sm shrink-0 gap-[clamp(0.875rem,2.2dvh,1.375rem)]">
          <div
            class="relative grid place-items-center [--cover-width:min(18rem,42dvh)] sm:[--cover-width:min(16.5rem,36dvh)]"
          >
            <component
              :is="hasLyrics ? 'button' : 'div'"
              :type="hasLyrics ? 'button' : undefined"
              class="grid w-full place-items-center"
              :class="[
                hasLyrics &&
                  'z-10 cursor-pointer select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                hasLyrics && showLyrics ? 'rounded-xl' : 'max-w-(--cover-width) rounded-[1.5rem]',
              ]"
              :aria-pressed="hasLyrics ? showLyrics : undefined"
              :aria-label="hasLyrics ? (showLyrics ? '显示封面' : '显示歌词') : undefined"
              @click="hasLyrics && (showLyrics = !showLyrics)"
            >
              <span
                class="isolate block w-full max-w-(--cover-width) [--aura-radius:1.5rem]"
                :class="[
                  showCoverAura ? 'aura aura-dual text-primary' : 'p-0.5',
                  { invisible: hasLyrics && showLyrics },
                ]"
              >
                <span class="inline-grid w-full align-top [@media(hover:hover)]:hover-3d">
                  <MusicArtwork
                    data-now-playing-cover
                    eager
                    :src="track.coverUrl"
                    :style="getNowPlayingTransitionStyle(transitionState, 'dialog', 'cover')"
                    class="w-full rounded-[1.5rem]! shadow-xl shadow-base-content/15 ring-1 ring-base-content/8"
                  />
                  <span v-for="zone in 8" :key="zone" aria-hidden="true" />
                </span>
              </span>
            </component>
            <MusicLyrics
              v-if="hasLyrics && showLyrics"
              :lyrics="track.lyrics"
              :position="lyricPosition"
              :scrubbing="scrubbing"
              class="absolute inset-0"
            />
          </div>
          <div class="min-w-0 mt-4">
            <p
              class="w-fit max-w-full truncate text-[clamp(1.125rem,4vw,1.375rem)] leading-tight font-bold tracking-tight"
              :title="track.title"
              :style="getNowPlayingTransitionStyle(transitionState, 'dialog', 'title')"
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
          <PlaybackProgress
            ref="progressBar"
            layout="stacked"
            :transition-state="transitionState"
            transition-owner="dialog"
          />
          <div class="flex items-center justify-center gap-6 sm:gap-8">
            <AsyncButton
              class="btn btn-ghost btn-circle btn-lg"
              aria-label="上一首"
              :aria-keyshortcuts="shortcutsEnabled ? 'Shift+ArrowLeft' : undefined"
              :title="shortcutsEnabled ? '上一首（Shift + ←）' : undefined"
              :style="getNowPlayingTransitionStyle(transitionState, 'dialog', 'prev')"
              :action="() => player.step(-1)"
            >
              <template #icon>
                <SkipBack
                  class="size-6 shrink-0"
                  :stroke-width="1.8"
                  aria-hidden="true"
                  fill="currentColor"
                />
              </template>
            </AsyncButton>
            <AsyncButton
              class="btn btn-primary btn-circle relative size-16 shadow-lg shadow-primary/20"
              :aria-label="playing ? '暂停' : '播放'"
              :loading="loading"
              :aria-keyshortcuts="shortcutsEnabled ? 'Space' : undefined"
              :title="shortcutsEnabled ? `${playing ? '暂停' : '播放'}（空格）` : undefined"
              :style="getNowPlayingTransitionStyle(transitionState, 'dialog', 'play')"
              :action="player.toggle"
            >
              <template #icon>
                <component
                  :is="playing ? Pause : Play"
                  class="size-7 shrink-0"
                  :stroke-width="1.8"
                  aria-hidden="true"
                  fill="currentColor"
                />
              </template>
            </AsyncButton>
            <AsyncButton
              class="btn btn-ghost btn-circle btn-lg"
              aria-label="下一首"
              :aria-keyshortcuts="shortcutsEnabled ? 'Shift+ArrowRight' : undefined"
              :title="shortcutsEnabled ? '下一首（Shift + →）' : undefined"
              :style="getNowPlayingTransitionStyle(transitionState, 'dialog', 'next')"
              :action="() => player.step(1)"
            >
              <template #icon>
                <SkipForward
                  class="size-6 shrink-0"
                  :stroke-width="1.8"
                  aria-hidden="true"
                  fill="currentColor"
                />
              </template>
            </AsyncButton>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2xl bg-base-200/75 p-1">
            <button
              type="button"
              class="btn btn-ghost h-11 shrink-0 gap-2 rounded-xl px-3 disabled:opacity-60"
              :aria-label="modeLabel"
              :disabled="changingMode"
              :aria-busy="changingMode"
              @click="emit('cycleMode')"
            >
              <span
                v-if="changingMode"
                class="loading loading-spinner loading-xs"
                aria-hidden="true"
              />
              <component
                v-else
                :is="playbackMode.icon"
                class="size-4 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
              />
              <span aria-live="polite">{{ playbackMode.label }}</span>
            </button>
            <div class="flex min-w-0 max-w-32 flex-1 items-center gap-1 pr-3 text-base-content/70">
              <AsyncButton
                class="btn btn-ghost btn-circle btn-sm shrink-0"
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
            v-if="error || refreshingQueue"
            class="flex items-center justify-between gap-2 text-sm text-error"
            role="alert"
          >
            {{ error }}
            <button
              class="btn btn-xs"
              :disabled="refreshingQueue"
              :aria-busy="refreshingQueue"
              @click="emit('refreshQueue')"
            >
              <span
                v-if="refreshingQueue"
                class="loading loading-spinner loading-xs"
                aria-hidden="true"
              />
              刷新队列
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-label="收起正在播放" @click="requestClose">
        关闭
      </button>
    </div>
  </dialog>
</template>
