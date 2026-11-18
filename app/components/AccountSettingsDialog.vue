<script setup lang="ts">
import { ExternalLink } from "@lucide/vue";
import { storeToRefs } from "pinia";
import type { Account } from "~~/shared/types/library";

defineOptions({ name: "AccountSettingsDialog" });
defineProps<{ account: Account }>();

type SettingsTab = "account" | "about";
type LogoutConfirmDialogExpose = { open: () => void };

const tabs: readonly SettingsTab[] = ["account", "about"];
const repositoryUrl = "https://github.com/lovetingyuan/inyue";
const repositoryLabel = "github.com/lovetingyuan/inyue";

const session = useSessionStore();
const { theme, offline, native } = storeToRefs(useAppStore());
const profile = useTemplateRef<HTMLDialogElement>("profile");
const logoutConfirm = useTemplateRef<LogoutConfirmDialogExpose>("logoutConfirm");
const accountTab = useTemplateRef<HTMLButtonElement>("accountTab");
const aboutTab = useTemplateRef<HTMLButtonElement>("aboutTab");
const activeTab = ref<SettingsTab>("account");
const buildInfo = import.meta.client ? window.__INYUE_BUILD_INFO__ : undefined;
const buildLabel = computed(() => {
  const time = buildInfo?.time;
  if (!Number.isFinite(time) || !time) return "未知";
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
  return buildInfo?.hash ? `${formatted} · ${buildInfo.hash}` : formatted;
});

function bytes(size: number) {
  return size >= 1024 ** 3
    ? `${(size / 1024 ** 3).toFixed(2)} GiB`
    : `${(size / 1024 ** 2).toFixed(1)} MiB`;
}

function activateTab(tab: SettingsTab, moveFocus = false) {
  activeTab.value = tab;
  if (moveFocus) {
    void nextTick(() => (tab === "account" ? accountTab.value : aboutTab.value)?.focus());
  }
}

function handleTabKeydown(event: KeyboardEvent, current: SettingsTab) {
  const index = tabs.indexOf(current);
  let next: SettingsTab | undefined;
  if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
  if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
  if (event.key === "Home") next = tabs[0];
  if (event.key === "End") next = tabs.at(-1);
  if (!next) return;
  event.preventDefault();
  activateTab(next, true);
}

defineExpose({
  open: () => {
    activeTab.value = "account";
    showMusicDialog(profile.value);
  },
  close: () => profile.value?.close(),
});
</script>

