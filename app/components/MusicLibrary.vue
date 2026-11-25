<script setup lang="ts">
import AsyncButton from "~/components/AsyncButton.vue";
import { formatMusicTime } from "~/utils/format-music-time";
import { libraryError } from "~/utils/library-error";
import { usePlayerStore } from "~/stores/player";
import { useLibraryStore } from "~/stores/library";
import { useAppStore } from "~/stores/app";
import {
  useCoverQuery,
  useLibraryQueries,
  useOfflineAudio,
  usePlaylistState,
} from "~/composables/useLibraryQueries";
import PlayingBars from "~/components/PlayingBars.vue";
import MusicArtwork from "~/components/MusicArtwork.vue";
import LibraryPlayer from "~/components/LibraryPlayer.vue";
import { computed, ref, useTemplateRef, watch } from "vue";
import { useAsyncState, useTimeoutFn } from "@vueuse/core";
import { useRouter } from "#app";
import { CircleAlert, Clock, FileCheck, Music, Play, Search } from "@lucide/vue";
import { storeToRefs } from "pinia";
import type { Song } from "~~/shared/types/library";
import { useSongDownload } from "~/composables/useSongDownload";
import SongActionMenu from "~/components/SongActionMenu.vue";
import SongManagementDialog from "~/components/SongManagementDialog.vue";

const library = useLibraryStore();
const app = useAppStore();
const { playlist, search, term } = storeToRefs(library);
const { current, playing, loading: playbackLoading } = storeToRefs(usePlayerStore());
const router = useRouter();
const showLibrary = computed(() => router.currentRoute.value.path === "/");
const { songs: songQuery, play: playFromLibrary } = useLibraryQueries();
const { playlists, error: playlistError, retry: retryPlaylists } = usePlaylistState();
const songs = computed(() => songQuery.data.value?.pages.flatMap(({ items }) => items) ?? []);
const offlineAudio = useOfflineAudio();
const firstPlayable = computed(() =>
  songs.value.find((song) => !app.offline || offlineAudio.value?.has(song.id)),
);
const searchTotal = computed(() => songQuery.data.value?.pages[0]?.total);
const { hasNextPage, loadNextPage, isLoading: loading } = songQuery;
const playlistCovers = useCoverQuery(() =>
  playlists.value.flatMap(({ coverId }) => (coverId ? [coverId] : [])),
);
const songCovers = useCoverQuery(() =>
  songs.value.flatMap(({ coverId }) => (coverId ? [coverId] : [])),
);
const coverUrls = computed(() => ({ ...playlistCovers.urls.value, ...songCovers.urls.value }));
const error = computed(() => {
  const cause =
    songQuery.error.value ??
    playlistError.value ??
    songCovers.error.value ??
    playlistCovers.error.value;
  return cause ? libraryError(cause) : "";
});
const songManagement = useTemplateRef("songManagement");
const { download: downloadSong, isDownloading } = useSongDownload();
const title = computed(() =>
  term.value
    ? "搜索结果"
    : playlist.value === "default"
      ? "默认歌单"
      : (playlists.value.find((item) => item.id === playlist.value)?.name ?? "所有歌曲"),
);
const playlistCoverUrl = computed(() => {
  const id = playlists.value.find((item) => item.id === playlist.value)?.coverId;
  return id && !term.value ? coverUrls.value[id] : undefined;
});

const { isLoading: retrying, executeImmediate: retryLibrary } = useAsyncState(
  async () => {
    await Promise.all([songQuery.refetch(), retryPlaylists()]);
    await Promise.all([
      songCovers.error.value && songCovers.refetch(),
      playlistCovers.error.value && playlistCovers.refetch(),
    ]);
  },
  undefined,
  { immediate: false },
);
const isComposing = ref(false);
const searching = computed(() => Boolean(term.value) && loading.value);
const { start: scheduleSearch, stop: cancelSearch } = useTimeoutFn(library.submitSearch, 300, {
  immediate: false,
});

watch([() => search.value.trim(), isComposing], ([keyword, composing]) => {
  cancelSearch();
  if (composing || keyword === term.value) {
    return;
  }
  if (keyword) {
    scheduleSearch();
  } else {
    library.submitSearch();
  }
});

function play(song: Song) {
  return playFromLibrary(song, song.coverId ? (coverUrls.value[song.coverId] ?? null) : null);
}

