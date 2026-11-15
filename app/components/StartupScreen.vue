<script setup lang="ts">
defineOptions({ name: "StartupScreen" });
</script>

<template>
  <main class="fixed inset-0 grid place-items-center bg-base-100 text-base-content select-none">
    <header class="relative flex items-center gap-3">
      <img id="startup-logo" src="/assets/icon/inyue.svg" width="44" height="44" alt="" />
      <h1 class="text-3xl font-bold tracking-tight">inYue</h1>
      <p
        class="absolute inset-x-0 top-full mt-5 flex justify-center text-base-content/65"
        role="status"
      >
        <span
          class="loading loading-spinner loading-sm motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span class="sr-only">正在检查会话…</span>
      </p>
    </header>
  </main>
</template>
