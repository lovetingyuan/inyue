import { closeTopMusicDialog } from "~/utils/music-dialog";
import { useAppStore } from "~/stores/app";
import { defineNuxtPlugin, useNuxtApp, useRouter } from "#app";
import { Capacitor } from "@capacitor/core";

export default defineNuxtPlugin({
  dependsOn: ["pinia"],
  async setup() {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
    const router = useRouter();
    const app = useAppStore(useNuxtApp().$pinia);
    const { App } = await import("@capacitor/app");
    const listener = await App.addListener("backButton", ({ canGoBack }) => {
      if (closeTopMusicDialog()) return;
      if (app.drawerOpen) {
        app.drawerOpen = false;
        return;
      }
      const route = router.currentRoute.value;
      if (canGoBack) router.back();
      else if (route.path !== "/" && route.path !== "/login")
        void router.replace(route.meta.layout === "account" ? "/login" : "/");
      else void App.minimizeApp();
    });
    if (import.meta.hot)
      import.meta.hot.dispose(() => {
        void listener.remove();
      });
  },
});
