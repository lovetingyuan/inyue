import { computed, ref, watch } from "vue";
import { useTimeoutFn } from "@vueuse/core";
import { defineStore } from "pinia";

export const useLibraryStore = defineStore("library", () => {
  const playlist = ref("");
  const search = ref("");
  const term = ref("");
  const searchOpen = ref(false);
  const searching = ref(false);
  const composing = ref(false);
  const songId = ref<string>();
  const filters = computed(() => ({ playlist: term.value ? "" : playlist.value, q: term.value }));

  const { start: scheduleSearch, stop: cancelSearch } = useTimeoutFn(submitSearch, 300, {
    immediate: false,
  });

  watch([() => search.value.trim(), composing], ([keyword, isComposing]) => {
    cancelSearch();
    if (isComposing || keyword === term.value) {
      return;
    }
    if (keyword) {
      scheduleSearch();
    } else {
      submitSearch();
    }
  });

  function selectPlaylist(id: string) {
    cancelSearch();
    playlist.value = id;
    search.value = "";
    term.value = "";
    searchOpen.value = false;
    composing.value = false;
  }

  function submitSearch() {
    cancelSearch();
    term.value = search.value.trim();
  }

  function clearSearch() {
    cancelSearch();
    search.value = "";
    term.value = "";
    composing.value = false;
  }

  function closeSearch() {
    clearSearch();
    searchOpen.value = false;
  }

  function reset() {
    selectPlaylist("");
    songId.value = undefined;
  }

  return {
    playlist,
    search,
    term,
    searchOpen,
    searching,
    composing,
    songId,
    filters,
    selectPlaylist,
    submitSearch,
    clearSearch,
    closeSearch,
    reset,
  };
});
