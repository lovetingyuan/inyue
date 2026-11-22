<script setup lang="ts">
import { libraryFormError } from "~/utils/library-error";
import { useAppStore } from "~/stores/app";
import { useSongSave } from "~/composables/useLibraryMutations";
import MusicArtwork from "~/components/MusicArtwork.vue";
import SongMetadataLookup from "~/components/SongMetadataLookup.vue";
import { computed, reactive, ref, shallowRef, useId, useTemplateRef, watch } from "vue";
import { ClipboardPaste, FileText, Image, Music, Plus, X } from "@lucide/vue";
import { Capacitor } from "@capacitor/core";
import { useObjectUrl } from "@vueuse/core";
import type { Song } from "~~/shared/types/library";
import type {
  SongMetadataCandidate,
  SongMetadataEnrichResult,
} from "~~/shared/types/song-metadata";
import { decodeLrcBytes, parseLrc } from "~~/shared/lrc";
import { audioMaxBytes, coverMaxBytes, lyricsMaxBytes } from "~~/shared/library-limits";

const props = defineProps<{ song?: Song; coverUrl?: string }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const saveSong = useSongSave();
const form = reactive({
  title: props.song?.title ?? "",
  artist: props.song?.artist ?? "",
  album: props.song?.album ?? "",
  year: props.song?.year?.toString() ?? "",
  lyricist: props.song?.lyricist ?? "",
  composer: props.song?.composer ?? "",
  description: props.song?.description ?? "",
});
const audio = shallowRef<File>();
const cover = shallowRef<File>();
const lyrics = shallowRef<File>();
const localCoverUrl = useObjectUrl(cover);
const audioInput = useTemplateRef("audioInput");
const coverInput = useTemplateRef("coverInput");
const lyricsInput = useTemplateRef("lyricsInput");
const removeCover = ref(false);
const removeLyrics = ref(false);
const hasCover = computed(() =>
  Boolean(cover.value || (props.song?.coverId && !removeCover.value)),
);
const hasLyrics = computed(() =>
  Boolean(lyrics.value || (props.song?.lyrics && !removeLyrics.value)),
);
const oversizedCover = ref(false);
const reading = ref(false);
const readingLyrics = ref(false);
const pastingCover = ref(false);
const pastingLyrics = ref(false);
const lookupBusy = ref(false);
const metadataFilled = ref(false);
const busy = saveSong.isLoading;
const app = useAppStore();
const formDisabled = computed(() => busy.value || app.offline);
const mediaBusy = computed(
  () =>
    formDisabled.value ||
    reading.value ||
    readingLyrics.value ||
    pastingCover.value ||
    pastingLyrics.value ||
    lookupBusy.value,
);
const error = ref("");
const fieldId = useId();
const fieldErrors = reactive<
  Partial<Record<keyof typeof form | "audio" | "cover" | "lyrics", string>>
>({});
const audioNotice = ref("");
const coverPasteNotice = ref("");
const lyricsPasteNotice = ref("");
const lookupStatus = ref<{ tone: "info" | "error"; message: string } | null>(null);
const fillEmptyOnly = computed(() => Boolean(props.song));
const lookupNeedCover = computed(() => !fillEmptyOnly.value || !hasCover.value);
const lookupNeedLyrics = computed(() => !fillEmptyOnly.value || !hasLyrics.value);
const lookupNeedCredits = computed(() => !fillEmptyOnly.value || !form.lyricist || !form.composer);
const lookupNeedDescription = computed(() => !fillEmptyOnly.value || !form.description);
const coverTypes = ["image/jpeg", "image/png", "image/webp"];
const coverError = computed(() =>
  oversizedCover.value ? "封面超过 1 MiB，请移除或重新选择。" : fieldErrors.cover,
);
const fields = [
  { name: "title", label: "歌曲名" },
  { name: "artist", label: "歌手" },
  { name: "album", label: "专辑" },
  { name: "year", label: "年份" },
  { name: "lyricist", label: "作词" },
  { name: "composer", label: "作曲" },
] as const;

