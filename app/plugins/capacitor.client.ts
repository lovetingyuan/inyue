import { nextTick } from "vue";
import { defineNuxtPlugin } from "#app";
import { Capacitor } from "@capacitor/core";

const nonTextInputTypes = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function resolveTargetElement(target: EventTarget | null) {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

function isTextEditable(element: Element | null) {
  if (!element) {
    return false;
  }
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  if (element instanceof HTMLInputElement) {
    return !nonTextInputTypes.has(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function allowNativeContextMenu(target: EventTarget | null) {
  const element = resolveTargetElement(target);
  return isTextEditable(element) || Boolean(element?.closest(".select-text"));
}

export default defineNuxtPlugin((nuxtApp) => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  document.documentElement.dataset.native = "";

  const controller = new AbortController();
  const options: AddEventListenerOptions = { capture: true, signal: controller.signal };

  document.addEventListener(
    "dragstart",
    (event) => {
      event.preventDefault();
    },
    options,
  );

  document.addEventListener(
    "contextmenu",
    (event) => {
      if (!allowNativeContextMenu(event.target)) {
        event.preventDefault();
      }
    },
    options,
  );

  const preventNonEditableDrop = (event: DragEvent) => {
    if (!isTextEditable(resolveTargetElement(event.target))) {
      event.preventDefault();
    }
  };
  document.addEventListener("dragover", preventNonEditableDrop, options);
  document.addEventListener("drop", preventNonEditableDrop, options);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      controller.abort();
    });
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
