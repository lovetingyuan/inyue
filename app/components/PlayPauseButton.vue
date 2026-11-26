<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRafFn } from "@vueuse/core";

defineOptions({ name: "PlayPauseButton" });

const props = defineProps<{
  playing: boolean;
  loading?: boolean;
  shortcutsEnabled?: boolean;
  iconClass?: string;
  action: () => Promise<unknown>;
}>();

type Corner = readonly [number, number, number, number, number, number, number, number];
type MorphShape = readonly [Corner, Corner, Corner, Corner];

const MORPH_DURATION_MS = 260;
const MIN_MORPH_DURATION_MS = 120;

const PLAY_LEFT: MorphShape = [
  [5, 5, 5, 3.456, 6.674, 2.495, 8.008, 3.272],
  [12.5, 5.892, 12.5, 5.892, 12.5, 5.892, 12.5, 5.892],
  [12.5, 18.108, 12.5, 18.108, 12.5, 18.108, 12.5, 18.108],
  [8.008, 20.728, 6.674, 21.505, 5, 20.544, 5, 19],
];

const PAUSE_LEFT: MorphShape = [
  [5, 4, 5, 3.448, 5.448, 3, 6, 3],
  [9, 3, 9.552, 3, 10, 3.448, 10, 4],
  [10, 20, 10, 20.552, 9.552, 21, 9, 21],
  [6, 21, 5.448, 21, 5, 20.552, 5, 20],
];

const PLAY_RIGHT: MorphShape = [
  [12.5, 5.892, 12.5, 5.892, 12.5, 5.892, 12.5, 5.892],
  [20.013, 10.272, 20.627, 10.631, 21.005, 11.289, 21.005, 12],
  [21.005, 12, 21.005, 12.711, 20.627, 13.369, 20.013, 13.728],
  [12.5, 18.108, 12.5, 18.108, 12.5, 18.108, 12.5, 18.108],
];

const PAUSE_RIGHT: MorphShape = [
  [14, 4, 14, 3.448, 14.448, 3, 15, 3],
  [18, 3, 18.552, 3, 19, 3.448, 19, 4],
  [19, 20, 19, 20.552, 18.552, 21, 18, 21],
  [15, 21, 14.448, 21, 14, 20.552, 14, 20],
];

function lerp(from: number, to: number, t: number) {
  return Number((from + (to - from) * t).toFixed(2));
}

function interpolateCorner(from: Corner, to: Corner, t: number): Corner {
  return [
    lerp(from[0], to[0], t),
    lerp(from[1], to[1], t),
    lerp(from[2], to[2], t),
    lerp(from[3], to[3], t),
    lerp(from[4], to[4], t),
    lerp(from[5], to[5], t),
    lerp(from[6], to[6], t),
    lerp(from[7], to[7], t),
  ];
}

function buildMorphPath(from: MorphShape, to: MorphShape, t: number) {
  const [tl, tr, br, bl] = [
    interpolateCorner(from[0], to[0], t),
    interpolateCorner(from[1], to[1], t),
    interpolateCorner(from[2], to[2], t),
    interpolateCorner(from[3], to[3], t),
  ];
  return (
    `M${tl[0]} ${tl[1]}C${tl[2]} ${tl[3]} ${tl[4]} ${tl[5]} ${tl[6]} ${tl[7]}` +
    `L${tr[0]} ${tr[1]}C${tr[2]} ${tr[3]} ${tr[4]} ${tr[5]} ${tr[6]} ${tr[7]}` +
    `L${br[0]} ${br[1]}C${br[2]} ${br[3]} ${br[4]} ${br[5]} ${br[6]} ${br[7]}` +
    `L${bl[0]} ${bl[1]}C${bl[2]} ${bl[3]} ${bl[4]} ${bl[5]} ${bl[6]} ${bl[7]}Z`
  );
}

const pending = ref(false);
const progress = ref(props.playing ? 1 : 0);
const leftPath = computed(() => buildMorphPath(PLAY_LEFT, PAUSE_LEFT, progress.value));
const rightPath = computed(() => buildMorphPath(PLAY_RIGHT, PAUSE_RIGHT, progress.value));
const label = computed(() => (props.playing ? "暂停" : "播放"));

let startProgress = progress.value;
let targetProgress = progress.value;
let startTime = 0;
let duration = MORPH_DURATION_MS;

const { pause: stopMorph, resume: startMorph } = useRafFn(
  ({ timestamp }) => {
    const raw = Math.max(0, Math.min(1, (timestamp - startTime) / duration));
    const eased = 1 - (1 - raw) ** 3;
    progress.value = startProgress + (targetProgress - startProgress) * eased;
    if (raw >= 1) {
      progress.value = targetProgress;
      stopMorph();
    }
  },
  { immediate: false },
);

watch(
  () => props.playing,
  (isPlaying) => {
    const nextTarget = isPlaying ? 1 : 0;
    if (nextTarget === targetProgress && progress.value === nextTarget) {
      return;
    }
    startProgress = progress.value;
    targetProgress = nextTarget;
    duration = Math.max(
      MIN_MORPH_DURATION_MS,
      Math.round(MORPH_DURATION_MS * Math.abs(targetProgress - startProgress)),
    );
    startTime = performance.now();
    startMorph();
  },
);

async function togglePlayback() {
  if (pending.value) {
    return;
  }
  pending.value = true;
  try {
    await props.action();
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :aria-busy="loading || pending"
    :aria-keyshortcuts="shortcutsEnabled ? 'Space' : undefined"
    :title="shortcutsEnabled ? `${label}（空格）` : undefined"
    @click="togglePlayback"
  >
    <span class="grid place-items-center" aria-hidden="true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="col-start-1 row-start-1 shrink-0 transition-[opacity,transform] duration-150"
        :class="[iconClass, loading ? 'scale-75 opacity-0' : 'scale-100 opacity-100']"
      >
        <path :d="leftPath" />
        <path :d="rightPath" />
      </svg>
      <span
        v-if="loading"
        class="loading loading-spinner loading-xs col-start-1 row-start-1 shrink-0"
      />
    </span>
  </button>
</template>
