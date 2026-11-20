import { computed, ref, shallowRef, watch } from "vue";
import { Capacitor } from "@capacitor/core";
import { useTimeoutFn } from "@vueuse/core";
import { defineStore } from "pinia";
import type { AppTheme } from "~/types/native-theme";
import type { AppToastMessage, AppToastTone } from "~/types/toast";

export const useAppStore = defineStore("app", () => {
  const drawerOpen = ref(false);
  const offline = ref(false);
  const theme = ref<AppTheme>("system");
  const native = computed(() => Capacitor.isNativePlatform());
  const toast = shallowRef<AppToastMessage>();
  let toastId = 0;

  const { start: scheduleClearToast, stop: cancelClearToast } = useTimeoutFn(
    () => {
      toast.value = undefined;
    },
    3500,
    { immediate: false },
  );

  function showToast(message: string, options: { tone?: AppToastTone; offline?: boolean } = {}) {
    const tone = options.tone ?? "info";
    const isOfflineToast = options.offline ?? false;
    if (
      toast.value &&
      toast.value.message === message &&
      toast.value.tone === tone &&
      toast.value.offline === isOfflineToast
    ) {
      scheduleClearToast();
      return;
    }
    toast.value = {
      id: ++toastId,
      message,
      tone,
      offline: isOfflineToast,
    };
    scheduleClearToast();
  }

  function notifyOffline() {
    showToast("网络已断开", { tone: "warning", offline: true });
  }

  function clearToast() {
    cancelClearToast();
    toast.value = undefined;
  }

  watch(offline, (isOffline) => {
    if (!isOffline && toast.value?.offline) {
      clearToast();
    }
  });

  return { drawerOpen, offline, native, theme, toast, showToast, notifyOffline, clearToast };
});
