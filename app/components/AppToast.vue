<script setup lang="ts">
import { useAppStore } from "~/stores/app";
import { useTemplateRef, watch } from "vue";
import { WifiOff } from "@lucide/vue";
import type { AppToastTone } from "~/types/toast";

defineOptions({ name: "AppToast" });

const app = useAppStore();
const container = useTemplateRef<HTMLDivElement>("container");

const toneClasses: Record<AppToastTone, string> = {
  info: "alert-info",
  success: "alert-success",
  warning: "alert-warning",
  error: "alert-error",
};

watch(
  () => app.toast?.id,
  (id) => {
    if (!import.meta.client) {
      return;
    }
    const element = container.value;
    if (!element || typeof element.showPopover !== "function") {
      return;
    }
    try {
      if (id) {
        if (element.matches(":popover-open")) {
          element.hidePopover();
        }
        element.showPopover();
      } else if (element.matches(":popover-open")) {
        element.hidePopover();
      }
    } catch {
      /* Popover API may be unavailable in non-standard environments. */
    }
  },
  { flush: "post" },
);
</script>

<template>
  <div
    v-if="app.toast"
    ref="container"
    popover="manual"
    class="toast toast-top toast-center pointer-events-none top-[calc(1rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] z-50 m-0 border-0 bg-transparent p-0 select-none"
  >
    <div
      :key="app.toast.id"
      class="alert gap-2 px-3.5 py-2.5 shadow-lg"
      :class="toneClasses[app.toast.tone]"
      :role="app.toast.tone === 'error' || app.toast.tone === 'warning' ? 'alert' : 'status'"
    >
      <WifiOff
        v-if="app.toast.offline"
        class="size-4 shrink-0"
        :stroke-width="1.8"
        aria-hidden="true"
      />
      <span>{{ app.toast.message }}</span>
    </div>
  </div>
</template>