async function playFirst() {
  const song = firstPlayable.value;
  if (song) {
    await play(song);
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <section
      v-show="showLibrary"
      class="flex min-h-0 min-w-0 flex-1 flex-col bg-base-100"
      aria-label="歌曲列表"
    >
      <div class="flex items-center gap-2 px-4 pb-3 pt-2 sm:gap-3 sm:px-6 md:pt-4">
        <form role="search" class="flex min-w-0 flex-1" :aria-busy="searching" @submit.prevent>
          <div class="input min-w-0 w-full rounded-full border-transparent bg-base-200">
            <span
              class="-ml-1 grid size-6 shrink-0 place-items-center text-base-content/70"
              aria-hidden="true"
            >
              <span v-if="searching" class="loading loading-spinner loading-xs" />
              <Search v-else class="size-4" :stroke-width="1.8" />
            </span>
            <input
              v-model="search"
              type="search"
              class="min-w-0"
              aria-label="搜索歌曲"
              placeholder="搜索歌曲、歌手或专辑"
              @compositionstart="isComposing = true"
              @compositionend="isComposing = false"
              @change="isComposing = false"
            />
          </div>
        </form>
      </div>
      <div
        class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6"
      >
        <div
          class="flex shrink-0 items-center gap-3 rounded-box bg-linear-to-br from-primary/17 to-base-200/55 p-2 sm:gap-4 sm:p-3"
        >
          <MusicArtwork :src="playlistCoverUrl" class="w-12 shadow-md sm:w-14 rounded-xl" />
          <div class="min-w-0 flex-1">
            <h2
              class="line-clamp-2 wrap-anywhere text-lg leading-tight font-bold tracking-tight sm:text-xl"
              :title="title"
            >
              {{ title }}
            </h2>
            <p v-if="term" class="mt-1 flex items-baseline gap-2 text-sm text-base-content/70">
              <span class="truncate">“{{ term }}”</span>
              <span v-if="searchTotal !== undefined" class="shrink-0"
                >共 {{ searchTotal }} 首歌曲</span
              >
            </p>
            <p v-else-if="songs.length" class="mt-1 text-sm text-base-content/70">
              {{ songs.length }}{{ hasNextPage ? "+" : "" }} 首歌曲
            </p>
          </div>
          <AsyncButton
            v-if="firstPlayable"
            type="button"
            class="btn btn-primary btn-circle shrink-0 sm:btn-lg"
            aria-label="播放歌单"
            :action="playFirst"
          >
            <template #icon>
              <Play
                class="size-4 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
                fill="currentColor"
              />
            </template>
          </AsyncButton>
        </div>
        <div v-if="loading && !songs.length && !retrying" role="status" class="mt-4 lg:pt-6">
          <span class="sr-only">加载歌曲…</span>
          <div aria-hidden="true">
            <div v-for="row in 6" :key="row" class="flex items-center gap-3 py-2 pr-4 pl-2 lg:pl-3">
              <span class="skeleton hidden h-3 w-6 shrink-0 sm:block" />
              <span class="skeleton size-10 shrink-0 rounded-[18%]" />
              <div class="min-w-0 flex-1 space-y-2">
                <span class="skeleton block h-3 w-3/4 max-w-40" />
                <span class="skeleton block h-2.5 w-1/2 max-w-24" />
              </div>
              <div class="hidden w-1/4 lg:block">
                <span class="skeleton block h-3 w-2/3 max-w-28" />
              </div>
              <span class="skeleton mr-2 hidden h-3 w-8 shrink-0 sm:block" />
              <span class="skeleton size-4 shrink-0 rounded-full" />
            </div>
          </div>
        </div>
        <div
          v-else-if="error || retrying"
          class="alert alert-error alert-soft mt-4 gap-2.5 border-error/25 bg-error/15"
          role="alert"
        >
          <CircleAlert class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          <span class="min-w-0">{{ error }}</span>
          <button
            type="button"
            class="btn btn-sm shrink-0"
            :disabled="retrying"
            :aria-busy="retrying"
            @click="retryLibrary()"
          >
            <span v-if="retrying" class="loading loading-spinner loading-xs" aria-hidden="true" />
            重试
          </button>
        </div>
        <div
          v-else-if="!songs.length"
          class="grid justify-items-center gap-3 py-12 text-center text-sm text-base-content/70"
        >
          <component
            :is="term ? Search : Music"
            class="size-8 text-primary shrink-0"
            :stroke-width="1.8"
            aria-hidden="true"
          />
          <p v-if="app.offline">没有符合条件的已缓存歌曲</p>
          <p v-else-if="term">没有匹配的歌曲</p>
          <p v-else>{{ playlist ? "这个歌单还没有歌曲" : "暂无歌曲" }}</p>
          <!-- <NuxtLink v-if="!term" to="/songs/new" class="btn btn-ghost btn-sm text-primary"
            >新增歌曲</NuxtLink
          > -->
        </div>
        <div v-if="songs.length" class="mt-4">
          <div
            aria-hidden="true"
            class="hidden items-center gap-3 border-b border-base-300/70 px-3 pb-2 text-xs font-medium text-base-content/65 lg:flex"
          >
            <span class="w-6 text-center">#</span><span class="flex-1">歌曲</span
            ><span class="w-[24%]">专辑</span>
            <Clock class="mr-12 size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          </div>
          <ul class="grid grid-cols-1">
            <li
              v-for="(song, index) in songs"
              :key="song.id"
              class="flex items-center gap-1 rounded-field"
              :class="current?.id === song.id ? 'bg-primary/8' : 'hover:bg-base-200/70'"
            >
              <button
                class="group relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-field py-2 pr-1 pl-2 text-left lg:pr-3 lg:pl-3"
                :aria-label="`播放 ${song.title}`"
                :aria-busy="playbackLoading && current?.id === song.id"
                :aria-current="current?.id === song.id ? 'true' : undefined"
                :disabled="app.offline && !offlineAudio?.has(song.id)"
                :aria-description="
                  app.offline && !offlineAudio?.has(song.id)
                    ? '音频未缓存'
                    : [
                        offlineAudio?.has(song.id) && '音频已缓存',
                        current?.id === song.id &&
                          (playbackLoading ? '正在加载' : playing && '正在播放'),
                      ]
                        .filter(Boolean)
                        .join('，') || undefined
                "
                @click="play(song)"
              >
                <span
                  class="pointer-events-none absolute left-2 z-10 grid size-10 shrink-0 place-items-center rounded-[18%] text-center text-xs tabular-nums sm:relative sm:left-auto sm:size-auto sm:w-6"
                  :class="
                    current?.id === song.id && (playbackLoading || playing)
                      ? 'max-sm:bg-neutral/70'
                      : 'max-sm:opacity-0 max-sm:group-hover:bg-neutral/70 max-sm:group-hover:opacity-100'
                  "
                  aria-hidden="true"
                >
                  <span
                    v-if="playbackLoading && current?.id === song.id"
                    class="loading loading-spinner loading-xs text-neutral-content sm:text-primary"
                  />
                  <PlayingBars
                    v-else-if="playing && current?.id === song.id"
                    class="size-4 text-neutral-content sm:text-primary"
                  />
                  <template v-else
                    ><span class="hidden text-base-content/55 group-hover:opacity-0 sm:block">{{
                      index + 1
                    }}</span
                    ><Play
                      class="absolute size-4 shrink-0 text-neutral-content sm:text-base-content sm:opacity-0 sm:group-hover:opacity-100"
                      :stroke-width="1.8"
                      aria-hidden="true"
                      fill="currentColor"
                  /></template>
                </span>
                <MusicArtwork
                  :src="song.coverId ? coverUrls[song.coverId] : undefined"
                  class="w-10"
                />
                <span class="min-w-0 flex-1">
                  <span
                    class="flex items-center gap-1.5 text-sm font-semibold group-disabled:opacity-65"
                    :class="{ 'text-primary': current?.id === song.id }"
                  >
                    <span class="truncate">{{ song.title }}</span>
                    <span
                      v-if="offlineAudio?.has(song.id)"
                      class="tooltip inline-flex shrink-0"
                      data-tip="已缓存"
                      aria-hidden="true"
                    >
                      <FileCheck class="size-3 text-base-content/45" />
                    </span>
                  </span>
                  <span class="block truncate text-xs text-base-content/65"
                    >{{ song.artist
                    }}<span v-if="song.album" class="lg:hidden"> · {{ song.album }}</span></span
                  >
                </span>
                <span class="hidden w-[26%] truncate text-xs text-base-content/65 lg:block">{{
                  song.album || "—"
                }}</span>
                <span
                  class="hidden min-w-8 shrink-0 justify-items-end text-xs text-base-content/65 tabular-nums sm:grid"
                >
                  <span v-if="song.duration != null">{{ formatMusicTime(song.duration) }}</span>
                </span>
              </button>
              <SongActionMenu
                :song="song"
                :offline="app.offline"
                :cached="Boolean(offlineAudio?.has(song.id))"
                :downloading="isDownloading(song.id)"
                @details="songManagement?.open($event)"
                @edit="songManagement?.openEdit($event)"
                @playlists="songManagement?.openPlaylists($event)"
                @download="downloadSong($event)"
                @delete="songManagement?.openDelete($event)"
              />
            </li>
          </ul>
          <AsyncButton
            v-if="hasNextPage"
            class="btn btn-ghost btn-sm mt-3"
            :disabled="loading"
            :action="() => loadNextPage()"
          >
            加载更多
          </AsyncButton>
        </div>
      </div>
    </section>
    <slot />
    <LibraryPlayer />
    <SongManagementDialog ref="songManagement" :cover-urls="coverUrls" />
  </div>
</template>