<template>
  <dialog
    ref="profile"
    class="modal modal-bottom sm:modal-middle"
    aria-labelledby="settings-title"
    @cancel="session.signingOut && $event.preventDefault()"
  >
    <div
      class="modal-box flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col overflow-hidden p-0"
    >
      <h2 id="settings-title" class="sr-only">设置</h2>
      <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div role="tablist" class="tabs tabs-sm tabs-box w-full" aria-label="设置分类">
          <button
            id="account-tab"
            ref="accountTab"
            type="button"
            role="tab"
            class="tab flex-1"
            :class="{ 'tab-active': activeTab === 'account' }"
            :aria-selected="activeTab === 'account'"
            :tabindex="activeTab === 'account' ? 0 : -1"
            aria-controls="account-panel"
            @click="activateTab('account')"
            @keydown="handleTabKeydown($event, 'account')"
          >
            账户
          </button>
          <button
            id="about-tab"
            ref="aboutTab"
            type="button"
            role="tab"
            class="tab flex-1"
            :class="{ 'tab-active': activeTab === 'about' }"
            :aria-selected="activeTab === 'about'"
            :tabindex="activeTab === 'about' ? 0 : -1"
            aria-controls="about-panel"
            @click="activateTab('about')"
            @keydown="handleTabKeydown($event, 'about')"
          >
            关于
          </button>
        </div>

        <section
          v-show="activeTab === 'account'"
          id="account-panel"
          role="tabpanel"
          aria-labelledby="account-tab"
          tabindex="0"
          class="grid gap-4 pt-4"
        >
          <div class="flex items-start gap-3">
            <div v-if="account.image" class="avatar shrink-0">
              <div class="w-10 rounded-full">
                <img :src="account.image" alt="" referrerpolicy="no-referrer" />
              </div>
            </div>
            <span
              v-else
              aria-hidden="true"
              class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
            >
              {{ account.name.slice(0, 1) }}
            </span>
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-lg font-bold">{{ account.name }}</h3>
              <p class="mt-0.5 break-all text-sm text-base-content/70">{{ account.email }}</p>
            </div>
            <button
              type="button"
              class="btn btn-error btn-ghost btn-xs shrink-0 font-normal"
              :disabled="session.signingOut || offline"
              @click="logoutConfirm?.open()"
            >
              退出登录
            </button>
          </div>

          <p v-if="session.logoutError" class="alert alert-error" role="alert">
            {{ session.logoutError }}
          </p>

          <label class="grid gap-1.5 text-sm font-medium"
            >存储用量 {{ bytes(account.storage.usedBytes) }} /
            {{ bytes(account.storage.quotaBytes) }}
            <progress
              class="progress progress-primary w-full"
              :value="account.storage.usedBytes"
              :max="account.storage.quotaBytes"
            />
          </label>

          <label for="theme-select" class="grid gap-1.5 text-sm font-medium">
            主题
            <select id="theme-select" v-model="theme" class="select w-full">
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </section>

        <section
          v-show="activeTab === 'about'"
          id="about-panel"
          role="tabpanel"
          aria-labelledby="about-tab"
          tabindex="0"
          class="pt-4"
        >
          <div class="flex items-center gap-3">
            <img
              src="/assets/icon/inyue.svg"
              width="48"
              height="48"
              class="shrink-0"
              alt=""
            />
            <div>
              <h3 class="text-lg font-bold">inYue</h3>
              <p class="mt-0.5 text-sm text-base-content/70">
                inYue 是一个同时支持 Web 与 Android 的个人音乐听歌应用。
              </p>
            </div>
          </div>

          <dl class="mt-4 overflow-hidden rounded-box border border-base-300 text-sm">
            <div
              class="grid gap-1 border-b border-base-300 p-3 sm:grid-cols-[6rem_minmax(0,1fr)]"
            >
              <dt class="font-medium text-base-content/70">构建</dt>
              <dd class="break-words">{{ buildLabel }}</dd>
            </div>
            <div
              class="grid gap-1 border-b border-base-300 p-3 sm:grid-cols-[6rem_minmax(0,1fr)]"
            >
              <dt class="font-medium text-base-content/70">GitHub</dt>
              <dd class="min-w-0">
                <a
                  :href="repositoryUrl"
                  class="link link-hover inline-flex max-w-full items-center gap-1"
                  :target="native ? undefined : '_blank'"
                  :rel="native ? undefined : 'noopener noreferrer'"
                >
                  <span class="break-all">{{ repositoryLabel }}</span>
                  <ExternalLink class="size-4 shrink-0" :stroke-width="1.8" aria-hidden="true" />
                </a>
              </dd>
            </div>
            <div class="grid gap-1 p-3 sm:grid-cols-[6rem_minmax(0,1fr)]">
              <dt class="font-medium text-base-content/70">版权</dt>
              <dd>© 2026 inYue</dd>
            </div>
          </dl>
        </section>
      </div>

      <footer class="safe-panel border-t border-base-300 p-3 sm:px-5">
        <form method="dialog" class="flex justify-end">
          <button type="submit" class="btn btn-ghost" :disabled="session.signingOut">关闭</button>
        </form>
      </footer>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" :disabled="session.signingOut">关闭账户弹窗</button>
    </form>
  </dialog>
  <LogoutConfirmDialog ref="logoutConfirm" @confirm="session.logout()" />
</template>
