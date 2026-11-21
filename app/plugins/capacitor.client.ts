import { nextTick } from "vue";
import { defineNuxtPlugin } from "#app";
import { Capacitor } from "@capacitor/core";

export default defineNuxtPlugin((nuxtApp) => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  nuxtApp.hook("app:mounted", async () => {
    const splashPromise = import("@capacitor/splash-screen");
    await nextTick();
    await document
      .querySelector<HTMLImageElement>("#startup-logo")
      ?.decode()
      .catch(() => {});
    await splashPromise.then(({ SplashScreen }) => SplashScreen.hide()).catch(console.error);
  });
});
