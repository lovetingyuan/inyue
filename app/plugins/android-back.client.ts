import type { PluginListenerHandle } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { closeTopMusicDialog } from "~/utils/music-dialog";
import { useAppStore } from "~/stores/app";
import { defineNuxtPlugin, useNuxtApp, useRouter } from "#app";

export default defineNuxtPlugin({
  dependsOn: ["pinia"],
  setup() {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
      return;
    }
    const router = useRouter();
    const app = useAppStore(useNuxtApp().$pinia);
    let disposed = false;
    let listener: PluginListenerHandle | undefined;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("backButton", ({ canGoBack }) => {
          if (closeTopMusicDialog()) {
            return;
          }
          if (app.drawerOpen) {
            app.drawerOpen = false;
            return;
          }
          const route = router.currentRoute.value;
          if (canGoBack) {
            router.back();
          } else if (route.path !== "/" && route.path !== "/login") {
            void router.replace(route.meta.layout === "account" ? "/login" : "/");
          } else {
            void App.minimizeApp();
          }
        }),
      )
      .then((handle) => {
        if (disposed) {
          void handle.remove();
        } else {
          listener = handle;
        }
      })
      .catch(console.error);
    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        disposed = true;
        void listener?.remove();
      });
    }
  },
});
