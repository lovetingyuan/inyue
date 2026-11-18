<script setup lang="ts">
import { useSessionStore } from "~/stores/session";
import { useAppStore } from "~/stores/app";
import PlaylistNavigation from "~/components/PlaylistNavigation.vue";
import AccountSettingsDialog from "~/components/AccountSettingsDialog.vue";
import { useTemplateRef, watch } from "vue";
import { NuxtLink } from "#components";
import { useRoute } from "#app";
import { Menu, Plus, X } from "@lucide/vue";
import { useMediaQuery } from "@vueuse/core";
import { storeToRefs } from "pinia";
import PlaylistEditorDialog from "~/components/PlaylistEditorDialog.vue";
import { usePlaylistQuery } from "~/composables/useLibraryQueries";

defineOptions({ name: "LibraryLayout" });

const app = useAppStore();
const { drawerOpen, offline } = storeToRefs(app);
const { account, userId } = storeToRefs(useSessionStore());
usePlaylistQuery();
const route = useRoute();
const desktop = useMediaQuery("(min-width: 48rem)", { ssrWidth: 0 });
const profile = useTemplateRef("profile");
const playlistEditor = useTemplateRef("playlistEditor");
const drawerTrigger = useTemplateRef<HTMLButtonElement>("drawerTrigger");
const drawerClose = useTemplateRef<HTMLButtonElement>("drawerClose");

watch(desktop, (matches) => {
  if (matches) {
    drawerOpen.value = false;
  }
});
watch(
  () => route.path,
  () => {
    drawerOpen.value = false;
  },
);
watch(
  drawerOpen,
  (open) => {
    if (open) {
      drawerClose.value?.focus();
    } else {
      drawerTrigger.value?.focus();
    }
  },
  { flush: "post" },
);
watch(userId, () => profile.value?.close(), { flush: "sync" });
</script>

<template>
  <div
    class="drawer app-height mx-auto max-w-[100rem] grid-rows-[minmax(0,1fr)] md:drawer-open"
    :class="{ 'select-none': app.native }"
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
        class="flex shrink-0 items-center gap-2 px-3 py-2 md:hidden"
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
        <span class="text-xl font-bold tracking-tight">inYue</span>
        <span class="text-xs text-base-content/65" role="status">{{ offline ? "离线" : "" }}</span>
      </header>
      <main class="flex min-h-0 flex-1 flex-col">
        <slot />
      </main>
    </div>
    <div
      class="drawer-side motion-safe:transition-opacity md:h-full"
      :inert="!desktop && !drawerOpen"
    >
      <label for="music-drawer" class="drawer-overlay md:hidden" aria-hidden="true" />
      <aside
        id="music-sidebar"
        class="flex h-full w-[min(18rem,85vw)] flex-col border-r border-base-300 bg-base-200 max-md:pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] max-md:pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] max-md:pl-[var(--safe-area-inset-left,env(safe-area-inset-left))] md:w-56 lg:w-64"
        :role="drawerOpen ? 'dialog' : undefined"
        :aria-modal="drawerOpen ? true : undefined"
        aria-label="应用导航"
        @keydown.esc="drawerOpen = false"
      >
        <div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <NuxtLink
            to="/"
            class="flex min-h-10 items-center gap-2.5 rounded-field"
            aria-label="inYue 曲库"
            @click="drawerOpen = false"
          >
            <img src="/assets/icon/inyue.svg" width="36" height="36" class="shrink-0" alt="" />
            <span class="text-xl font-bold tracking-tight">inYue</span>
          </NuxtLink>
          <span class="text-xs text-base-content/65" role="status">{{
            offline ? "离线" : ""
          }}</span>
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
        <nav aria-label="曲库" class="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
          <NuxtLink
            v-if="!offline"
            to="/songs/new"
            class="btn btn-ghost shrink-0 justify-start gap-3 px-3 font-medium"
            active-class="bg-primary/10 text-primary"
            @click="drawerOpen = false"
          >
            <Plus class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" /> 新增歌曲
          </NuxtLink>
          <div
            class="min-h-0 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-base-content/50 scrollbar-track-transparent"
          >
            <PlaylistNavigation @edit="playlistEditor?.open($event)" />
          </div>
        </nav>
        <div v-if="account" class="mt-auto shrink-0 border-t border-base-300 p-2">
          <button
            type="button"
            class="btn btn-ghost h-auto min-h-11 w-full justify-start gap-3 px-2 py-1.5 text-left"
            aria-label="个人设置"
            aria-haspopup="dialog"
            @click="profile?.open()"
          >
            <img
              v-if="account.image"
              :src="account.image"
              alt=""
              referrerpolicy="no-referrer"
              class="size-9 shrink-0 rounded-full object-cover"
            />
            <span
              v-else
              aria-hidden="true"
              class="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
              >{{ account.name.slice(0, 1) }}</span
            >
            <span class="min-w-0 truncate">{{ account.name }}</span>
          </button>
        </div>
      </aside>
    </div>
    <PlaylistEditorDialog :key="userId" ref="playlistEditor" />
    <AccountSettingsDialog v-if="account" ref="profile" :account="account" />
  </div>
</template>