async function selectAudio(event: Event) {
  if (mediaBusy.value) {
    return;
  }
  const file = event.target instanceof HTMLInputElement ? event.target.files?.[0] : undefined;
  const preserveFilled = metadataFilled.value;
  audio.value = undefined;
  if (!preserveFilled) {
    cover.value = undefined;
    oversizedCover.value = false;
    fieldErrors.cover = "";
    coverPasteNotice.value = "";
  }
  fieldErrors.audio = "";
  audioNotice.value = "";
  error.value = "";
  if (!file) {
    return;
  }
  if (file.size > audioMaxBytes) {
    fieldErrors.audio = "MP3 不能超过 15 MiB。";
    if (audioInput.value) {
      audioInput.value.value = "";
    }
    return;
  }
  audio.value = file;
  if (!preserveFilled) {
    for (const { name } of fields) {
      fieldErrors[name] = "";
    }
    fieldErrors.description = "";
    form.artist = "";
    form.album = "";
    form.year = "";
    form.lyricist = "";
    form.composer = "";
    form.description = "";
    form.title = file.name.replace(/\.mp3$/i, "");
  } else if (!form.title) {
    form.title = file.name.replace(/\.mp3$/i, "");
  }
  reading.value = true;
  try {
    const { parseBlob, selectCover } = await import("music-metadata");
    const { common, native } = await parseBlob(file);
    let parsedLyricist = "";
    for (const tags of Object.values(native)) {
      const value: unknown = tags.find((tag) => tag.id === "TEXT" || tag.id === "TXT")?.value;
      if (typeof value === "string") {
        parsedLyricist = value;
        break;
      }
    }
    if (!preserveFilled) {
      form.title = common.title || form.title;
      form.artist = common.artist || "";
      form.album = common.album || "";
      form.year = common.year?.toString() || "";
      form.composer = common.composer?.join("、") || "";
      form.description = common.comment?.[0]?.text || "";
      form.lyricist = parsedLyricist;
    } else {
      form.title ||= common.title || "";
      form.artist ||= common.artist || "";
      form.album ||= common.album || "";
      form.year ||= common.year?.toString() || "";
      form.composer ||= common.composer?.join("、") || "";
      form.description ||= common.comment?.[0]?.text || "";
      form.lyricist ||= parsedLyricist;
    }
    const embedded = selectCover(common.picture);
    if (embedded && (!preserveFilled || !hasCover.value)) {
      oversizedCover.value = embedded.data.byteLength > coverMaxBytes;
      if (!oversizedCover.value) {
        cover.value = new File([new Uint8Array(embedded.data)], "embedded-cover", {
          type: embedded.format,
        });
      }
    }
  } catch {
    if (!preserveFilled) {
      audioNotice.value = "无法读取 ID3，可以手动填写资料。";
    }
  } finally {
    reading.value = false;
  }
}

function setLookupBusy(value: boolean) {
  lookupBusy.value = value;
  if (value) {
    lookupStatus.value = null;
  }
}

function applyMetadata({
  candidate,
  enriched,
  cover: fetchedCover,
}: {
  candidate: SongMetadataCandidate;
  enriched: SongMetadataEnrichResult;
  cover?: File;
}) {
  const overwrite = !fillEmptyOnly.value;
  const filledParts: string[] = [];
  let textFilled = false;

  function assignField(name: keyof typeof form, value: string | null | undefined) {
    const next = value?.trim() ?? "";
    if (!next) {
      return;
    }
    if (overwrite || !form[name]) {
      form[name] = next;
      fieldErrors[name] = "";
      textFilled = true;
    }
  }

  assignField("title", candidate.title);
  assignField("artist", candidate.artist);
  assignField("album", candidate.album);
  assignField("year", candidate.year?.toString());
  assignField("lyricist", enriched.lyricist);
  assignField("composer", enriched.composer);
  assignField("description", enriched.description);
  if (textFilled) {
    filledParts.push("资料");
  }

  if (fetchedCover && (overwrite || !hasCover.value)) {
    setCover(fetchedCover);
    filledParts.push("封面");
  }

  if (enriched.lyrics && (overwrite || !hasLyrics.value) && parseLrc(enriched.lyrics).length) {
    const safeTitle = candidate.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 60) || "lyrics";
    const file = new File([enriched.lyrics], `${safeTitle}.lrc`, {
      type: "text/plain;charset=utf-8",
    });
    if (file.size <= lyricsMaxBytes) {
      setLyrics(file);
      filledParts.push("歌词");
    }
  }

  if (filledParts.length) {
    metadataFilled.value = true;
    lookupStatus.value = { tone: "info", message: `已填充${filledParts.join("、")}。` };
  } else {
    lookupStatus.value = { tone: "info", message: "当前字段均已有内容，无需补全。" };
  }
}

