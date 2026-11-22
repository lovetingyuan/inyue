<script setup lang="ts">
import MusicArtwork from "~/components/MusicArtwork.vue";
import { useMusicApi } from "~/composables/useMusicApi";
import { formatMusicTime } from "~/utils/format-music-time";
import { showMusicDialog } from "~/utils/music-dialog";
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from "vue";
import { Sparkles, X } from "@lucide/vue";
import { coverMaxBytes } from "~~/shared/library-limits";
import type {
  SongMetadataCandidate,
  SongMetadataEnrichResult,
  SongMetadataSearchResult,
} from "~~/shared/types/song-metadata";

defineOptions({ name: "SongMetadataLookup" });

const props = defineProps<{
  title: string;
  artist?: string;
  disabled?: boolean;
  needCover: boolean;
  needLyrics: boolean;
  needCredits: boolean;
  needDescription: boolean;
}>();

const emit = defineEmits<{
  busyChange: [busy: boolean];
  status: [status: { tone: "info" | "error"; message: string } | null];
  apply: [
    payload: {
      candidate: SongMetadataCandidate;
      enriched: SongMetadataEnrichResult;
      cover?: File;
    },
  ];
}>();

const { request } = useMusicApi();
const picker = useTemplateRef("picker");
const searching = ref(false);
const applyingId = ref("");
const results = shallowRef<SongMetadataCandidate[]>([]);
const coverTypes = ["image/jpeg", "image/png", "image/webp"];
const canLookup = computed(() => Boolean(props.title.trim()));
const busy = computed(() => searching.value || Boolean(applyingId.value));

let searchController: AbortController | undefined;
let applyController: AbortController | undefined;

watch(busy, (value) => {
  emit("busyChange", value);
});

onBeforeUnmount(() => {
  searchController?.abort();
  applyController?.abort();
});

function isAbortError(cause: unknown) {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function candidateMeta(item: SongMetadataCandidate) {
  return [
    item.artist,
    item.album ?? "",
    item.year ? String(item.year) : "",
    item.duration ? formatMusicTime(item.duration) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function closePicker() {
  applyController?.abort();
  applyingId.value = "";
  picker.value?.close();
}

function onPickerClose() {
  if (applyingId.value) {
    applyController?.abort();
    applyingId.value = "";
  }
}

async function lookup() {
  if (props.disabled || busy.value || !canLookup.value) {
    return;
  }
  const term = [props.title.trim(), props.artist?.trim() ?? ""].filter(Boolean).join(" ");
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  searching.value = true;
  emit("status", null);
  try {
    const response = await request<SongMetadataSearchResult>("/api/songs/metadata/search", {
      query: { q: term },
      timeout: 12_000,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      return;
    }
    const data = response._data;
    if (data?.unavailable) {
      emit("status", { tone: "error", message: "搜索服务暂时不可用，请稍后重试。" });
      return;
    }
    const items = data?.items ?? [];
    if (!items.length) {
      emit("status", { tone: "info", message: "未找到匹配的歌曲。" });
      return;
    }
    results.value = items;
    if (items.length === 1 && items[0]) {
      searching.value = false;
      await selectCandidate(items[0]);
      return;
    }
    showMusicDialog(picker.value);
  } catch (cause) {
    if (isAbortError(cause) || controller.signal.aborted) {
      return;
    }
    emit("status", { tone: "error", message: "自动填充失败，请检查网络后重试。" });
  } finally {
    if (searchController === controller) {
      searching.value = false;
    }
  }
}

async function fetchCoverFile(candidate: SongMetadataCandidate, signal: AbortSignal) {
  if (!props.needCover || !candidate.coverUrl) {
    return undefined;
  }
  try {
    const response = await request<Blob>("/api/songs/metadata/cover", {
      query: { url: candidate.coverUrl },
      responseType: "blob",
      timeout: 12_000,
      signal,
    });
    const blob = response._data;
    if (!blob || !blob.size || blob.size > coverMaxBytes || !coverTypes.includes(blob.type)) {
      return undefined;
    }
    const extension = blob.type.slice("image/".length);
    const safeTitle = candidate.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 60) || "cover";
    return new File([blob], `${safeTitle}.${extension}`, { type: blob.type });
  } catch {
    return undefined;
  }
}

async function fetchEnriched(
  candidate: SongMetadataCandidate,
  signal: AbortSignal,
): Promise<SongMetadataEnrichResult> {
  if (!props.needCredits && !props.needLyrics && !props.needDescription) {
    return { lyricist: null, composer: null, description: null, lyrics: null };
  }
  try {
    const response = await request<SongMetadataEnrichResult>("/api/songs/metadata/enrich", {
      method: "POST",
      body: {
        title: candidate.title,
        artist: candidate.artist,
        album: candidate.album,
        year: candidate.year,
        duration: candidate.duration,
        needCredits: props.needCredits,
        needLyrics: props.needLyrics,
        needDescription: props.needDescription,
      },
      timeout: 20_000,
      signal,
    });
    return (
      response._data ?? {
        lyricist: null,
        composer: null,
        description: null,
        lyrics: null,
      }
    );
  } catch {
    return { lyricist: null, composer: null, description: null, lyrics: null };
  }
}

async function selectCandidate(candidate: SongMetadataCandidate) {
  if (props.disabled || busy.value) {
    return;
  }
  applyController?.abort();
  const controller = new AbortController();
  applyController = controller;
  applyingId.value = candidate.id;
  try {
    const [enriched, cover] = await Promise.all([
      fetchEnriched(candidate, controller.signal),
      fetchCoverFile(candidate, controller.signal),
    ]);
    if (controller.signal.aborted) {
      return;
    }
    picker.value?.close();
    emit("apply", { candidate, enriched, cover });
  } finally {
    if (applyController === controller) {
      applyingId.value = "";
    }
  }
}
</script>

<template>
  <button
    type="button"
    class="btn btn-soft btn-primary mr-auto"
    :disabled="disabled || busy || !canLookup"
    :aria-busy="busy"
    @click="lookup"
  >
    <span v-if="busy" class="loading loading-spinner loading-xs" aria-hidden="true" />
    <Sparkles v-else class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
    {{ searching ? "搜索中" : applyingId ? "填充中" : "自动填充" }}
  </button>

  <Teleport to="body">
    <dialog ref="picker" class="modal" aria-label="选择匹配歌曲" @close="onPickerClose">
      <div class="modal-box max-w-md p-0">
        <div class="flex items-center justify-between border-b border-base-300/70 px-4 py-3">
          <h3 class="text-sm font-semibold">选择匹配歌曲</h3>
          <button
            type="button"
            class="btn btn-ghost btn-circle btn-xs"
            aria-label="关闭选择列表"
            @click="closePicker"
          >
            <X class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </div>
        <ul class="max-h-[60dvh] divide-y divide-base-300/60 overflow-y-auto overscroll-contain">
          <li v-for="item in results" :key="item.id">
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-base-200/70 active:bg-base-200 disabled:opacity-60"
              :disabled="disabled || busy"
              :aria-busy="applyingId === item.id"
              @click="selectCandidate(item)"
            >
              <MusicArtwork :src="item.artworkUrl" class="w-10" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ item.title }}</span>
                <span class="block truncate text-xs text-base-content/70">
                  {{ candidateMeta(item) }}
                </span>
              </span>
              <span
                v-if="applyingId === item.id"
                class="loading loading-spinner loading-xs shrink-0 text-primary"
                aria-hidden="true"
              />
            </button>
          </li>
        </ul>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button tabindex="-1" aria-label="关闭选择列表" />
      </form>
    </dialog>
  </Teleport>
</template>
