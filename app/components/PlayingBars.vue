<script setup lang="ts">
import { Signal } from "@lucide/vue";

defineOptions({ name: "PlayingBars" });
</script>

<template>
  <Signal class="playing-bars" aria-hidden="true" />
</template>

<style scoped>
.playing-bars :deep(path:first-child) {
  display: none;
}

.playing-bars :deep(path:nth-child(2)) {
  scale: 1 3;
  animation: playing-bar 640ms ease-in-out -220ms infinite alternate;
}

.playing-bars :deep(path:nth-child(3)) {
  scale: 1 1.5;
  animation: playing-bar 730ms ease-in-out -510ms infinite alternate-reverse;
}

.playing-bars :deep(path:nth-child(4)) {
  animation: playing-bar 590ms ease-in-out -90ms infinite alternate;
}

.playing-bars :deep(path:nth-child(5)) {
  animation: playing-bar 680ms ease-in-out -390ms infinite alternate-reverse;
}

.playing-bars :deep(path) {
  transform-box: fill-box;
  transform-origin: center bottom;
  vector-effect: non-scaling-stroke;
}

@keyframes playing-bar {
  from {
    transform: scaleY(0.35);
  }
  to {
    transform: scaleY(1);
  }
}
</style>
