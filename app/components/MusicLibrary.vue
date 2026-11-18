<script setup lang="ts">
import { Clock, Ellipsis, LoaderCircle, Music, Play, Search, X } from "@lucide/vue";
import { useObjectUrl } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { coverMaxBytes } from "~~/shared/library-limits";
import type { Playlist, Song } from "~~/shared/types/library";

const library = useLibraryStore();
const app = useAppStore();
const { playlist, search, term } = storeToRefs(library);
const { current, playing, loading: playbackLoading } = storeToRefs(usePlayerStore());
const router = useRouter();
const showLibrary = computed(() => router.currentRoute.value.path === "/");
const { songs: songQuery, playlists: playlistQuery, play: playFromLibrary } = useLibraryQueries();
const { playlists } = usePlaylistState();
const { data: details } = useSongDetailsState();
const songs = computed(() => songQuery.data.value?.pages.flatMap(({ items }) => items) ?? []);
const offlineAudio = useOfflineAudio();
const firstPlayable = computed(() => songs.value.find((song) => !app.offline || offlineAudio.value?.has(song.id)));
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
    playlistQuery.error.value ??
    songCovers.error.value ??
    playlistCovers.error.value;
  return cause ? libraryError(cause) : "";
});
const dialog = useTemplateRef("dialog");
const songEditor = useTemplateRef("songEditor");
const playlistPicker = useTemplateRef("playlistPicker");
const editing = ref<Song>();
const selectedSong = shallowRef<Song>();
const panel = ref<"song" | "playlist" | "details" | "delete">();
const deleting = ref<"song" | "playlist">();
const playlistName = ref("");
const playlistEdit = ref<Playlist>();
const playlistCover = shallowRef<File>();
const playlistCoverPreview = useObjectUrl(() =>
  panel.value === "playlist" ? playlistCover.value : undefined,
);
const removeCover = ref(false);
const hasPlaylistCover = computed(
  () => Boolean(playlistCover.value || (playlistEdit.value?.coverId && !removeCover.value)),
);
const playlistSave = usePlaylistSave();
const libraryDelete = useLibraryDelete();
const pending = computed(() => playlistSave.isLoading.value || libraryDelete.isLoading.value);
const dialogError = ref("");
const playlistErrors = reactive({ name: "", cover: "" });
const playlistFieldId = useId();
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

async function retryLibrary() {
  await Promise.all([songQuery.refetch(), playlistQuery.refetch()]);
  if (songCovers.error.value) void songCovers.refetch();
  if (playlistCovers.error.value) void playlistCovers.refetch();
}

function play(song: Song) {
  return playFromLibrary(song, song.coverId ? (coverUrls.value[song.coverId] ?? null) : null);
}

function playFirst() {
  const song = firstPlayable.value;
  if (song) void play(song);
}

function show(kind: typeof panel.value) {
  panel.value = kind;
  dialogError.value = "";
  showMusicDialog(dialog.value);
}

function closePanel() {
  panel.value = undefined;
  selectedSong.value = undefined;
  library.songId = undefined;
}

function openSong(song: Song) {
  editing.value = song;
  show("song");
}

function view(song: Song) {
  selectedSong.value = song;
  library.songId = song.id;
  show("details");
}

function openPlaylist(item?: Playlist) {
  playlistEdit.value = item;
  playlistName.value = item?.name ?? "";
  playlistCover.value = undefined;
  removeCover.value = false;
  playlistErrors.name = "";
  playlistErrors.cover = "";
  show("playlist");
}

function selectPlaylistCover(event: Event) {
  playlistCover.value =
    event.target instanceof HTMLInputElement ? event.target.files?.[0] : undefined;
  playlistErrors.cover =
    (playlistCover.value?.size ?? 0) > coverMaxBytes ? "封面不能超过 1 MiB。" : "";
}

function clearPlaylistCover() {
  playlistCover.value = undefined;
  removeCover.value = Boolean(playlistEdit.value?.coverId);
  playlistErrors.cover = "";
}

async function update(action: () => Promise<void>) {
  if (pending.value) return;
  dialogError.value = "";
  try {
    await action();
  } catch (cause) {
    dialogError.value = libraryError(cause);
  }
}

async function savePlaylist() {
  if (pending.value || app.offline) return;
  dialogError.value = "";
  if (!playlistName.value) playlistErrors.name = "请填写歌单名称。";
  if (!playlistName.value || (playlistCover.value?.size ?? 0) > coverMaxBytes) return;
  const body = new FormData();
  body.set("name", playlistName.value);
  if (playlistCover.value) body.set("cover", playlistCover.value);
  else if (removeCover.value) body.set("removeCover", "true");
  try {
    await playlistSave.mutateAsync({ playlistId: playlistEdit.value?.id, body });
    dialog.value?.close();
  } catch (cause) {
    const { field, message } = libraryFormError(cause);
    if (field === "name" || field === "cover") playlistErrors[field] = message;
    else dialogError.value = message;
  }
}

