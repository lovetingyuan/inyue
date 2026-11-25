<script setup lang="ts">
import { computed, ref, useId, useTemplateRef } from "vue";
import { Download, Ellipsis, Info, ListPlus, Pencil, Trash2 } from "@lucide/vue";
import type { SongDetails } from "~~/shared/types/library";

defineOptions({ name: "SongActionMenu" });

const props = defineProps<{
  song: SongDetails;
  offline: boolean;
  cached: boolean;
  downloading: boolean;
}>();

const emit = defineEmits<{
  details: [SongDetails];
  edit: [SongDetails];
  playlists: [SongDetails];
  download: [SongDetails];
  delete: [SongDetails];
}>();

const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
const menuId = `song-menu-${rawId}`;
const anchorName = `--${menuId}`;
const menu = useTemplateRef<HTMLElement>("menu");
const open = ref(false);
const downloadDisabled = computed(() => props.downloading || (props.offline && !props.cached));

function closeMenu() {
  const element = menu.value;
  if (element?.matches(":popover-open")) {
    element.hidePopover();
  }
}

function syncOpenState() {
  open.value = Boolean(menu.value?.matches(":popover-open"));
}

function select(action: "details" | "edit" | "playlists" | "download" | "delete") {
  closeMenu();
  switch (action) {
    case "details":
      emit("details", props.song);
      break;
    case "edit":
      emit("edit", props.song);
      break;
    case "playlists":
      emit("playlists", props.song);
      break;
    case "download":
      emit("download", props.song);
      break;
    case "delete":
      emit("delete", props.song);
      break;
  }
}
</script>

<template>
  <button
    type="button"
    class="btn btn-ghost btn-circle btn-sm mr-1 shrink-0"
    :aria-label="`${song.title} 更多操作`"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-controls="menuId"
    :popovertarget="menuId"
    :style="`anchor-name: ${anchorName}`"
  >
    <span v-if="downloading" class="loading loading-spinner loading-xs" aria-hidden="true" />
    <Ellipsis v-else class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
  </button>
  <ul
    :id="menuId"
    ref="menu"
    popover
    role="menu"
    :aria-label="`${song.title} 操作菜单`"
    class="dropdown dropdown-end menu my-1 w-40 rounded-box border border-base-300/80 bg-base-100 p-1.5 shadow-lg [position-try-fallbacks:flip-block]"
    :style="`position-anchor: ${anchorName}`"
    @toggle="syncOpenState"
  >
    <li role="none">
      <button type="button" role="menuitem" @click="select('details')">
        <Info class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
        查看详情
      </button>
    </li>
    <li role="none">
      <button type="button" role="menuitem" :disabled="offline" @click="select('edit')">
        <Pencil class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
        编辑
      </button>
    </li>
    <li role="none">
      <button type="button" role="menuitem" :disabled="offline" @click="select('playlists')">
        <ListPlus class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
        加入歌单
      </button>
    </li>
    <li role="none">
      <button
        type="button"
        role="menuitem"
        :disabled="downloadDisabled"
        :aria-busy="downloading"
        @click="select('download')"
      >
        <span v-if="downloading" class="loading loading-spinner loading-xs" aria-hidden="true" />
        <Download v-else class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
        {{ downloading ? "下载中…" : "下载" }}
      </button>
    </li>
    <li role="none">
      <button
        type="button"
        role="menuitem"
        class="text-error hover:bg-error/10 active:bg-error active:text-error-content"
        :disabled="offline"
        @click="select('delete')"
      >
        <Trash2 class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
        删除
      </button>
    </li>
  </ul>
</template>
