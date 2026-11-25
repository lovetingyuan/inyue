import type { CSSProperties } from "vue";
import type {
  NowPlayingTransitionSlot,
  NowPlayingTransitionState,
  NowPlayingTransitionTarget,
} from "~/types/now-playing-transition";

const transitionNames: Record<NowPlayingTransitionSlot, string> = {
  panel: "now-playing-panel",
  cover: "now-playing-cover",
  title: "now-playing-title",
  progress: "now-playing-progress",
  elapsed: "now-playing-elapsed",
  duration: "now-playing-duration",
  prev: "now-playing-prev",
  play: "now-playing-play",
  next: "now-playing-next",
};

export function getNowPlayingTransitionStyle(
  state: NowPlayingTransitionState,
  owner: Exclude<NowPlayingTransitionTarget, "none">,
  slot: NowPlayingTransitionSlot,
): CSSProperties | undefined {
  if (state.target !== owner || (slot === "cover" && !state.includeCover)) {
    return undefined;
  }
  return { viewTransitionName: transitionNames[slot] };
}

export function canStartNowPlayingTransition() {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export async function waitForArtworkDecode(container: HTMLElement | null, timeoutMs = 100) {
  const image = container?.querySelector<HTMLImageElement>("[data-now-playing-cover] img");
  if (!image) {
    return;
  }
  await Promise.race([
    image.decode().catch(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
  ]);
}
