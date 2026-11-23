<script setup lang="ts">
defineOptions({ name: "PlaybackSlider" });
defineProps<{ fill: number }>();
const emit = defineEmits<{
  input: [value: number];
  change: [value: number];
}>();

function rangeValue(event: Event) {
  return event.target instanceof HTMLInputElement ? event.target.valueAsNumber : 0;
}
</script>

<template>
  <input
    class="range range-xs min-h-6 touch-none"
    type="range"
    min="0"
    @input="emit('input', rangeValue($event))"
    @change="emit('change', rangeValue($event))"
  />
</template>

<style scoped>
.range {
  --slider-value: v-bind(fill);
  --range-thumb-size: 0.75rem;
  --range-thumb: currentColor;
  --range-p: 0px;
  --range-bg: transparent;
  --range-fill: 0;
  --slider-stop: calc(
    var(--range-thumb-size) / 2 + (100% - var(--range-thumb-size)) * var(--slider-value)
  );
  background: linear-gradient(
      90deg,
      currentColor var(--slider-stop),
      color-mix(in oklab, currentColor 24%, transparent) 0
    )
    center / 100% 0.375rem no-repeat;
}

@media (forced-colors: active) {
  .range {
    appearance: auto;
    background: none;
  }
}
</style>