function selectCoverFile(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) {
    return;
  }
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!mediaBusy.value) {
    setCover(file);
  }
}

function setCover(file: File | undefined) {
  cover.value = file;
  oversizedCover.value = (file?.size ?? 0) > coverMaxBytes;
  fieldErrors.cover = "";
  coverPasteNotice.value = "";
  removeCover.value = false;
}

async function pasteCover() {
  if (mediaBusy.value) {
    return;
  }
  pastingCover.value = true;
  coverPasteNotice.value = "";
  try {
    let image: Blob | undefined;
    if (Capacitor.isNativePlatform()) {
      const { Clipboard, ClipboardContentType } = await import("@capawesome/capacitor-clipboard");
      const { type, value } = await Clipboard.read();
      if (type === ClipboardContentType.Image && value.startsWith("data:image/")) {
        image = await (await fetch(value)).blob();
      }
    } else {
      if (!navigator.clipboard?.read) {
        coverPasteNotice.value = "当前浏览器无法读取剪贴板图片。";
        return;
      }
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((type) => coverTypes.includes(type));
        if (type) {
          image = await item.getType(type);
          break;
        }
      }
    }
    if (!image?.size || !coverTypes.includes(image.type)) {
      coverPasteNotice.value = "剪贴板中没有可用的封面图片。";
      return;
    }
    if (image.size > coverMaxBytes) {
      coverPasteNotice.value = "剪贴板图片超过 1 MiB。";
      return;
    }
    const extension = image.type.slice("image/".length);
    setCover(new File([image], `剪贴板封面.${extension}`, { type: image.type }));
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "NotAllowedError") {
      coverPasteNotice.value = "未获得读取剪贴板的权限。";
    } else if (cause instanceof Error && "code" in cause && cause.code === "EMPTY_CLIPBOARD") {
      coverPasteNotice.value = "剪贴板中没有可用的封面图片。";
    } else {
      coverPasteNotice.value = "无法读取剪贴板图片。";
    }
  } finally {
    pastingCover.value = false;
  }
}

function clearCover() {
  setCover(undefined);
  removeCover.value = true;
}

const htmlBlockTags = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
]);

function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let result = "";
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const tag = node.nodeName.toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE") {
      return;
    }
    if (tag === "BR") {
      result += "\n";
      return;
    }
    const isBlock = htmlBlockTags.has(tag);
    if (isBlock && result && !result.endsWith("\n")) {
      result += "\n";
    }
    for (const child of node.childNodes) {
      walk(child);
    }
    if (isBlock && result && !result.endsWith("\n")) {
      result += "\n";
    }
  }
  if (doc.body) {
    walk(doc.body);
  }
  return result;
}

function setLyrics(file: File | undefined) {
  lyrics.value = file;
  fieldErrors.lyrics = "";
  lyricsPasteNotice.value = "";
  removeLyrics.value = false;
}

async function selectLyricsFile(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) {
    return;
  }
  const file = event.target.files?.[0];
  event.target.value = "";
  if (mediaBusy.value || !file) {
    return;
  }
  fieldErrors.lyrics = "";
  lyricsPasteNotice.value = "";
  if (file.size > lyricsMaxBytes) {
    lyrics.value = undefined;
    fieldErrors.lyrics = "歌词文件不能超过 64 KiB。";
    return;
  }
  readingLyrics.value = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = decodeLrcBytes(bytes);
    if (!text || !parseLrc(text).length) {
      lyrics.value = undefined;
      fieldErrors.lyrics = "请选择包含时间轴的有效 LRC 歌词文件。";
      return;
    }
    setLyrics(file);
  } catch {
    lyrics.value = undefined;
    fieldErrors.lyrics = "无法读取歌词文件。";
  } finally {
    readingLyrics.value = false;
  }
}

