import type { PullToRefreshPhase } from "~/types/pull-to-refresh";

interface PullToRefreshOptions {
  scroller: HTMLElement;
  content: HTMLElement;
  indicator: HTMLElement;
  getIcon?: () => HTMLElement | null;
  isEnabled: () => boolean;
  onRefresh: () => void | Promise<void>;
  onPhaseChange?: (phase: PullToRefreshPhase) => void;
}

type InternalPhase = PullToRefreshPhase | "pending" | "settling" | "ignored";

const LOCK_DISTANCE = 6;
const VERTICAL_RATIO = 1.2;
const TRIGGER_OFFSET = 52;
const MAX_OFFSET = 88;
const REFRESH_OFFSET = 44;
const DAMPING_DISTANCE = 120;
const REFRESH_SNAP_MS = 180;
const RESET_SETTLE_MS = 200;
const MIN_REFRESH_MS = 320;
const SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const CLICK_SUPPRESS_MS = 80;

const IGNORED_SELECTOR = [
  "input",
  "textarea",
  "select",
  "dialog",
  '[role="slider"]',
  "[data-playback-seek]",
  "[data-playback-volume]",
  "[data-pull-refresh-ignore]",
].join(",");

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function applyResistance(rawPull: number) {
  if (rawPull <= 0) {
    return 0;
  }
  return MAX_OFFSET * (1 - Math.exp(-rawPull / DAMPING_DISTANCE));
}

