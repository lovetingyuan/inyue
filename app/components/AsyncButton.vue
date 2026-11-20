<script setup lang="ts">
import { ref } from "vue";

defineOptions({ name: "AsyncButton" });
const props = defineProps<{
  action: () => Promise<unknown>;
  disabled?: boolean;
  loading?: boolean;
}>();

const pending = ref(false);

async function run() {
  if (props.disabled || pending.value) {
    return;
  }
  pending.value = true;
  try {
    await props.action();
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <button type="button" :disabled="disabled || pending" :aria-busy="loading || pending" @click="run">
    <span
      v-if="loading || pending"
      class="loading loading-spinner loading-xs shrink-0"
      aria-hidden="true"
    />
    <slot v-else name="icon" />
    <slot />
  </button>
</template>