async function pasteLyrics() {
  if (mediaBusy.value) {
    return;
  }
  pastingLyrics.value = true;
  lyricsPasteNotice.value = "";
  try {
    let rawText: string | undefined;
    if (Capacitor.isNativePlatform()) {
      const { Clipboard, ClipboardContentType } = await import("@capawesome/capacitor-clipboard");
      const { type, value } = await Clipboard.read();
      if (type === ClipboardContentType.Text) {
        rawText = value;
      } else if (type === ClipboardContentType.Html) {
        rawText = htmlToPlainText(value);
      }
    } else {
      if (!navigator.clipboard?.readText) {
        lyricsPasteNotice.value = "当前浏览器无法读取剪贴板文本。";
        return;
      }
      rawText = await navigator.clipboard.readText();
    }
    const normalized = rawText
      ?.replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .trim();
    if (!normalized) {
      lyricsPasteNotice.value = "剪贴板中没有可用的 LRC 歌词。";
      return;
    }
    const file = new File([normalized], "剪贴板歌词.lrc", {
      type: "text/plain;charset=utf-8",
    });
    if (file.size > lyricsMaxBytes) {
      lyricsPasteNotice.value = "剪贴板歌词超过 64 KiB。";
      return;
    }
    if (normalized.includes("\0") || !parseLrc(normalized).length) {
      lyricsPasteNotice.value = "剪贴板内容不是包含时间轴的有效 LRC 歌词。";
      return;
    }
    setLyrics(file);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "NotAllowedError") {
      lyricsPasteNotice.value = "未获得读取剪贴板的权限。";
    } else if (cause instanceof Error && "code" in cause && cause.code === "EMPTY_CLIPBOARD") {
      lyricsPasteNotice.value = "剪贴板中没有可用的 LRC 歌词。";
    } else {
      lyricsPasteNotice.value = "无法读取剪贴板歌词。";
    }
  } finally {
    pastingLyrics.value = false;
  }
}

function clearLyrics() {
  setLyrics(undefined);
  removeLyrics.value = true;
}

async function save() {
  if (app.offline) {
    return;
  }
  if (mediaBusy.value) {
    return;
  }
  error.value = "";
  if (!props.song && !audio.value) {
    fieldErrors.audio ||= "请选择 MP3 文件。";
  }
  if (!form.title) {
    fieldErrors.title = "请填写歌曲名。";
  }
  if (!form.artist) {
    fieldErrors.artist = "请填写歌手。";
  }
  if (form.year && !/^[1-9]\d{3}$/.test(form.year)) {
    fieldErrors.year = "请输入 1000 至 9999 的四位年份。";
  }
  for (const { name } of fields) {
    if (name !== "year" && form[name].length > 250) {
      fieldErrors[name] = "最多填写 250 字。";
    }
  }
  if (form.description.length > 4000) {
    fieldErrors.description = "最多填写 4000 字。";
  }
  if (coverError.value || Object.values(fieldErrors).some(Boolean)) {
    return;
  }
  const body = new FormData();
  for (const [name, value] of Object.entries(form)) {
    body.set(name, value);
  }
  if (audio.value) {
    body.set("audio", audio.value);
  }
  if (cover.value) {
    body.set("cover", cover.value);
  }
  if (removeCover.value) {
    body.set("removeCover", "true");
  }
  if (lyrics.value) {
    body.set("lyrics", lyrics.value);
  }
  if (removeLyrics.value) {
    body.set("removeLyrics", "true");
  }
  try {
    await saveSong.mutateAsync({ songId: props.song?.id, body });
    emit("saved");
  } catch (cause) {
    const { field, message } = libraryFormError(cause);
    const metadataField = fields.find(({ name }) => name === field)?.name;
    if (field === "audio" || field === "cover" || field === "lyrics" || field === "description") {
      fieldErrors[field] = message;
    } else if (metadataField) {
      fieldErrors[metadataField] = message;
    } else {
      error.value = message;
    }
  }
}

