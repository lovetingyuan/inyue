<script setup lang="ts">
import {
  computed,
  onBeforeUpdate,
  ref,
  useTemplateRef,
  watch,
  type ComponentPublicInstance,
} from "vue";
import { useResizeObserver } from "@vueuse/core";
import { findActiveLrcIndex, parseLrc } from "~~/shared/lrc";

defineOptions({ name: "MusicLyrics" });

const props = defineProps<{
  lyrics?: string | null;
  position: number;
  scrubbing?: boolean;
}>();

const viewport = useTemplateRef("viewport");
const lines = computed(() => parseLrc(props.lyrics));
const activeIndex = computed(() => findActiveLrcIndex(lines.value, props.position));
const offsetY = ref(0);
const animate = ref(false);
const lineElements: (HTMLLIElement | null)[] = [];

onBeforeUpdate(() => {
  lineElements.length = 0;
});

function setLineRef(index: number, el: Element | ComponentPublicInstance | null) {
  lineElements[index] = el instanceof HTMLLIElement ? el : null;
}

function updateOffset(animated: boolean) {
  const container = viewport.value;
  if (!container || !lines.value.length) {
    offsetY.value = 0;
    return;
  }
  const height = container.clientHeight;
  if (height <= 0) {
    return;
  }
  const targetIndex = activeIndex.value >= 0 ? activeIndex.value : 0;
  const item = lineElements[targetIndex];
  if (!item) {
    return;
  }
  animate.value = animated;
  offsetY.value = Math.round(height / 2 - (item.offsetTop + item.offsetHeight / 2));
}

watch(
  [lines, activeIndex],
  ([nextLines], [prevLines]) => {
    updateOffset(nextLines === prevLines);
  },
  { immediate: true, flush: "post" },
);

useResizeObserver(viewport, () => {
  updateOffset(false);
});
</script>

<template>
  <div ref="viewport" class="pointer-events-none overflow-hidden select-none">
    <div
      v-if="lines.length"
      class="size-full overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_16%,black_84%,transparent)]"
    >
      <ul
        class="relative will-change-transform"
        :class="
          animate
            ? scrubbing
              ? 'transition-transform duration-150 ease-out'
              : 'transition-transform duration-300 ease-out'
            : 'transition-none'
        "
        :style="{ transform: `translateY(${offsetY}px)` }"
      >
        <li
          v-for="(line, index) in lines"
          :key="`${line.time}-${index}`"
          :ref="(el) => setLineRef(index, el)"
          class="px-2 py-1.5 text-center leading-relaxed wrap-anywhere"
          :class="
            index === activeIndex
              ? 'text-base font-bold text-primary'
              : 'text-sm font-normal text-base-content/50'
          "
          :aria-current="index === activeIndex ? 'true' : undefined"
        >
          <p
            v-for="(text, subIndex) in line.lines"
            :key="subIndex"
            :class="subIndex > 0 ? 'mt-0.5 text-[0.875em] opacity-85' : undefined"
          >
            {{ text }}
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>
