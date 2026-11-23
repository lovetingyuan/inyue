<script setup lang="ts">
import { computed, useId } from "vue";
import { Check } from "@lucide/vue";
import type { AppThemeColor } from "~/types/theme";
import { themeColorPresets } from "~/utils/theme-colors";

defineOptions({ name: "ThemeColorPicker" });

const model = defineModel<AppThemeColor>({ required: true });
const labelId = useId();
const groupName = useId();
const currentLabel = computed(
  () => themeColorPresets.find((preset) => preset.id === model.value)?.label ?? "",
);
</script>

<template>
  <div class="grid gap-1.5">
    <div class="flex items-center justify-between gap-2 text-sm">
      <span :id="labelId" class="font-medium">主题色</span>
      <span class="text-xs text-base-content/65" aria-hidden="true">{{ currentLabel }}</span>
    </div>
    <div
      role="radiogroup"
      :aria-labelledby="labelId"
      class="flex flex-wrap items-center justify-between gap-1.5 sm:justify-start sm:gap-2.5"
    >
      <label
        v-for="preset in themeColorPresets"
        :key="preset.id"
        :data-theme-color="preset.id"
        :title="preset.label"
        class="group relative grid size-9 cursor-pointer touch-manipulation place-items-center rounded-full select-none"
      >
        <input
          v-model="model"
          type="radio"
          :name="groupName"
          :value="preset.id"
          class="peer sr-only"
        />
        <span
          class="grid size-7 place-items-center rounded-full bg-primary text-primary-content transition-transform duration-150 [--focus-outline-offset:3px] group-hover:scale-105 group-active:scale-95 peer-checked:scale-105 peer-checked:ring-2 peer-checked:ring-primary peer-checked:ring-offset-2 peer-checked:ring-offset-base-100 peer-focus-visible:outline-2 peer-focus-visible:outline-primary"
        >
          <Check
            v-if="model === preset.id"
            class="size-4 shrink-0"
            :stroke-width="2.5"
            aria-hidden="true"
          />
        </span>
        <span class="sr-only">{{ preset.label }}</span>
      </label>
    </div>
  </div>
</template>
