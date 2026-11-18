<script setup lang="ts">
import { useAppStore } from "~/stores/app";
import SongEditor from "~/components/SongEditor.vue";
import { onBeforeRouteLeave } from "vue-router";
import { useTemplateRef } from "vue";
import { useHead, useRouter } from "#app";
import { ArrowLeft } from "@lucide/vue";
defineOptions({ name: "NewSong" });

const router = useRouter();
const app = useAppStore();
const editor = useTemplateRef("editor");
useHead({ title: "新增歌曲 · inYue" });

function leave() {
  if (window.history.state?.back) {
    router.back();
  } else {
    void router.replace("/");
  }
}

onBeforeRouteLeave(() => !editor.value?.busy);
</script>

<template>
  <section
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-8 sm:py-6"
    aria-labelledby="new-song-title"
  >
    <div class="mx-auto max-w-2xl">
      <header class="mb-4 flex items-center justify-between gap-3">
        <button type="button" class="btn btn-ghost -ml-3" :disabled="editor?.busy" @click="leave">
          <ArrowLeft class="size-5 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          返回曲库
        </button>
        <h1 id="new-song-title" class="text-base font-semibold">新增歌曲</h1>
      </header>
      <SongEditor v-show="!app.offline" ref="editor" @cancel="leave" @saved="leave" />
    </div>
  </section>
</template>
