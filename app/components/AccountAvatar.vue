<script setup lang="ts">
import { computed, ref, watch } from "vue";

defineOptions({ name: "AccountAvatar" });
const { name, image } = defineProps<{ name: string; image?: string | null }>();

const failed = ref(false);
const initial = computed(() => [...name.trim()][0] ?? "?");
watch(
  () => image,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <div
    class="avatar shrink-0"
    :class="{ 'avatar-placeholder': !image || failed }"
    aria-hidden="true"
  >
    <div class="w-full rounded-full bg-primary/10 text-primary">
      <img
        v-if="image && !failed"
        :key="image"
        :src="image"
        class="object-cover"
        alt=""
        referrerpolicy="no-referrer"
        @error="failed = true"
      />
      <span v-else>{{ initial }}</span>
    </div>
  </div>
</template>
