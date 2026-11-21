interface DrawerGestureOptions {
  root: HTMLElement;
  side: HTMLElement;
  overlay: HTMLElement;
  aside: HTMLElement;
  isEnabled: () => boolean;
  canOpen: () => boolean;
  isOpen: () => boolean;
  onCommit: (open: boolean) => void | Promise<void>;
}

interface TouchSample {
  x: number;
  t: number;
}

type GesturePhase = "idle" | "pending" | "dragging" | "settling" | "ignored";

const LOCK_DISTANCE = 8;
const HORIZONTAL_RATIO = 1.2;
const FLING_VELOCITY = 0.3;
const VELOCITY_WINDOW_MS = 100;
const VELOCITY_STALE_MS = 80;
const OPEN_THRESHOLD = 0.35;
const CLOSE_THRESHOLD = 0.65;
const MIN_SETTLE_MS = 110;
const MAX_SETTLE_MS = 200;
const MIN_SETTLE_SPEED = 0.85;
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
  "[data-drawer-gesture-ignore]",
].join(",");

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

function shouldIgnoreTarget(target: Element | null) {
  if (!target || document.querySelector("dialog[open]")) {
    return true;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest(IGNORED_SELECTOR));
}

function hasHorizontalScrollableAncestor(
  start: Element | null,
  boundary: HTMLElement,
  dx: number,
) {
  let node = start;
  while (node && node !== boundary) {
    if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1) {
      const overflowX = window.getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") {
        if (dx > 0 && node.scrollLeft > 0) {
          return true;
        }
        if (dx < 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 1) {
          return true;
        }
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

export function attachDrawerGesture(options: DrawerGestureOptions) {
  const { root, side, overlay, aside } = options;

  let phase: GesturePhase = "idle";
  let touchId: number | null = null;
  let touchTarget: Element | null = null;
  let startX = 0;
  let startY = 0;
  let anchorX = 0;
  let anchorProgress = 0;
  let currentProgress = 0;
  let drawerWidth = 0;
  let initialOpen = false;
  let didDrag = false;
  let caughtFromSettle = false;
  let movedDuringCatch = false;
  let settleTarget: boolean | null = null;
  let interruptedTarget = false;
  let hasInlineStyles = false;
  let generation = 0;
  let samples: TouchSample[] = [];
  let settleTimer: number | null = null;
  let settleTransitionHandler: ((event: TransitionEvent) => void) | null = null;
  let suppressClickTimer: number | null = null;

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

  function clearSettleListeners() {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (settleTransitionHandler) {
      aside.removeEventListener("transitionend", settleTransitionHandler);
      settleTransitionHandler = null;
    }
  }

  function applyDragStyles(progress: number) {
    hasInlineStyles = true;
    side.style.visibility = "visible";
    side.style.opacity = "1";
    side.style.transition = "none";
    overlay.style.opacity = String(progress);
    overlay.style.transition = "none";
    aside.style.translate = `${(progress - 1) * 100}%`;
    aside.style.transition = "none";
    aside.style.willChange = "translate";
  }

  function clearStyles() {
    if (!hasInlineStyles) {
      return;
    }
    hasInlineStyles = false;
    side.style.transition = "none";
    overlay.style.transition = "none";
    aside.style.transition = "none";
    side.style.visibility = "";
    side.style.opacity = "";
    overlay.style.opacity = "";
    aside.style.translate = "";
    aside.style.willChange = "";
    void side.offsetHeight;
    side.style.transition = "";
    overlay.style.transition = "";
    aside.style.transition = "";
  }

  function recordSample(x: number, now: number) {
    samples.push({ x, t: now });
    const cutoff = now - VELOCITY_WINDOW_MS;
    while (samples.length > 2 && samples[0] && samples[0].t < cutoff) {
      samples.shift();
    }
  }

  function computeVelocity(now: number) {
    const latest = samples.at(-1);
    if (!latest || now - latest.t > VELOCITY_STALE_MS) {
      return 0;
    }
    const cutoff = now - VELOCITY_WINDOW_MS;
    const earliest = samples.find((sample) => sample.t >= cutoff) ?? samples[0];
    if (!earliest) {
      return 0;
    }
    const dt = latest.t - earliest.t;
    if (dt <= 0) {
      return 0;
    }
    return (latest.x - earliest.x) / dt;
  }

  function resetTouchState() {
    touchId = null;
    touchTarget = null;
    samples = [];
    didDrag = false;
    caughtFromSettle = false;
    movedDuringCatch = false;
  }

  async function finalizeSettle(open: boolean, token: number) {
    clearSettleListeners();
    phase = "idle";
    settleTarget = null;
    await options.onCommit(open);
    if (token !== generation) {
      return;
    }
    clearStyles();
  }

  function settle(open: boolean, velocity: number) {
    clearSettleListeners();
    resetTouchState();

    const target = open ? 1 : 0;
    const token = ++generation;
    const remaining = Math.abs(target - currentProgress);

    if (remaining < 0.005) {
      void finalizeSettle(open, token);
      return;
    }

    phase = "settling";
    settleTarget = open;

    const width = drawerWidth || aside.offsetWidth || 288;
    const speed = Math.max(Math.abs(velocity), MIN_SETTLE_SPEED);
    const duration = Math.round(
      clamp((remaining * width) / speed, MIN_SETTLE_MS, MAX_SETTLE_MS),
    );

    void aside.offsetWidth;
    overlay.style.transition = `opacity ${duration}ms ${SETTLE_EASING}`;
    overlay.style.opacity = String(target);
    aside.style.transition = `translate ${duration}ms ${SETTLE_EASING}`;
    aside.style.translate = `${(target - 1) * 100}%`;

    const finish = () => {
      if (token !== generation) {
        return;
      }
      void finalizeSettle(open, token);
    };

    settleTransitionHandler = (event: TransitionEvent) => {
      if (event.target === aside && event.propertyName === "translate") {
        finish();
      }
    };
    aside.addEventListener("transitionend", settleTransitionHandler);
    settleTimer = window.setTimeout(finish, duration + 60);
  }

  function onTouchStart(event: TouchEvent) {
    clearClickSuppression();

    if (!options.isEnabled()) {
      return;
    }

    if (event.touches.length !== 1) {
      if (phase === "dragging") {
        settle(caughtFromSettle ? interruptedTarget : initialOpen, 0);
      } else if (phase === "pending") {
        resetTouchState();
        phase = "idle";
      }
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

    if (phase === "settling") {
      const width = aside.offsetWidth || aside.getBoundingClientRect().width;
      if (width <= 0) {
        return;
      }
      const previousTarget = settleTarget ?? options.isOpen();
      clearSettleListeners();
      generation += 1;

      const liveProgress = clamp(aside.getBoundingClientRect().right / width, 0, 1);
      const now = performance.now();
      phase = "dragging";
      touchId = touch.identifier;
      touchTarget = target;
      drawerWidth = width;
      startX = touch.clientX;
      startY = touch.clientY;
      anchorX = touch.clientX;
      anchorProgress = liveProgress;
      currentProgress = liveProgress;
      initialOpen = previousTarget;
      interruptedTarget = previousTarget;
      settleTarget = null;
      caughtFromSettle = true;
      movedDuringCatch = false;
      didDrag = false;
      samples = [{ x: touch.clientX, t: now }];
      applyDragStyles(liveProgress);
      return;
    }

    if (phase !== "idle") {
      return;
    }

    const open = options.isOpen();
    if (!open && !options.canOpen()) {
      return;
    }

    phase = "pending";
    touchId = touch.identifier;
    touchTarget = target;
    startX = touch.clientX;
    startY = touch.clientY;
    initialOpen = open;
    didDrag = false;
    caughtFromSettle = false;
    movedDuringCatch = false;
    samples = [];
  }

  function onTouchMove(event: TouchEvent) {
    if (touchId === null) {
      return;
    }

    if (event.touches.length !== 1) {
      if (phase === "dragging") {
        settle(caughtFromSettle ? interruptedTarget : initialOpen, 0);
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
        Math.abs(dx) <= Math.abs(dy) * HORIZONTAL_RATIO ||
        (!initialOpen && dx <= 0) ||
        (initialOpen && dx >= 0) ||
        !event.cancelable ||
        hasHorizontalScrollableAncestor(touchTarget, root, dx)
      ) {
        phase = "ignored";
        return;
      }

      const width = aside.offsetWidth || aside.getBoundingClientRect().width;
      if (width <= 0) {
        phase = "ignored";
        return;
      }

      const now = performance.now();
      phase = "dragging";
      drawerWidth = width;
      anchorX = touch.clientX;
      anchorProgress = initialOpen ? 1 : 0;
      currentProgress = anchorProgress;
      didDrag = true;
      samples = [{ x: touch.clientX, t: now }];
      event.preventDefault();
      applyDragStyles(currentProgress);
      return;
    }

    if (phase !== "dragging") {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    if (caughtFromSettle && Math.abs(touch.clientX - anchorX) >= 3) {
      movedDuringCatch = true;
      didDrag = true;
    }

    const now = performance.now();
    currentProgress = clamp(anchorProgress + (touch.clientX - anchorX) / drawerWidth, 0, 1);
    recordSample(touch.clientX, now);
    applyDragStyles(currentProgress);
  }

  function onTouchEnd(event: TouchEvent) {
    if (touchId === null || !findTouch(event.changedTouches, touchId)) {
      return;
    }

    if (phase !== "dragging") {
      resetTouchState();
      phase = "idle";
      return;
    }

    if (didDrag) {
      armClickSuppression();
    }

    if (caughtFromSettle && !movedDuringCatch) {
      settle(interruptedTarget, 0);
      return;
    }

    const now = performance.now();
    const vx = computeVelocity(now);
    let shouldOpen: boolean;
    if (vx >= FLING_VELOCITY) {
      shouldOpen = true;
    } else if (vx <= -FLING_VELOCITY) {
      shouldOpen = false;
    } else {
      shouldOpen = currentProgress >= (initialOpen ? CLOSE_THRESHOLD : OPEN_THRESHOLD);
    }

    settle(shouldOpen, vx);
  }

  function onTouchCancel(event: TouchEvent) {
    if (touchId === null || !findTouch(event.changedTouches, touchId)) {
      return;
    }

    if (phase === "dragging") {
      settle(caughtFromSettle ? interruptedTarget : initialOpen, 0);
      return;
    }

    resetTouchState();
    phase = "idle";
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
    clearClickSuppression();
    resetTouchState();
    phase = "idle";
    settleTarget = null;
    clearStyles();
  }

  function destroy() {
    reset();
    root.removeEventListener("touchstart", onTouchStart);
    root.removeEventListener("touchmove", onTouchMove);
    root.removeEventListener("touchend", onTouchEnd);
    root.removeEventListener("touchcancel", onTouchCancel);
    root.removeEventListener("click", onClickCapture, true);
  }

  root.addEventListener("touchstart", onTouchStart, { passive: true });
  root.addEventListener("touchmove", onTouchMove, { passive: false });
  root.addEventListener("touchend", onTouchEnd, { passive: true });
  root.addEventListener("touchcancel", onTouchCancel, { passive: true });
  root.addEventListener("click", onClickCapture, true);

  return { reset, destroy };
}
