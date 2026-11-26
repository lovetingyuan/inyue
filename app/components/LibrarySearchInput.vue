<script setup lang="ts">
import { useTemplateRef } from "vue";
import { Search, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { useLibraryStore } from "~/stores/library";

defineOptions({ name: "LibrarySearchInput" });

const props = withDefaults(
  defineProps<{
    closable?: boolean;
  }>(),
  {
    closable: false,
  },
);

const emit = defineEmits<{
  close: [];
}>();

const library = useLibraryStore();
const { search, searching, composing } = storeToRefs(library);
const input = useTemplateRef<HTMLInputElement>("input");

function focus() {
  input.value?.focus({ preventScroll: true });
}

function handleSubmit() {
  composing.value = false;
  library.submitSearch();
  if (props.closable) {
    input.value?.blur();
  }
}

function handleCloseAction() {
  if (search.value) {
    library.clearSearch();
    focus();
    return;
  }
  emit("close");
}

function handleEscape(event: KeyboardEvent) {
  if (!props.closable) {
    return;
  }
  event.preventDefault();
  emit("close");
}

defineExpose({ focus });
</script>

<template>
  <form
    role="search"
    class="flex min-w-0 flex-1"
    :aria-busy="searching"
    @submit.prevent="handleSubmit"
    @keydown.esc="handleEscape"
  >
    <div
      class="input min-w-0 w-full rounded-full border-transparent bg-base-200"
      :class="closable ? 'pr-3' : undefined"
    >
      <span
        class="-ml-1 grid size-6 shrink-0 place-items-center text-base-content/70"
        aria-hidden="true"
      >
        <span v-if="searching" class="loading loading-spinner loading-xs" />
        <Search v-else class="size-4" :stroke-width="1.8" />
      </span>
      <input
        ref="input"
        v-model="search"
        type="search"
        enterkeyhint="search"
        class="min-w-0"
        :class="closable ? '[&::-webkit-search-cancel-button]:hidden' : undefined"
        aria-label="搜索歌曲"
        placeholder="搜索歌曲、歌手或专辑"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @change="composing = false"
      />
      <button
        v-if="closable"
        type="button"
        class="btn btn-ghost btn-circle btn-sm -mr-2 shrink-0 text-base-content/70"
        :aria-label="search ? '清空搜索' : '关闭搜索'"
        @mousedown.prevent
        @click="handleCloseAction"
      >
        <X class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
      </button>
    </div>
  </form>
</template>
