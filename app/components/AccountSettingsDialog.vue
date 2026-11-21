<script setup lang="ts">
import { showMusicDialog } from "~/utils/music-dialog";
import { useSessionStore } from "~/stores/session";
import { useAppStore } from "~/stores/app";
import AccountAvatar from "~/components/AccountAvatar.vue";
import AccountProfileDialog from "~/components/AccountProfileDialog.vue";
import LogoutConfirmDialog from "~/components/LogoutConfirmDialog.vue";
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import { usePreferredDark } from "@vueuse/core";
import { Share2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { appName, officialSiteUrl } from "~~/shared/app-brand";
import type { Account } from "~~/shared/types/library";

defineOptions({ name: "AccountSettingsDialog" });
defineProps<{ account: Account }>();

type SettingsTab = "account" | "about";
type LogoutConfirmDialogExpose = { open: () => void };

const tabs: readonly SettingsTab[] = ["account", "about"];
const repositoryUrl = "https://github.com/lovetingyuan/inyue";

const session = useSessionStore();
const { theme, offline, native } = storeToRefs(useAppStore());
const prefersDark = usePreferredDark();
const githubIcon = computed(() =>
  theme.value === "dark" || (theme.value === "system" && prefersDark.value)
    ? "/assets/icon/github-white.svg"
    : "/assets/icon/github-black.svg",
);
const profile = useTemplateRef<HTMLDialogElement>("profile");
const profileEditor = useTemplateRef("profileEditor");
const logoutConfirm = useTemplateRef<LogoutConfirmDialogExpose>("logoutConfirm");
const accountTab = useTemplateRef<HTMLButtonElement>("accountTab");
const aboutTab = useTemplateRef<HTMLButtonElement>("aboutTab");
const activeTab = ref<SettingsTab>("account");
const sharing = ref(false);
const shareFeedback = ref<"copied" | "manual" | "failed">();
const buildInfo = shallowRef<Window["__INYUE_BUILD_INFO__"]>();
onMounted(() => {
  buildInfo.value = window.__INYUE_BUILD_INFO__;
});
const buildLabel = computed(() => {
  const time = buildInfo.value?.time;
  if (!Number.isFinite(time) || !time) {
    return "未知";
  }
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
  return buildInfo.value?.hash ? `${formatted} · ${buildInfo.value.hash}` : formatted;
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
  if (event.key === "ArrowRight") {
    next = tabs[(index + 1) % tabs.length];
  }
  if (event.key === "ArrowLeft") {
    next = tabs[(index - 1 + tabs.length) % tabs.length];
  }
  if (event.key === "Home") {
    next = tabs[0];
  }
  if (event.key === "End") {
    next = tabs.at(-1);
  }
  if (!next) {
    return;
  }
  event.preventDefault();
  activateTab(next, true);
}

async function shareApp() {
  if (sharing.value) {
    return;
  }

  const data = { title: appName, text: appName, url: officialSiteUrl };
  sharing.value = true;
  shareFeedback.value = undefined;
  try {
    if (native.value) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ ...data, dialogTitle: `分享 ${appName}` });
    } else if (typeof navigator.share === "function" && navigator.canShare?.(data) !== false) {
      await navigator.share(data);
    } else {
      shareFeedback.value = "manual";
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${appName} ${officialSiteUrl}`);
        shareFeedback.value = "copied";
      }
    }
  } catch (error) {
    const canceled =
      (error instanceof DOMException && error.name === "AbortError") ||
      (native.value && error instanceof Error && error.message === "Share canceled");
    if (!canceled && shareFeedback.value !== "manual") {
      shareFeedback.value = "failed";
    }
  } finally {
    sharing.value = false;
  }
}

defineExpose({
  open: () => {
    buildInfo.value ??= window.__INYUE_BUILD_INFO__;
    activeTab.value = "account";
    shareFeedback.value = undefined;
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
    <div class="modal-box flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col overflow-hidden p-0">
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
            <AccountAvatar :image="account.image" :name="account.name" class="size-14" />
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-lg font-bold">{{ account.name }}</h3>
              <p class="mt-0.5 break-all text-sm leading-tight text-base-content/70">
                {{ account.email }}
                <img
                  v-if="account.google"
                  src="/assets/icon/google-g.png"
                  width="16"
                  height="16"
                  class="inline-block size-4 rounded-sm bg-google-icon-background object-contain p-0.5 align-text-bottom"
                  alt="Google 登录"
                  title="Google 登录"
                />
              </p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs shrink-0 font-normal"
              aria-haspopup="dialog"
              :disabled="session.signingOut || offline"
              @click="profileEditor?.open(account)"
            >
              编辑资料
            </button>
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
            <img src="/assets/icon/inyue.svg" width="48" height="48" class="shrink-0" alt="" />
            <div>
              <h3 class="text-lg font-bold">inYue</h3>
              <p class="mt-0.5 text-sm text-base-content/70">inYue, 你的私人音乐园地</p>
            </div>
          </div>

          <dl class="mt-2 text-sm">
            <div class="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2">
              <dt class="font-medium text-base-content/70">构建</dt>
              <dd class="flex items-center justify-between gap-2">
                <span class="min-w-0 break-words">{{ buildLabel }}</span>
                <a
                  :href="repositoryUrl"
                  class="btn btn-ghost btn-square btn-sm shrink-0"
                  :target="native ? undefined : '_blank'"
                  :rel="native ? undefined : 'noopener noreferrer'"
                  aria-label="打开 GitHub 仓库"
                >
                  <img :src="githubIcon" class="size-5 object-contain" alt="" />
                </a>
              </dd>
            </div>
            <div class="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
              <dt class="font-medium text-base-content/70">版权</dt>
              <dd>© 2026 inYue</dd>
            </div>
          </dl>
        </section>
      </div>

      <footer class="safe-panel border-t border-base-300 p-3 sm:px-5">
        <form method="dialog" class="flex items-center justify-between gap-2">
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="sharing || session.signingOut"
            :aria-busy="sharing"
            @click="shareApp"
          >
            <span v-if="sharing" class="loading loading-spinner loading-xs" aria-hidden="true" />
            <Share2 v-else class="size-4" aria-hidden="true" />
            分享 {{ appName }}
          </button>
          <button type="submit" class="btn btn-ghost" :disabled="session.signingOut">关闭</button>
        </form>
        <p role="status" class="text-sm text-base-content/70" :class="{ 'mt-1': shareFeedback }">
          <template v-if="shareFeedback === 'copied'">已复制分享链接</template>
          <template v-else-if="shareFeedback === 'failed'">分享失败，请重试。</template>
          <template v-else-if="shareFeedback === 'manual'">
            手动复制官网链接
            <a class="link select-text" :href="officialSiteUrl">{{ officialSiteUrl }}</a>
          </template>
        </p>
      </footer>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button tabindex="-1" :disabled="session.signingOut">关闭账户弹窗</button>
    </form>
  </dialog>
  <AccountProfileDialog :key="account.id" ref="profileEditor" />
  <LogoutConfirmDialog ref="logoutConfirm" />
</template>
