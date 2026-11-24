<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useQueryCache } from "@pinia/colada";
import { AlertTriangle, FolderOpen } from "@lucide/vue";
import { useSessionStore } from "~/stores/session";
import type { NativeOfflineStorageInfo } from "~/types/native-offline-media";
import { libraryKeys } from "~/utils/music-query-keys";

defineOptions({ name: "OfflineCacheSettings" });
const props = defineProps<{ accountId: string }>();

const session = useSessionStore();
const queryCache = useQueryCache();
const info = shallowRef<NativeOfflineStorageInfo>();
const busy = ref(false);
const confirmingClear = ref(false);
const statusText = ref("");
const statusError = ref(false);

const locationLabel = computed(() => {
  if (!info.value || info.value.mode === "private") {
    return "应用私有目录";
  }
  const label = info.value.directoryLabel || "已选目录";
  return info.value.directoryAvailable ? label : `${label}（不可用）`;
});

const pickButtonLabel = computed(() => {
  if (!info.value || info.value.mode === "private") {
    return "选择目录";
  }
  return info.value.directoryAvailable ? "更换" : "重新授权";
});

function formatBytes(size: number) {
  return size >= 1024 ** 3
    ? `${(size / 1024 ** 3).toFixed(2)} GiB`
    : `${(size / 1024 ** 2).toFixed(1)} MiB`;
}

function invalidateCovers() {
  return queryCache.invalidateQueries({
    key: [...libraryKeys.user(props.accountId), "covers"],
  });
}

async function refresh(resetFeedback = false) {
  if (resetFeedback) {
    statusText.value = "";
    statusError.value = false;
    confirmingClear.value = false;
  }
  try {
    const { readNativeOfflineStorageInfo } = await import("~/utils/offline-media");
    info.value = await readNativeOfflineStorageInfo(props.accountId, session.offlineScope);
  } catch {
    // Keep last known storage info if native read fails.
  }
}

async function chooseDirectory() {
  if (busy.value) {
    return;
  }
  busy.value = true;
  confirmingClear.value = false;
  statusText.value = "";
  statusError.value = false;
  try {
    const { pickNativeOfflineDirectory } = await import("~/utils/offline-media");
    const result = await pickNativeOfflineDirectory(props.accountId, session.offlineScope);
    info.value = result;
    if (!result.canceled) {
      await invalidateCovers();
      statusText.value =
        result.migratedCount && result.migratedCount > 0
          ? `已切换目录并迁移 ${result.migratedCount} 首缓存`
          : "已切换缓存目录";
    }
  } catch (error) {
    statusError.value = true;
    statusText.value = error instanceof Error && error.message ? error.message : "目录设置失败";
  } finally {
    busy.value = false;
  }
}

async function resetDirectory() {
  if (busy.value) {
    return;
  }
  busy.value = true;
  confirmingClear.value = false;
  statusText.value = "";
  statusError.value = false;
  try {
    const { resetNativeOfflineDirectory } = await import("~/utils/offline-media");
    info.value = await resetNativeOfflineDirectory(props.accountId, session.offlineScope);
    await invalidateCovers();
    statusText.value = "已恢复默认目录";
  } catch {
    statusError.value = true;
    statusText.value = "恢复默认目录失败";
  } finally {
    busy.value = false;
  }
}

async function clearCache() {
  if (busy.value) {
    return;
  }
  busy.value = true;
  confirmingClear.value = false;
  statusText.value = "";
  statusError.value = false;
  try {
    const { clearNativeOfflineMedia, readNativeOfflineStorageInfo } =
      await import("~/utils/offline-media");
    await clearNativeOfflineMedia(props.accountId, session.offlineScope);
    info.value = await readNativeOfflineStorageInfo(props.accountId, session.offlineScope);
    await invalidateCovers();
    statusText.value = "已清空本地缓存";
  } catch {
    statusError.value = true;
    statusText.value = "清空缓存失败";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void refresh();
});

watch(
  () => props.accountId,
  () => {
    void refresh(true);
  },
);

defineExpose({ refresh });
</script>

<template>
  <div class="grid gap-1.5">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-medium">离线缓存</span>
      <span v-if="info" class="text-xs text-base-content/70 tabular-nums">
        {{ info.audioCount }} 首 · {{ formatBytes(info.totalBytes) }}
      </span>
    </div>

    <div
      class="flex items-center gap-2 rounded-box border border-base-300 bg-base-200/40 px-3 py-2"
    >
      <AlertTriangle
        v-if="info && !info.directoryAvailable"
        class="size-4 shrink-0 text-warning"
        aria-hidden="true"
      />
      <FolderOpen v-else class="size-4 shrink-0 text-base-content/70" aria-hidden="true" />

      <span
        class="min-w-0 flex-1 truncate text-sm"
        :class="{ 'text-warning': info && !info.directoryAvailable }"
        :title="locationLabel"
      >
        {{ locationLabel }}
      </span>

      <div class="flex shrink-0 items-center gap-1">
        <template v-if="confirmingClear">
          <button
            type="button"
            class="btn btn-error btn-xs"
            :disabled="busy || session.signingOut"
            @click="clearCache"
          >
            确认清空
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            :disabled="busy"
            @click="confirmingClear = false"
          >
            取消
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            :disabled="busy || session.signingOut"
            @click="chooseDirectory"
          >
            {{ pickButtonLabel }}
          </button>
          <button
            v-if="info?.mode === 'directory'"
            type="button"
            class="btn btn-ghost btn-xs"
            :disabled="busy || session.signingOut"
            @click="resetDirectory"
          >
            默认
          </button>
          <button
            v-if="info && info.totalBytes > 0"
            type="button"
            class="btn btn-ghost btn-xs text-error"
            :disabled="busy || session.signingOut"
            @click="confirmingClear = true"
          >
            清空
          </button>
        </template>
      </div>
    </div>

    <p
      v-if="statusText"
      role="status"
      class="text-xs"
      :class="statusError ? 'text-error' : 'text-base-content/70'"
    >
      {{ statusText }}
    </p>
  </div>
</template>
