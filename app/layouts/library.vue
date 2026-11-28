<script setup lang="ts">
import { useSessionStore } from "~/stores/session";
import { useAppStore } from "~/stores/app";
import { useLibraryStore } from "~/stores/library";
import { useUpdateStore } from "~/stores/update";
import PlaylistNavigation from "~/components/PlaylistNavigation.vue";
import AccountAvatar from "~/components/AccountAvatar.vue";
import AccountSettingsDialog from "~/components/AccountSettingsDialog.vue";
import AppUpdateDialog from "~/components/AppUpdateDialog.vue";
import LibrarySearchInput from "~/components/LibrarySearchInput.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { NuxtLink } from "#components";
import { useRoute } from "#app";
import { ArrowUpCircle, Download, Menu, Plus, Search, X } from "@lucide/vue";
import { onClickOutside, useDocumentVisibility, useMediaQuery } from "@vueuse/core";
import { storeToRefs } from "pinia";
import PlaylistEditorDialog from "~/components/PlaylistEditorDialog.vue";
import { usePlaylistQuery } from "~/composables/useLibraryQueries";
import { attachDrawerGesture } from "~/utils/drawer-gesture";

defineOptions({ name: "LibraryLayout" });

const isDev = import.meta.dev;
const app = useAppStore();
const library = useLibraryStore();
const update = useUpdateStore();
const { drawerOpen, offline } = storeToRefs(app);
const { search, term, searchOpen } = storeToRefs(library);
const { account, userId } = storeToRefs(useSessionStore());
usePlaylistQuery();
const route = useRoute();
const desktop = useMediaQuery("(min-width: 48rem)", { ssrWidth: 0 });
const visibility = useDocumentVisibility();
const updateBadgeLabel = computed(() => {
  if (update.downloading) {
    return update.downloadState.percent >= 0 ? `${update.downloadState.percent}%` : "下载中";
  }
  return "新版本";
});
const showMobileSearch = computed(() => route.path === "/");
const mobileSearchExpanded = computed(
  () => showMobileSearch.value && (searchOpen.value || Boolean(search.value || term.value)),
);
const profile = useTemplateRef("profile");
const playlistEditor = useTemplateRef("playlistEditor");
const updateDialog = useTemplateRef("updateDialog");
const drawerTrigger = useTemplateRef<HTMLButtonElement>("drawerTrigger");
const drawerClose = useTemplateRef<HTMLButtonElement>("drawerClose");
const searchTrigger = useTemplateRef<HTMLButtonElement>("searchTrigger");
const mobileSearchContainer = useTemplateRef<HTMLDivElement>("mobileSearchContainer");
const mobileSearchInput = useTemplateRef("mobileSearchInput");
const drawerRoot = useTemplateRef<HTMLDivElement>("drawerRoot");
const drawerSide = useTemplateRef<HTMLDivElement>("drawerSide");
const drawerOverlay = useTemplateRef<HTMLLabelElement>("drawerOverlay");
const drawerAside = useTemplateRef<HTMLElement>("drawerAside");
let drawerGesture: ReturnType<typeof attachDrawerGesture> | undefined;

async function openMobileSearch() {
  searchOpen.value = true;
  await nextTick();
  mobileSearchInput.value?.focus();
}

async function closeMobileSearch(restoreFocus = false) {
  library.closeSearch();
  if (restoreFocus) {
    await nextTick();
    searchTrigger.value?.focus();
  }
}

function handleMobileSearchFocusOut(event: FocusEvent) {
  const next = event.relatedTarget;
  if (next instanceof Node && mobileSearchContainer.value?.contains(next)) {
    return;
  }
  if (!search.value.trim() && !term.value) {
    searchOpen.value = false;
  }
}

onClickOutside(
  mobileSearchContainer,
  () => {
    if (searchOpen.value && !search.value.trim() && !term.value) {
      searchOpen.value = false;
    }
  },
  { ignore: [searchTrigger] },
);

onMounted(() => {
  void update.init();
  if (!drawerRoot.value || !drawerSide.value || !drawerOverlay.value || !drawerAside.value) {
    return;
  }
  drawerGesture = attachDrawerGesture({
    root: drawerRoot.value,
    side: drawerSide.value,
    overlay: drawerOverlay.value,
    aside: drawerAside.value,
    isEnabled: () => !desktop.value,
    canOpen: () => offline.value || route.path !== "/songs/new",
    isOpen: () => drawerOpen.value,
    async onCommit(open) {
      if (drawerOpen.value !== open) {
        drawerOpen.value = open;
        await nextTick();
      }
    },
  });
});

