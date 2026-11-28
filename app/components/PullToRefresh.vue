<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { RefreshCw } from "@lucide/vue";
import type { PullToRefreshPhase } from "~/types/pull-to-refresh";
import { attachPullToRefresh } from "~/utils/pull-to-refresh";

defineOptions({ name: "PullToRefresh" });

const props = withDefaults(
  defineProps<{
    refresh: () => void | Promise<void>;
    disabled?: boolean;
    contentClass?: string;
    announcementLabel?: string;
  }>(),
  {
    disabled: false,
    contentClass: "",
    announcementLabel: "正在刷新",
  },
);

const refreshing = defineModel<boolean>("refreshing", { default: false });

const scroller = useTemplateRef<HTMLDivElement>("scroller");
const content = useTemplateRef<HTMLDivElement>("content");
const indicator = useTemplateRef<HTMLDivElement>("indicator");
const icon = useTemplateRef<HTMLSpanElement>("icon");
const phase = ref<PullToRefreshPhase>("idle");
let gesture: ReturnType<typeof attachPullToRefresh> | undefined;

const active = computed(() => phase.value === "refreshing" || phase.value === "completing");
const highlighted = computed(() => phase.value === "ready" || active.value);
const label = computed(() => {
  if (active.value) {
    return "刷新中…";
  }
  return phase.value === "ready" ? "释放刷新" : "下拉刷新";
});
const announcement = computed(() => (phase.value === "refreshing" ? props.announcementLabel : ""));

function reset() {
  gesture?.reset();
}

onMounted(() => {
  if (!scroller.value || !content.value || !indicator.value) {
    return;
  }
  gesture = attachPullToRefresh({
    scroller: scroller.value,
    content: content.value,
    indicator: indicator.value,
    getIcon: () => icon.value,
    isEnabled: () => !props.disabled,
    onRefresh: () => props.refresh(),
    onPhaseChange(nextPhase) {
      phase.value = nextPhase;
      refreshing.value = nextPhase === "refreshing";
    },
  });
});

watch(
  () => props.disabled,
  (isDisabled) => {
    if (isDisabled && (phase.value === "pulling" || phase.value === "ready")) {
      gesture?.reset();
    }
  },
);

onBeforeUnmount(() => {
  gesture?.destroy();
  refreshing.value = false;
});

defineExpose({ reset });
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
    <div
      ref="indicator"
      class="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-center opacity-0 select-none"
      aria-hidden="true"
    >
      <div
        class="flex items-center gap-1.5 text-xs font-medium transition-colors duration-150"
        :class="highlighted ? 'text-primary' : 'text-base-content/70'"
      >
        <span v-if="active" class="loading loading-spinner loading-xs" />
        <span v-else ref="icon" class="inline-flex shrink-0 items-center justify-center">
          <RefreshCw class="size-3.5 shrink-0" :stroke-width="1.8" />
        </span>
        <span>{{ label }}</span>
      </div>
    </div>
    <div ref="scroller" class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <div ref="content" class="flex flex-1 flex-col" :class="contentClass">
        <slot />
      </div>
    </div>
    <span class="sr-only" role="status" aria-live="polite">{{ announcement }}</span>
  </div>
</template>
