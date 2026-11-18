<script setup lang="ts">
import { useSessionStore } from "~/stores/session";
import { useAppStore } from "~/stores/app";
import MusicArtwork from "~/components/MusicArtwork.vue";
import { NuxtLink } from "#components";
defineOptions({ name: "AccountLayout" });

const app = useAppStore();
const session = useSessionStore();
</script>

<template>
  <main
    class="app-height grid overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(26rem,0.8fr)]"
    :class="{ 'select-none': app.native }"
  >
    <div
      class="hidden place-items-center overflow-hidden bg-neutral p-10 text-neutral-content md:grid"
      aria-hidden="true"
    >
      <MusicArtwork class="w-full max-w-md rotate-[-8deg] shadow-2xl" />
    </div>
    <div class="grid content-center justify-items-center px-5 py-8">
      <div class="card w-full max-w-sm">
        <div class="card-body gap-4 p-2 sm:p-4">
          <header class="mb-4 flex items-center gap-3">
            <img src="/assets/icon/inyue.svg" width="44" height="44" class="shrink-0" alt="" />
            <h1 class="text-3xl font-bold tracking-tight">inYue</h1>
          </header>
          <p v-if="app.offline" role="status">
            {{ session.account ? "当前离线。" : "当前离线，请联网登录。" }}
          </p>
          <NuxtLink v-if="app.offline && session.account" to="/" class="btn btn-primary"
            >打开离线曲库</NuxtLink
          >
          <div v-show="!app.offline" class="grid gap-4">
            <slot />
            <p v-if="session.accountError" class="alert alert-error" role="alert">
              {{ session.accountError }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