function resolveElement(target: EventTarget | null) {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

function hasOpenPopover() {
  try {
    return Boolean(document.querySelector('[popover]:not([popover="manual"]):popover-open'));
  } catch {
    return false;
  }
}

function shouldIgnoreTarget(target: Element | null) {
  if (!target || document.querySelector("dialog[open]") || hasOpenPopover()) {
    return true;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest(IGNORED_SELECTOR));
}

function hasVerticalScrollableAncestor(start: Element | null, boundary: HTMLElement) {
  let node = start;
  while (node && node !== boundary) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 1) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && node.scrollTop > 0) {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

function findTouch(touches: TouchList, id: number) {
  for (let i = 0; i < touches.length; i += 1) {
    const touch = touches.item(i);
    if (touch && touch.identifier === id) {
      return touch;
    }
  }
  return null;
}

export function attachPullToRefresh(options: PullToRefreshOptions) {
  const { scroller, content, indicator } = options;

  let phase: InternalPhase = "idle";
  let emittedPhase: PullToRefreshPhase = "idle";
  let touchId: number | null = null;
  let touchTarget: Element | null = null;
  let startX = 0;
  let startY = 0;
  let anchorY = 0;
  let currentOffset = 0;
  let didPull = false;
  let hasInlineStyles = false;
  let generation = 0;
  let settleTimer: number | null = null;
  let settleTransitionHandler: ((event: TransitionEvent) => void) | null = null;
  let minRefreshTimer: number | null = null;
  let suppressClickTimer: number | null = null;

  function emitPhase(next: PullToRefreshPhase) {
    if (emittedPhase === next) {
      return;
    }
    emittedPhase = next;
    options.onPhaseChange?.(next);
  }

  function indicatorHeight() {
    return indicator.offsetHeight || REFRESH_OFFSET;
  }

  function clearClickSuppression() {
    if (suppressClickTimer !== null) {
      window.clearTimeout(suppressClickTimer);
      suppressClickTimer = null;
    }
  }

  function armClickSuppression() {
    clearClickSuppression();
    suppressClickTimer = window.setTimeout(() => {
      suppressClickTimer = null;
    }, CLICK_SUPPRESS_MS);
  }

  function clearMinRefreshTimer() {
    if (minRefreshTimer !== null) {
      window.clearTimeout(minRefreshTimer);
      minRefreshTimer = null;
    }
  }

  function clearSettleListeners() {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (settleTransitionHandler) {
      content.removeEventListener("transitionend", settleTransitionHandler);
      settleTransitionHandler = null;
    }
  }

  function resetTouchState() {
    touchId = null;
    touchTarget = null;
    didPull = false;
  }

  function applyPullStyles(offset: number) {
    hasInlineStyles = true;
    const height = indicatorHeight();
    const progress = clamp(offset / TRIGGER_OFFSET, 0, 1);
    const opacity = clamp(offset / (REFRESH_OFFSET * 0.85), 0, 1);

    content.style.transition = "none";
    content.style.translate = `0 ${offset}px`;
    content.style.willChange = "translate";

    indicator.style.transition = "none";
    indicator.style.translate = `0 ${(offset - height) / 2}px`;
    indicator.style.opacity = String(opacity);
    indicator.style.willChange = "translate, opacity";

    const icon = options.getIcon?.();
    if (icon) {
      icon.style.rotate = `${Math.round(progress * 270)}deg`;
    }
  }

  function clearStyles() {
    if (!hasInlineStyles) {
      return;
    }
    hasInlineStyles = false;
    content.style.transition = "none";
    indicator.style.transition = "none";
    content.style.translate = "";
    content.style.willChange = "";
    indicator.style.translate = "";
    indicator.style.opacity = "";
    indicator.style.willChange = "";
    const icon = options.getIcon?.();
    if (icon) {
      icon.style.rotate = "";
    }
    void content.offsetHeight;
    content.style.transition = "";
    indicator.style.transition = "";
  }

  function animateTo(targetOffset: number, duration: number, token: number, onFinish?: () => void) {
    clearSettleListeners();
    const height = indicatorHeight();

    if (Math.abs(currentOffset - targetOffset) < 0.5) {
      currentOffset = targetOffset;
      onFinish?.();
      return;
    }

    hasInlineStyles = true;
    void content.offsetHeight;

    content.style.transition = `translate ${duration}ms ${SETTLE_EASING}`;
    content.style.translate = `0 ${targetOffset}px`;
    content.style.willChange = "translate";

    if (targetOffset === 0) {
      indicator.style.transition = `translate ${duration}ms ${SETTLE_EASING}, opacity ${Math.round(duration * 0.8)}ms ease-out`;
      indicator.style.translate = `0 ${-height / 2}px`;
      indicator.style.opacity = "0";
    } else {
      indicator.style.transition = `translate ${duration}ms ${SETTLE_EASING}, opacity ${duration}ms ease-out`;
      indicator.style.translate = `0 ${(targetOffset - height) / 2}px`;
      indicator.style.opacity = "1";
    }
    indicator.style.willChange = "translate, opacity";

    currentOffset = targetOffset;

    let completed = false;
    const finish = () => {
      if (completed || token !== generation) {
        return;
      }
      completed = true;
      clearSettleListeners();
      onFinish?.();
    };

    settleTransitionHandler = (event: TransitionEvent) => {
      if (event.target === content && event.propertyName === "translate") {
        finish();
      }
    };
    content.addEventListener("transitionend", settleTransitionHandler);
    settleTimer = window.setTimeout(finish, duration + 60);
  }

  function settleToIdle(nextPhase: "settling" | "completing") {
    resetTouchState();
    const token = ++generation;
    phase = nextPhase;
    if (nextPhase === "completing") {
      emitPhase("completing");
    }

    animateTo(0, RESET_SETTLE_MS, token, () => {
      phase = "idle";
      currentOffset = 0;
      clearStyles();
      emitPhase("idle");
    });
  }

  async function startRefresh() {
    resetTouchState();
    const token = ++generation;
    const startedAt = performance.now();
    phase = "refreshing";
    emitPhase("refreshing");

    animateTo(REFRESH_OFFSET, REFRESH_SNAP_MS, token);

    try {
      await options.onRefresh();
    } catch {
      /* Query error states are surfaced by the caller. */
    }

    if (token !== generation) {
      return;
    }

    const remaining = MIN_REFRESH_MS - (performance.now() - startedAt);
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        minRefreshTimer = window.setTimeout(() => {
          minRefreshTimer = null;
          resolve();
        }, remaining);
      });
    }

    if (token !== generation) {
      return;
    }

    settleToIdle("completing");
  }

  function onTouchStart(event: TouchEvent) {
    clearClickSuppression();

    if (!options.isEnabled()) {
      return;
    }

    if (event.touches.length !== 1) {
      if (phase === "pulling" || phase === "ready") {
        settleToIdle("settling");
      } else if (phase === "pending") {
        resetTouchState();
        phase = "idle";
      }
      return;
    }

    if (phase !== "idle") {
      return;
    }

    if (scroller.scrollTop > 1) {
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) {
      return;
    }

    const target = resolveElement(event.target);
    if (shouldIgnoreTarget(target)) {
      return;
    }

    phase = "pending";
    touchId = touch.identifier;
    touchTarget = target;
    startX = touch.clientX;
    startY = touch.clientY;
    didPull = false;
  }

  function onTouchMove(event: TouchEvent) {
    if (touchId === null) {
      return;
    }

    if (event.touches.length !== 1) {
      if (phase === "pulling" || phase === "ready") {
        settleToIdle("settling");
      } else {
        resetTouchState();
        phase = "idle";
      }
      return;
    }

    const touch = findTouch(event.touches, touchId);
    if (!touch) {
      return;
    }

    if (phase === "pending") {
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) {
        return;
      }

      if (
        dy <= 0 ||
        dy <= Math.abs(dx) * VERTICAL_RATIO ||
        scroller.scrollTop > 1 ||
        !event.cancelable ||
        hasVerticalScrollableAncestor(touchTarget, scroller)
      ) {
        phase = "ignored";
        return;
      }

      phase = "pulling";
      anchorY = touch.clientY;
      currentOffset = 0;
      didPull = true;
      event.preventDefault();
      emitPhase("pulling");
      applyPullStyles(0);
      return;
    }

    if (phase !== "pulling" && phase !== "ready") {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    const rawPull = Math.max(0, touch.clientY - anchorY);
    currentOffset = applyResistance(rawPull);
    if (currentOffset >= 2) {
      didPull = true;
    }

    const nextPhase: PullToRefreshPhase = currentOffset >= TRIGGER_OFFSET ? "ready" : "pulling";
    phase = nextPhase;
    emitPhase(nextPhase);
    applyPullStyles(currentOffset);
  }

  function onTouchEnd(event: TouchEvent) {
    if (touchId === null || !findTouch(event.changedTouches, touchId)) {
      return;
    }

    if (phase !== "pulling" && phase !== "ready") {
      resetTouchState();
      if (phase === "pending" || phase === "ignored") {
        phase = "idle";
      }
      return;
    }

    if (didPull) {
      armClickSuppression();
    }

    if (phase === "ready" && currentOffset >= TRIGGER_OFFSET) {
      void startRefresh();
      return;
    }

    settleToIdle("settling");
  }

  function onTouchCancel(event: TouchEvent) {
    if (touchId === null || !findTouch(event.changedTouches, touchId)) {
      return;
    }

    if (phase === "pulling" || phase === "ready") {
      settleToIdle("settling");
      return;
    }

    resetTouchState();
    if (phase === "pending" || phase === "ignored") {
      phase = "idle";
    }
  }

  function onClickCapture(event: MouseEvent) {
    if (suppressClickTimer === null) {
      return;
    }
    clearClickSuppression();
    event.preventDefault();
    event.stopPropagation();
  }

  function reset() {
    generation += 1;
    clearSettleListeners();
    clearMinRefreshTimer();
    clearClickSuppression();
    resetTouchState();
    phase = "idle";
    currentOffset = 0;
    clearStyles();
    emitPhase("idle");
  }

  function destroy() {
    reset();
    scroller.removeEventListener("touchstart", onTouchStart);
    scroller.removeEventListener("touchmove", onTouchMove);
    scroller.removeEventListener("touchend", onTouchEnd);
    scroller.removeEventListener("touchcancel", onTouchCancel);
    scroller.removeEventListener("click", onClickCapture, true);
  }

  scroller.addEventListener("touchstart", onTouchStart, { passive: true });
  scroller.addEventListener("touchmove", onTouchMove, { passive: false });
  scroller.addEventListener("touchend", onTouchEnd, { passive: true });
  scroller.addEventListener("touchcancel", onTouchCancel, { passive: true });
  scroller.addEventListener("click", onClickCapture, true);

  return { reset, destroy };
}
