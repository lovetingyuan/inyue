<script setup lang="ts">
import { libraryError } from "~/utils/library-error";
import { useAppStore } from "~/stores/app";
import { useCoverQuery, useSongDetailsState } from "~/composables/useLibraryQueries";
import MusicArtwork from "~/components/MusicArtwork.vue";
import { computed, useTemplateRef } from "vue";
import { ListPlus, Pencil, Trash2, X } from "@lucide/vue";
import type { Song } from "~~/shared/types/library";

const props = defineProps<{ initialSong: Song; initialCoverUrl?: string }>();
const { data: details, error: queryError, asyncStatus } = useSongDetailsState();
const song = computed(() => details.value ?? props.initialSong);
const app = useAppStore();
const covers = useCoverQuery(() => (song.value.coverId ? [song.value.coverId] : []));
const coverUrl = computed(() => {
  const id = song.value.coverId;
  if (!id) return undefined;
  return covers.urls.value[id] ?? (id === props.initialSong.coverId ? props.initialCoverUrl : undefined);
});
const loading = computed(
  () => !details.value && (!queryError.value || asyncStatus.value === "loading"),
);
const error = computed(() => (queryError.value ? app.offline ? "歌曲详情尚未缓存。" : libraryError(queryError.value) : ""));
const albumAndYear = computed(() => {
  const { album, year } = song.value;
  return [album, year ? `${year}年` : ""].filter(Boolean).join(" · ");
});
const emit = defineEmits<{ close: []; edit: [Song]; delete: []; playlists: [] }>();
const playlistButton = useTemplateRef("playlistButton");
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <header
      class="relative shrink-0 bg-linear-to-br from-primary/15 via-base-200/80 to-base-100 px-4 py-5 sm:px-6"
    >
      <button
        type="button"
        class="btn btn-ghost btn-circle absolute top-2 right-2"
        aria-label="关闭歌曲详情"
        @click="emit('close')"
      >
        <X class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
      </button>
      <div class="flex items-center gap-3.5 pr-10 sm:gap-4">
        <MusicArtwork :src="coverUrl" class="w-18 shadow-md sm:w-22" />
        <div class="min-w-0">
          <h2
            class="line-clamp-2 wrap-anywhere text-xl leading-tight font-bold tracking-tight sm:text-2xl"
            :title="song.title"
          >
            {{ song.title }}
          </h2>
          <p class="mt-1 truncate text-sm font-medium" :title="song.artist">{{ song.artist }}</p>
          <p
            v-if="albumAndYear"
            class="mt-0.5 truncate text-xs text-base-content/70"
            :title="albumAndYear"
          >
            {{ albumAndYear }}
          </p>
        </div>
      </div>
    </header>
    <div
      v-if="song.lyricist || song.composer || song.description"
      class="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
    >
      <dl v-if="song.lyricist || song.composer" class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <div v-if="song.lyricist" class="flex min-w-0 items-baseline gap-2">
          <dt class="shrink-0 text-base-content/65">作词</dt>
          <dd class="wrap-anywhere font-medium">{{ song.lyricist }}</dd>
        </div>
        <div v-if="song.composer" class="flex min-w-0 items-baseline gap-2">
          <dt class="shrink-0 text-base-content/65">作曲</dt>
          <dd class="wrap-anywhere font-medium">{{ song.composer }}</dd>
        </div>
      </dl>
      <section v-if="song.description">
        <h3 class="mb-1 text-xs font-semibold text-base-content/65">简介</h3>
        <p class="text-sm/relaxed wrap-anywhere whitespace-pre-wrap text-base-content/85">
          {{ song.description }}
        </p>
      </section>
    </div>
    <p
      v-if="loading"
      class="flex shrink-0 items-center gap-2 px-4 py-4 text-sm text-base-content/70 sm:px-6"
      role="status"
    >
      <span class="loading loading-spinner loading-xs" aria-hidden="true" /> 加载中…
    </p>
    <p v-else-if="!details && error" class="shrink-0 px-4 py-4 text-sm text-error sm:px-6" role="alert">{{ error }}</p>
    <footer
      v-if="details && !app.offline"
      class="flex shrink-0 flex-wrap items-center gap-1 border-t border-base-300/70 px-4 pt-3 pb-[calc(0.75rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] sm:gap-2 sm:px-6"
    >
      <button
        type="button"
        class="btn btn-ghost text-error"
        aria-label="删除歌曲"
        @click="emit('delete')"
      >
        <Trash2 class="size-4" aria-hidden="true" /> 删除
      </button>
      <button type="button" class="btn btn-ghost ml-auto" @click="emit('edit', details)">
        <Pencil class="size-4" aria-hidden="true" /> 编辑
      </button>
      <button
        ref="playlistButton"
        type="button"
        class="btn btn-primary"
        aria-haspopup="dialog"
        @click="
          playlistButton?.focus();
          emit('playlists');
        "
      >
        <ListPlus class="size-5" aria-hidden="true" /> 加入歌单
      </button>
    </footer>
  </div>
</template>
