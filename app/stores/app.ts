import { computed, ref } from "vue";
import { Capacitor } from "@capacitor/core";
import { defineStore } from "pinia";

export const useAppStore = defineStore("app", () => {
  const drawerOpen = ref(false);
  const offline = ref(false);
  const theme = ref<"system" | "light" | "dark">("system");
  const native = computed(() => Capacitor.isNativePlatform());

  return { drawerOpen, offline, native, theme };
});
