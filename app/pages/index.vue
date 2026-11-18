<script setup lang="ts">
import MusicLibrary from "~/components/MusicLibrary.vue";
import { definePageMeta } from "#imports";
import { NuxtPage } from "#components";
defineOptions({ name: "Index" });
definePageMeta({ layout: "library" });
</script>

<template>
  <MusicLibrary>
    <NuxtPage />
  </MusicLibrary>
</template>