onBeforeUnmount(() => {
  drawerGesture?.destroy();
});

watch(desktop, (matches) => {
  if (matches) {
    drawerOpen.value = false;
    searchOpen.value = false;
  }
});
watch(
  () => route.path,
  () => {
    drawerOpen.value = false;
    if (!search.value.trim() && !term.value) {
      searchOpen.value = false;
    }
  },
);
watch(
  [desktop, () => route.path, drawerOpen],
  () => {
    drawerGesture?.reset();
  },
  { flush: "post" },
);
watch(
  drawerOpen,
  (open) => {
    if (open) {
      if (!search.value.trim() && !term.value) {
        searchOpen.value = false;
      }
      drawerClose.value?.focus();
    } else if (!mobileSearchExpanded.value) {
      drawerTrigger.value?.focus();
    }
  },
  { flush: "post" },
);
watch(visibility, (state) => {
  if (state === "visible") {
    void update.checkForUpdate();
  }
});
watch(userId, () => profile.value?.close(), { flush: "sync" });
</script>

<template>
  <div
    ref="drawerRoot"
    class="drawer app-height mx-auto max-w-[100rem] grid-rows-[minmax(0,1fr)] md:drawer-open"
  >
    <input
      id="music-drawer"
      v-model="drawerOpen"
      type="checkbox"
      class="drawer-toggle"
      tabindex="-1"
      aria-hidden="true"
    />
    <div class="drawer-content flex min-h-0 flex-col" :inert="drawerOpen">
      <header
        v-if="offline || route.path !== '/songs/new'"
        class="relative flex shrink-0 items-center px-3 py-2 md:hidden"
      >
        <div
          class="flex min-w-0 flex-1 items-center gap-2 transition-opacity duration-150"
          :class="mobileSearchExpanded ? 'pointer-events-none opacity-0' : 'opacity-100 delay-75'"
          :inert="mobileSearchExpanded"
          :aria-hidden="mobileSearchExpanded || undefined"
        >
          <button
            ref="drawerTrigger"
            type="button"
            class="btn btn-ghost btn-square"
            aria-label="打开导航菜单"
            aria-controls="music-sidebar"
            :aria-expanded="drawerOpen"
            @click="drawerOpen = true"
          >
            <Menu class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          </button>
          <span class="text-xl font-bold tracking-tight">
            inYue <small v-if="isDev" class="text-xs font-medium text-base-content/65">dev</small>
          </span>
          <button
            v-if="update.hasUpdate"
            type="button"
            class="badge badge-primary badge-soft badge-sm shrink-0 cursor-pointer gap-1 border border-primary/25 font-medium hover:bg-primary/20"
            :aria-label="`发现新版本 v${update.latestRelease?.version}，查看更新详情`"
            aria-haspopup="dialog"
            @click="updateDialog?.open()"
          >
            <Download
              v-if="update.downloading"
              class="size-3 shrink-0 animate-pulse"
              :stroke-width="2"
              aria-hidden="true"
            />
            <ArrowUpCircle v-else class="size-3 shrink-0" :stroke-width="2" aria-hidden="true" />
            <span class="tabular-nums">{{ updateBadgeLabel }}</span>
          </button>
          <span
            role="status"
            :class="offline ? 'badge badge-warning badge-sm shrink-0 font-semibold' : 'sr-only'"
            >{{ offline ? "离线" : "" }}</span
          >
          <button
            v-if="showMobileSearch"
            ref="searchTrigger"
            type="button"
            class="btn btn-ghost btn-circle ml-auto shrink-0"
            aria-label="搜索歌曲"
            aria-controls="mobile-library-search"
            :aria-expanded="mobileSearchExpanded"
            @click="openMobileSearch"
          >
            <Search class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </div>
        <div
          v-if="showMobileSearch"
          id="mobile-library-search"
          ref="mobileSearchContainer"
          class="absolute inset-x-2 inset-y-1 flex items-center p-1"
          :class="
            mobileSearchExpanded
              ? 'pointer-events-auto opacity-100 [clip-path:inset(0rem_0rem_0rem_0rem_round_9999px)] [transition:clip-path_240ms_cubic-bezier(0.22,1,0.36,1),opacity_120ms_ease-out]'
              : 'pointer-events-none opacity-0 [clip-path:inset(0.25rem_0.25rem_0.25rem_calc(100%_-_2.75rem)_round_9999px)] [transition:clip-path_200ms_cubic-bezier(0.4,0,0.2,1),opacity_100ms_ease-in_100ms]'
          "
          :inert="!mobileSearchExpanded"
          :aria-hidden="!mobileSearchExpanded || undefined"
          @focusout="handleMobileSearchFocusOut"
        >
          <LibrarySearchInput ref="mobileSearchInput" closable @close="closeMobileSearch(true)" />
        </div>
      </header>
      <main class="flex min-h-0 flex-1 flex-col">
        <slot />
      </main>
    </div>
    <div
      ref="drawerSide"
      class="drawer-side motion-safe:transition-opacity md:h-full"
      :inert="!desktop && !drawerOpen"
    >
      <label
        ref="drawerOverlay"
        for="music-drawer"
        class="drawer-overlay md:hidden"
        aria-hidden="true"
      />
      <aside
        id="music-sidebar"
        ref="drawerAside"
        class="flex h-full w-[min(18rem,85vw)] flex-col border-r border-base-300 bg-base-200 max-md:pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] max-md:pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] max-md:pl-[var(--safe-area-inset-left,env(safe-area-inset-left))] md:w-56 lg:w-64"
        :role="drawerOpen ? 'dialog' : undefined"
        :aria-modal="drawerOpen ? true : undefined"
        aria-label="应用导航"
        @keydown.esc="drawerOpen = false"
      >
        <div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <div class="flex min-w-0 items-center gap-2">
            <NuxtLink
              to="/"
              class="flex min-h-10 items-center gap-2.5 rounded-field"
              aria-label="inYue 曲库"
              @click="drawerOpen = false"
            >
              <img src="/assets/icon/inyue.svg" width="36" height="36" class="shrink-0" alt="" />
              <span class="text-xl font-bold tracking-tight">
                inYue
                <small v-if="isDev" class="text-xs font-medium text-base-content/65">dev</small>
              </span>
            </NuxtLink>
            <button
              v-if="update.hasUpdate"
              type="button"
              class="badge badge-primary badge-soft badge-sm shrink-0 cursor-pointer gap-1 border border-primary/25 font-medium hover:bg-primary/20"
              :aria-label="`发现新版本 v${update.latestRelease?.version}，查看更新详情`"
              aria-haspopup="dialog"
              @click="
                drawerOpen = false;
                updateDialog?.open();
              "
            >
              <Download
                v-if="update.downloading"
                class="size-3 shrink-0 animate-pulse"
                :stroke-width="2"
                aria-hidden="true"
              />
              <ArrowUpCircle v-else class="size-3 shrink-0" :stroke-width="2" aria-hidden="true" />
              <span class="tabular-nums">{{ updateBadgeLabel }}</span>
            </button>
          </div>
          <span
            role="status"
            :class="offline ? 'badge badge-warning badge-sm shrink-0 font-semibold' : 'sr-only'"
            >{{ offline ? "离线" : "" }}</span
          >
          <button
            ref="drawerClose"
            type="button"
            class="btn btn-ghost btn-square md:hidden"
            aria-label="关闭导航菜单"
            @click="drawerOpen = false"
          >
            <X class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="曲库" class="flex min-h-0 flex-1 flex-col gap-2">
          <NuxtLink
            v-if="!offline"
            to="/songs/new"
            class="btn btn-ghost mx-3 shrink-0 justify-start gap-3 px-3 font-medium"
            active-class="bg-primary/10 text-primary"
            @click="drawerOpen = false"
          >
            <Plus class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" /> 新增歌曲
          </NuxtLink>
          <PlaylistNavigation @edit="playlistEditor?.open($event)" />
        </nav>
        <div v-if="account" class="mt-auto shrink-0 border-t border-base-300 p-2">
          <button
            type="button"
            class="btn btn-ghost h-auto min-h-11 w-full justify-start gap-3 px-2 py-1.5 text-left"
            aria-label="个人设置"
            aria-haspopup="dialog"
            @click="profile?.open()"
          >
            <AccountAvatar :image="account.image" :name="account.name" class="size-9" />
            <span class="min-w-0 truncate">{{ account.name }}</span>
          </button>
        </div>
      </aside>
    </div>
    <PlaylistEditorDialog :key="userId" ref="playlistEditor" />
    <AccountSettingsDialog v-if="account" ref="profile" :account="account" />
    <AppUpdateDialog ref="updateDialog" />
  </div>
</template>
