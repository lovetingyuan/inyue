import type { PluginListenerHandle } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { closeTopMusicDialog } from "~/utils/music-dialog";
import { useAppStore } from "~/stores/app";
import { useLibraryStore } from "~/stores/library";
import { defineNuxtPlugin, useNuxtApp, useRouter } from "#app";

export default defineNuxtPlugin({
  dependsOn: ["pinia"],
  setup() {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
      return;
    }
    const router = useRouter();
    const pinia = useNuxtApp().$pinia;
    const app = useAppStore(pinia);
    const library = useLibraryStore(pinia);
    let disposed = false;
    let listener: PluginListenerHandle | undefined;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("backButton", ({ canGoBack }) => {
          const openPopover = document.querySelector<HTMLElement>(
            '[popover]:not([popover="manual"]):popover-open',
          );
          if (openPopover) {
            openPopover.hidePopover();
            return;
          }
          if (closeTopMusicDialog()) {
            return;
          }
          if (app.drawerOpen) {
            app.drawerOpen = false;
            return;
          }
          const route = router.currentRoute.value;
          if (route.path === "/" && (library.searchOpen || library.search || library.term)) {
            library.closeSearch();
            return;
          }
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