async function remove() {
  const kind = deleting.value;
  const id = kind === "song" ? details.value?.id : playlistEdit.value?.id;
  if (!kind || !id) return;
  await libraryDelete.mutateAsync({ kind, id });
  dialog.value?.close();
}

onBeforeUnmount(() => {
  library.songId = undefined;
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <Teleport defer to="#library-playlists">
      <PlaylistNavigation @edit="openPlaylist" />
    </Teleport>
    <section
      v-show="showLibrary"
      class="flex min-h-0 min-w-0 flex-1 flex-col bg-base-100"
      aria-label="歌曲列表"
    >
      <div class="flex items-center gap-2 px-4 pb-3 pt-2 sm:gap-3 sm:px-6 md:pt-4">
        <form role="search" class="flex min-w-0 flex-1" @submit.prevent="library.submitSearch()">
          <div class="input min-w-0 w-full rounded-full border-transparent bg-base-200">
            <button
              type="submit"
              class="btn btn-ghost btn-circle btn-xs -ml-1 text-base-content/70"
              aria-label="搜索"
            >
              <Search class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
            </button>
            <input
              v-model="search"
              type="search"
              class="min-w-0"
              aria-label="搜索歌曲"
              placeholder="搜索歌曲、歌手或专辑"
            />
          </div>
        </form>
      </div>
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6">
        <div
          class="flex shrink-0 items-center gap-3 rounded-box bg-linear-to-br from-primary/17 to-base-200/55 px-2 py-1.5 sm:gap-4 sm:px-3 sm:py-2"
        >
          <MusicArtwork :src="playlistCoverUrl" class="w-12 shadow-md sm:w-14" />
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
          <button
            v-if="firstPlayable"
            type="button"
            class="btn btn-primary btn-circle shrink-0 sm:btn-lg"
            aria-label="播放歌单"
            @click="playFirst"
          >
            <Play
              class="size-5 shrink-0"
              :stroke-width="1.8"
              aria-hidden="true"
              fill="currentColor"
            />
          </button>
        </div>
        <div v-if="loading && !songs.length" role="status" class="mt-4 lg:pt-6">
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
        <div v-else-if="error" class="alert alert-error alert-soft mt-4" role="alert">
          {{ error }} <button class="btn btn-sm" @click="retryLibrary">重试</button>
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
                :aria-current="current?.id === song.id ? 'true' : undefined"
                :disabled="app.offline && !offlineAudio?.has(song.id)"
                :aria-description="
                  current?.id === song.id
                    ? (playbackLoading ? '正在加载' : playing ? '正在播放' : undefined)
                    : undefined
                "
                @click="play(song)"
              >
                <span
                  class="pointer-events-none absolute left-2 z-10 grid size-10 shrink-0 place-items-center rounded-[18%] text-center text-xs tabular-nums sm:relative sm:left-auto sm:size-auto sm:w-6"
                  :class="current?.id === song.id && (playbackLoading || playing)
                    ? 'max-sm:bg-neutral/70'
                    : 'max-sm:opacity-0 max-sm:group-hover:bg-neutral/70 max-sm:group-hover:opacity-100'"
                  aria-hidden="true"
                >
                  <LoaderCircle
                    v-if="playbackLoading && current?.id === song.id"
                    class="size-4 animate-spin text-neutral-content sm:text-primary"
                  />
                  <PlayingBars
                    v-else-if="playing && current?.id === song.id"
                    class="size-4 text-neutral-content sm:text-primary"
                  />
                  <template v-else
                    ><span class="hidden text-base-content/55 group-hover:opacity-0 sm:block">{{ index + 1 }}</span
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
                    class="block truncate text-sm font-semibold"
                    :class="{ 'text-primary': current?.id === song.id }"
                    >{{ song.title }}</span
                  >
                  <span class="block truncate text-xs text-base-content/65"
                    >{{ song.artist
                    }}<span v-if="song.album" class="lg:hidden"> · {{ song.album }}</span></span
                  >
                  <span v-if="app.offline && !offlineAudio?.has(song.id)" class="text-xs text-base-content/65">音频未缓存</span>
                </span>
                <span class="hidden w-[26%] truncate text-xs text-base-content/65 lg:block">{{
                  song.album || "—"
                }}</span>
                <span
                  class="hidden min-w-8 shrink-0 justify-items-end text-xs text-base-content/65 tabular-nums sm:grid"
                >
                  <span v-if="song.duration != null">{{
                    formatMusicTime(song.duration)
                  }}</span>
                </span>
              </button>
              <button
                class="btn btn-ghost btn-circle btn-sm mr-1"
                :aria-label="`${song.title} 详情`"
                @click="view(song)"
              >
                <Ellipsis class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <button
            v-if="hasNextPage"
            class="btn btn-ghost btn-sm mt-3"
            :disabled="loading"
            @click="loadNextPage()"
          >
            加载更多
          </button>
        </div>
      </div>
    </section>
    <slot />
    <LibraryPlayer />
    <dialog
      ref="dialog"
      class="modal modal-bottom sm:modal-middle"
      :aria-label="panel === 'details' ? '歌曲详情' : '管理歌曲和歌单'"
      @cancel="(pending || songEditor?.busy) && $event.preventDefault()"
      @close="closePanel"
    >
      <div
        class="modal-box"
        :class="
          panel === 'details'
            ? 'flex max-h-[min(85dvh,42rem)] flex-col overflow-hidden p-0'
            : 'safe-panel'
        "
      >
        <SongEditor
          v-if="panel === 'song'"
          ref="songEditor"
          :song="editing"
          :cover-url="editing?.coverId ? coverUrls[editing.coverId] : undefined"
          @cancel="dialog?.close()"
          @saved="dialog?.close()"
        />
        <form
          v-else-if="panel === 'playlist'"
          class="grid gap-3"
          novalidate
          @submit.prevent="savePlaylist"
        >
          <h2 class="text-lg font-semibold">{{ playlistEdit ? "编辑歌单" : "新建歌单" }}</h2>
          <div class="grid gap-1">
            <label :for="`${playlistFieldId}-name`">歌单名称</label>
            <input
              :id="`${playlistFieldId}-name`"
              v-model.trim="playlistName"
              class="input validator w-full"
              required
              maxlength="250"
              :disabled="pending"
              :aria-invalid="!!playlistErrors.name"
              :aria-describedby="playlistErrors.name ? `${playlistFieldId}-name-error` : undefined"
              @input="playlistErrors.name = ''"
            />
            <p
              v-if="playlistErrors.name"
              :id="`${playlistFieldId}-name-error`"
              class="validator-hint mt-0"
              role="alert"
            >
              {{ playlistErrors.name }}
            </p>
          </div>
          <div class="grid gap-1">
            <span v-if="hasPlaylistCover">封面</span>
            <label v-else :for="`${playlistFieldId}-cover`">封面</label>
            <div v-if="hasPlaylistCover" class="relative w-fit">
              <MusicArtwork
                :src="
                  playlistCoverPreview ??
                  (playlistEdit?.coverId ? coverUrls[playlistEdit.coverId] : undefined)
                "
                class="w-28"
              />
              <button
                type="button"
                class="btn btn-circle btn-sm absolute top-1 right-1"
                aria-label="移除封面"
                :disabled="pending"
                @click="clearPlaylistCover"
              >
                <X class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
              </button>
            </div>
            <input
              v-else
              :id="`${playlistFieldId}-cover`"
              class="file-input validator w-full"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              :disabled="pending"
              :aria-invalid="!!playlistErrors.cover"
              :aria-describedby="
                playlistErrors.cover ? `${playlistFieldId}-cover-error` : undefined
              "
              @change="selectPlaylistCover"
            />
            <p
              v-if="playlistErrors.cover"
              :id="`${playlistFieldId}-cover-error`"
              class="validator-hint mt-0"
              role="alert"
            >
              {{ playlistErrors.cover }}
            </p>
          </div>
          <p v-if="dialogError" class="text-sm text-error" role="alert">{{ dialogError }}</p>
          <div class="flex flex-wrap justify-end gap-2">
            <button
              v-if="playlistEdit"
              type="button"
              class="btn btn-error btn-outline mr-auto"
              :disabled="pending || app.offline"
              @click="
                dialogError = '';
                deleting = 'playlist';
                panel = 'delete';
              "
            >
              删除歌单
            </button>
            <button type="button" class="btn" :disabled="pending" @click="dialog?.close()">
              取消</button
            ><button class="btn btn-primary" :disabled="pending || app.offline">保存</button>
          </div>
        </form>
        <SongDetails
          v-else-if="panel === 'details' && selectedSong"
          :initial-song="selectedSong"
          :initial-cover-url="selectedSong.coverId ? coverUrls[selectedSong.coverId] : undefined"
          @close="dialog?.close()"
          @edit="openSong"
          @delete="
            deleting = 'song';
            panel = 'delete';
          "
          @playlists="playlistPicker?.open()"
        />
        <div v-else-if="panel === 'delete'" class="grid gap-3">
          <h2 class="text-lg font-semibold">
            {{
              deleting === "song"
                ? `删除《${details?.title}》？`
                : `删除歌单「${playlistEdit?.name}」？`
            }}
          </h2>
          <p v-if="deleting === 'playlist'">歌单中的歌曲会保留。</p>
          <p v-if="dialogError" class="text-sm text-error" role="alert">{{ dialogError }}</p>
          <div class="flex justify-end gap-2">
            <button class="btn" :disabled="pending" @click="dialog?.close()">取消</button>
            <button class="btn btn-error" :disabled="pending || app.offline" @click="update(remove)">
              确认删除
            </button>
          </div>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button tabindex="-1" :disabled="pending || songEditor?.busy">关闭曲库弹窗</button>
      </form>
    </dialog>
    <SongPlaylistPicker v-if="panel === 'details' && details" ref="playlistPicker" />
  </div>
</template>