watch(
  () => app.offline,
  (offline) => {
    if (offline) {
      app.notifyOffline();
    }
  },
  { immediate: true },
);

defineExpose({ busy });
</script>

<template>
  <form class="grid gap-4" novalidate @submit.prevent="save">
    <h2 v-if="song" class="text-lg font-semibold">编辑歌曲</h2>
    <fieldset class="grid min-w-0 gap-4" :disabled="formDisabled">
      <div class="grid gap-2" :class="{ 'sm:grid-cols-2': !song }">
        <div v-if="!song" class="min-w-0">
          <input
            ref="audioInput"
            type="file"
            hidden
            accept=".mp3,audio/mpeg"
            :disabled="mediaBusy"
            @change="selectAudio"
          />
          <button
            class="btn btn-ghost validator h-14 w-full justify-start gap-3 rounded-box bg-primary/5 px-3 text-left hover:bg-primary/10"
            :class="fieldErrors.audio ? 'border-error' : 'border-primary/25'"
            type="button"
            :disabled="mediaBusy"
            :aria-invalid="!!fieldErrors.audio"
            :aria-describedby="
              fieldErrors.audio
                ? `${fieldId}-audio-error`
                : audioNotice
                  ? `${fieldId}-audio-notice`
                  : undefined
            "
            :aria-busy="reading"
            @click="audioInput?.click()"
          >
            <span
              class="grid size-9 shrink-0 place-items-center rounded-field bg-primary/10 text-primary"
            >
              <span v-if="reading" class="loading loading-spinner loading-xs" aria-hidden="true" />
              <Music v-else class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm">
                {{ audio ? "更换 MP3" : "选择 MP3"
                }}<span class="ml-0.5 text-xs text-error" aria-hidden="true">*</span>
                <span class="sr-only">（必填）</span>
              </span>
              <span
                class="block truncate text-xs font-normal text-base-content/70"
                :title="audio?.name"
              >
                {{ reading ? "读取歌曲资料中…" : (audio?.name ?? "最大 15 MiB") }}
              </span>
            </span>
            <Plus
              v-if="!audio"
              class="text-primary size-5 shrink-0"
              :stroke-width="1.8"
              aria-hidden="true"
            />
          </button>
          <p
            v-if="fieldErrors.audio"
            :id="`${fieldId}-audio-error`"
            class="validator-hint mt-1"
            role="alert"
          >
            {{ fieldErrors.audio }}
          </p>
          <p
            v-else-if="audioNotice"
            :id="`${fieldId}-audio-notice`"
            class="mt-1 text-xs text-warning"
            role="status"
          >
            {{ audioNotice }}
          </p>
          <span class="sr-only" role="status">{{ reading ? "读取歌曲资料中…" : audio?.name }}</span>
        </div>
        <div class="min-w-0">
          <input
            ref="coverInput"
            type="file"
            hidden
            :accept="coverTypes.join(',')"
            :disabled="mediaBusy"
            @change="selectCoverFile"
          />
          <div
            class="validator flex h-14 items-center rounded-box border bg-base-100 transition-colors hover:bg-base-200/50"
            :class="coverError ? 'border-error' : 'border-base-300'"
          >
            <MusicArtwork
              v-if="hasCover"
              zoomable
              :src="localCoverUrl ?? coverUrl"
              class="ml-3 w-9"
            />
            <button
              class="btn btn-ghost h-full min-w-0 flex-1 justify-start gap-3 rounded-box border-0 px-3 text-left hover:bg-transparent hover:shadow-none"
              type="button"
              :disabled="mediaBusy"
              :aria-invalid="!!coverError"
              :aria-describedby="coverError ? `${fieldId}-cover-error` : undefined"
              @click="coverInput?.click()"
            >
              <span
                v-if="!hasCover"
                class="grid size-9 shrink-0 place-items-center rounded-field bg-base-200 text-base-content/75"
                ><Image class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true"
              /></span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm">{{ hasCover ? "更换封面" : "选择封面" }}</span>
                <span
                  class="block truncate text-xs font-normal text-base-content/70"
                  :title="cover?.name"
                >
                  {{ cover?.name ?? (hasCover ? "已有封面" : "可选 · 最大 1 MiB") }}
                </span>
              </span>
              <Plus
                v-if="!hasCover && !oversizedCover"
                class="text-base-content/65 size-5 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
              />
            </button>
            <button
              class="btn btn-ghost btn-circle mr-1 size-11 shrink-0 hover:shadow-none"
              type="button"
              aria-label="粘贴封面"
              title="粘贴封面"
              :disabled="mediaBusy"
              :aria-busy="pastingCover"
              @click="pasteCover"
            >
              <span
                v-if="pastingCover"
                class="loading loading-spinner loading-xs"
                aria-hidden="true"
              />
              <ClipboardPaste
                v-else
                class="size-4 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
              />
            </button>
            <button
              v-if="hasCover || oversizedCover"
              class="btn btn-ghost btn-circle mr-1 size-11 shrink-0 hover:bg-transparent hover:text-error hover:shadow-none"
              type="button"
              aria-label="移除封面"
              :disabled="mediaBusy"
              @click="clearCover"
            >
              <X class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
            </button>
          </div>
          <span class="sr-only" role="status">{{ cover?.name }}</span>
          <p
            v-if="coverError"
            :id="`${fieldId}-cover-error`"
            class="validator-hint mt-1"
            role="alert"
          >
            {{ coverError }}
          </p>
          <p v-if="coverPasteNotice" class="mt-1 text-xs text-error" role="status">
            {{ coverPasteNotice }}
          </p>
        </div>
        <div class="min-w-0" :class="{ 'sm:col-span-2': !song }">
          <input
            ref="lyricsInput"
            type="file"
            hidden
            :accept="app.native ? undefined : '.lrc'"
            :disabled="mediaBusy"
            @change="selectLyricsFile"
          />
          <div
            class="validator flex h-14 items-center rounded-box border bg-base-100 transition-colors hover:bg-base-200/50"
            :class="fieldErrors.lyrics ? 'border-error' : 'border-base-300'"
          >
            <button
              class="btn btn-ghost h-full min-w-0 flex-1 justify-start gap-3 rounded-box border-0 px-3 text-left hover:bg-transparent hover:shadow-none"
              type="button"
              :disabled="mediaBusy"
              :aria-invalid="!!fieldErrors.lyrics"
              :aria-describedby="fieldErrors.lyrics ? `${fieldId}-lyrics-error` : undefined"
              :aria-busy="readingLyrics"
              @click="lyricsInput?.click()"
            >
              <span
                class="grid size-9 shrink-0 place-items-center rounded-field bg-base-200 text-base-content/75"
              >
                <span
                  v-if="readingLyrics"
                  class="loading loading-spinner loading-xs"
                  aria-hidden="true"
                />
                <FileText v-else class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm">{{ hasLyrics ? "更换歌词" : "选择歌词" }}</span>
                <span
                  class="block truncate text-xs font-normal text-base-content/70"
                  :title="lyrics?.name"
                >
                  {{
                    readingLyrics
                      ? "读取歌词中…"
                      : (lyrics?.name ?? (hasLyrics ? "已有 LRC 歌词" : "可选 · LRC，最大 64 KiB"))
                  }}
                </span>
              </span>
              <Plus
                v-if="!hasLyrics && !fieldErrors.lyrics"
                class="size-5 shrink-0 text-base-content/65"
                :stroke-width="1.8"
                aria-hidden="true"
              />
            </button>
            <button
              class="btn btn-ghost btn-circle mr-1 size-11 shrink-0 hover:shadow-none"
              type="button"
              aria-label="粘贴歌词"
              title="粘贴歌词"
              :disabled="mediaBusy"
              :aria-busy="pastingLyrics"
              @click="pasteLyrics"
            >
              <span
                v-if="pastingLyrics"
                class="loading loading-spinner loading-xs"
                aria-hidden="true"
              />
              <ClipboardPaste
                v-else
                class="size-4 shrink-0"
                :stroke-width="1.8"
                aria-hidden="true"
              />
            </button>
            <button
              v-if="hasLyrics || fieldErrors.lyrics"
              class="btn btn-ghost btn-circle mr-1 size-11 shrink-0 hover:bg-transparent hover:text-error hover:shadow-none"
              type="button"
              aria-label="移除歌词"
              :disabled="mediaBusy"
              @click="clearLyrics"
            >
              <X class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
            </button>
          </div>
          <span class="sr-only" role="status">{{
            readingLyrics ? "读取歌词中…" : lyrics?.name
          }}</span>
          <p
            v-if="fieldErrors.lyrics"
            :id="`${fieldId}-lyrics-error`"
            class="validator-hint mt-1"
            role="alert"
          >
            {{ fieldErrors.lyrics }}
          </p>
          <p v-if="lyricsPasteNotice" class="mt-1 text-xs text-error" role="status">
            {{ lyricsPasteNotice }}
          </p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div v-for="field in fields" :key="field.name" class="grid content-start gap-1.5 text-sm">
          <label :for="`${fieldId}-${field.name}`" class="font-medium">
            {{ field.label
            }}<span
              v-if="field.name === 'title' || field.name === 'artist'"
              class="ml-0.5 text-xs text-error"
              aria-hidden="true"
              >*</span
            >
          </label>
          <input
            :id="`${fieldId}-${field.name}`"
            v-model.trim="form[field.name]"
            class="input validator w-full"
            :required="field.name === 'title' || field.name === 'artist'"
            :maxlength="field.name === 'year' ? 4 : 250"
            :inputmode="field.name === 'year' ? 'numeric' : 'text'"
            :disabled="reading || lookupBusy"
            :aria-invalid="!!fieldErrors[field.name]"
            :aria-describedby="
              fieldErrors[field.name] ? `${fieldId}-${field.name}-error` : undefined
            "
            @input="fieldErrors[field.name] = ''"
          />
          <p
            v-if="fieldErrors[field.name]"
            :id="`${fieldId}-${field.name}-error`"
            class="validator-hint mt-0"
            role="alert"
          >
            {{ fieldErrors[field.name] }}
          </p>
        </div>
      </div>
      <div class="grid gap-1.5 text-sm">
        <label :for="`${fieldId}-description`" class="font-medium">介绍</label>
        <textarea
          :id="`${fieldId}-description`"
          v-model.trim="form.description"
          class="textarea validator w-full"
          maxlength="4000"
          :disabled="reading || lookupBusy"
          :aria-invalid="!!fieldErrors.description"
          :aria-describedby="fieldErrors.description ? `${fieldId}-description-error` : undefined"
          @input="fieldErrors.description = ''"
        />
        <p
          v-if="fieldErrors.description"
          :id="`${fieldId}-description-error`"
          class="validator-hint mt-0"
          role="alert"
        >
          {{ fieldErrors.description }}
        </p>
      </div>
    </fieldset>
    <p v-if="error" role="alert" class="text-error">{{ error }}</p>
    <p
      v-else-if="lookupStatus"
      :role="lookupStatus.tone === 'error' ? 'alert' : 'status'"
      class="text-xs"
      :class="lookupStatus.tone === 'error' ? 'text-error' : 'text-primary'"
    >
      {{ lookupStatus.message }}
    </p>
    <div class="flex items-center justify-end gap-2">
      <SongMetadataLookup
        :title="form.title"
        :artist="form.artist"
        :disabled="formDisabled || reading || readingLyrics || pastingCover || pastingLyrics"
        :need-cover="lookupNeedCover"
        :need-lyrics="lookupNeedLyrics"
        :need-credits="lookupNeedCredits"
        :need-description="lookupNeedDescription"
        @busy-change="setLookupBusy"
        @status="lookupStatus = $event"
        @apply="applyMetadata"
      />
      <button class="btn btn-ghost" type="button" :disabled="busy" @click="emit('cancel')">
        取消
      </button>
      <button type="submit" class="btn btn-primary" :disabled="mediaBusy" :aria-busy="busy">
        <span v-if="busy" class="loading loading-spinner loading-xs" aria-hidden="true" />
        保存
      </button>
    </div>
  </form>
</template>
