<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { Download, ExternalLink, PackageCheck } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { useUpdateStore } from "~/stores/update";
import { showMusicDialog } from "~/utils/music-dialog";

defineOptions({ name: "AppUpdateDialog" });

const update = useUpdateStore();
const { currentVersion, latestRelease, downloadState, downloading, readyToInstall, isAndroidNative } =
  storeToRefs(update);
const dialog = useTemplateRef<HTMLDialogElement>("dialog");

const publishedDate = computed(() => {
  const raw = latestRelease.value?.publishedAt;
  if (!raw) {
    return "";
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(timestamp));
});

const isActiveReleaseState = computed(
  () =>
    Boolean(latestRelease.value) &&
    downloadState.value.status !== "idle" &&
    (!downloadState.value.version ||
      downloadState.value.version === latestRelease.value?.version),
);

const progressValue = computed(() =>
  downloadState.value.percent >= 0 ? downloadState.value.percent : undefined,
);

const downloadStatusLabel = computed(() => {
  const state = downloadState.value;
  if (state.status === "downloading") {
    if (state.totalBytes > 0 && state.percent >= 0) {
      return `正在下载 ${state.percent}% · ${formatBytes(state.downloadedBytes)} / ${formatBytes(state.totalBytes)}`;
    }
    if (state.downloadedBytes > 0) {
      return `正在下载 · 已下载 ${formatBytes(state.downloadedBytes)}`;
    }
    return "正在连接下载服务器…";
  }
  if (state.status === "completed" || state.status === "installing") {
    return "下载完成，正在启动安装程序…";
  }
  if (state.status === "permission_required") {
    return state.message || "请允许「安装未知应用」权限后继续安装。";
  }
  if (state.status === "error") {
    return state.message || "下载失败，请稍后重试。";
  }
  return "";
});

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function close() {
  dialog.value?.close();
}

defineExpose({
  open: () => showMusicDialog(dialog.value),
  close,
});
</script>

<template>
  <dialog
    ref="dialog"
    class="modal modal-bottom sm:modal-middle"
    aria-labelledby="app-update-title"
  >
    <div
      v-if="latestRelease"
      class="modal-box flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-lg"
    >
      <header class="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 px-4 py-3 sm:px-5">
        <div class="flex min-w-0 items-center gap-2">
          <h2 id="app-update-title" class="text-base font-bold tracking-tight">发现新版本</h2>
          <span class="badge badge-primary badge-soft badge-sm font-semibold tabular-nums">
            v{{ latestRelease.version }}
          </span>
        </div>
        <span class="shrink-0 text-xs text-base-content/60 tabular-nums">
          v{{ currentVersion }} → v{{ latestRelease.version }}
        </span>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3.5 sm:px-5">
        <div class="flex items-center justify-between gap-2 text-xs text-base-content/60">
          <span>更新日志</span>
          <span v-if="publishedDate">{{ publishedDate }}</span>
        </div>

        <div v-if="latestRelease.notes.length" class="mt-2.5 space-y-2.5 text-sm leading-relaxed">
          <template v-for="(block, index) in latestRelease.notes" :key="index">
            <h3 v-if="block.type === 'heading'" class="font-semibold text-base-content">
              {{ block.text }}
            </h3>
            <p
              v-else-if="block.type === 'paragraph'"
              class="whitespace-pre-line break-words text-base-content/85"
            >
              {{ block.text }}
            </p>
            <component
              :is="block.ordered ? 'ol' : 'ul'"
              v-else-if="block.type === 'list'"
              class="space-y-1 pl-5 text-base-content/85"
              :class="block.ordered ? 'list-decimal' : 'list-disc'"
            >
              <li
                v-for="(item, itemIndex) in block.items"
                :key="itemIndex"
                class="whitespace-pre-line break-words"
              >
                {{ item }}
              </li>
            </component>
            <pre
              v-else-if="block.type === 'code'"
              class="overflow-x-auto rounded-field bg-base-200 p-2.5 font-mono text-xs text-base-content/90"
            ><code>{{ block.text }}</code></pre>
          </template>
        </div>
        <p v-else class="mt-2.5 text-sm text-base-content/65">暂无更新日志</p>

        <div
          v-if="isActiveReleaseState"
          class="mt-4 space-y-1.5 rounded-box border border-base-300 bg-base-200/50 p-3"
          role="status"
          aria-live="polite"
        >
          <progress
            v-if="downloading"
            class="progress progress-primary w-full"
            :value="progressValue"
            max="100"
          />
          <p
            class="text-xs font-medium tabular-nums"
            :class="{
              'text-error': downloadState.status === 'error',
              'text-warning': downloadState.status === 'permission_required',
              'text-success':
                downloadState.status === 'completed' || downloadState.status === 'installing',
              'text-base-content/80': downloading,
            }"
          >
            {{ downloadStatusLabel }}
          </p>
        </div>
      </div>

      <footer class="safe-panel flex shrink-0 items-center justify-between gap-2 border-t border-base-300 p-3 sm:px-5">
        <button
          v-if="downloading && isAndroidNative"
          type="button"
          class="btn btn-ghost"
          @click="update.cancelUpdate()"
        >
          取消下载
        </button>
        <button v-else type="button" class="btn btn-ghost" @click="close">关闭</button>

        <button
          v-if="downloading"
          type="button"
          class="btn btn-primary btn-soft"
          @click="close"
        >
          后台下载
        </button>
        <button
          v-else-if="readyToInstall"
          type="button"
          class="btn btn-primary"
          @click="update.installUpdate()"
        >
          <PackageCheck class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          {{ downloadState.status === "permission_required" ? "前往授权并安装" : "立即安装" }}
        </button>
        <button
          v-else-if="latestRelease.apkUrl"
          type="button"
          class="btn btn-primary"
          @click="update.downloadUpdate()"
        >
          <Download class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          <span>下载更新</span>
          <span v-if="latestRelease.apkSize" class="text-xs font-normal opacity-80">
            {{ latestRelease.apkSize }}
          </span>
        </button>
        <a
          v-else
          :href="latestRelease.releaseUrl"
          class="btn btn-primary"
          :target="isAndroidNative ? undefined : '_blank'"
          :rel="isAndroidNative ? undefined : 'noopener noreferrer'"
        >
          <ExternalLink class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
          查看发布页
        </a>
      </footer>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1">关闭更新弹窗</button>
    </form>
  </dialog>
</template>
