import { computed, ref, shallowRef, watch } from "vue";
import { Capacitor } from "@capacitor/core";
import { useTimeoutFn } from "@vueuse/core";
import { defineStore } from "pinia";
import type { AppTheme } from "~/types/native-theme";
import type { AppThemeColor } from "~/types/theme";
import type { AppToastAction, AppToastMessage, AppToastTone } from "~/types/toast";
import { defaultThemeColor } from "~/utils/theme-colors";

export const useAppStore = defineStore("app", () => {
  const drawerOpen = ref(false);
  const offline = ref(false);
  const theme = ref<AppTheme>("system");
  const themeColor = ref<AppThemeColor>(defaultThemeColor);
  const native = computed(() => Capacitor.isNativePlatform());
  const toast = shallowRef<AppToastMessage>();
  const toastDuration = ref(3500);
  let toastId = 0;

  const { start: scheduleClearToast, stop: cancelClearToast } = useTimeoutFn(
    () => {
      toast.value = undefined;
    },
    toastDuration,
    { immediate: false },
  );

  function showToast(
    message: string,
    options: {
      tone?: AppToastTone;
      offline?: boolean;
      action?: AppToastAction;
      duration?: number;
    } = {},
  ) {
    const tone = options.tone ?? "info";
    const isOfflineToast = options.offline ?? false;
    toastDuration.value = options.duration ?? (options.action ? 5000 : 3500);
    if (
      !options.action &&
      toast.value &&
      !toast.value.action &&
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
      action: options.action,
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

  return {
    drawerOpen,
    offline,
    native,
    theme,
    themeColor,
    toast,
    showToast,
    notifyOffline,
    clearToast,
  };
});
