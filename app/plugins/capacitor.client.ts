import { nextTick } from "vue";
import { defineNuxtPlugin } from "#app";
import { Capacitor } from "@capacitor/core";

export default defineNuxtPlugin((nuxtApp) => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  nuxtApp.hook("app:mounted", async () => {
    await nextTick();
    await document
      .querySelector<HTMLImageElement>("#startup-logo")
      ?.decode()
      .catch(() => {});
    await import("@capacitor/splash-screen")
      .then(({ SplashScreen }) => SplashScreen.hide())
      .catch(console.error);
  });
});
