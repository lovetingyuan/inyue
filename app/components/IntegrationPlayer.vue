<script setup lang="ts">
import { useSessionStore } from "~/stores/session";
import { useMusicApi } from "~/composables/useMusicApi";
import { computed, onBeforeUnmount, ref } from "vue";
import type { PlaylistPlugin, AudioTrack } from "@dwbn/capacitor-plugin-playlist";
import type { PluginListenerHandle } from "@capacitor/core";
import { useQuery } from "@pinia/colada";
import { libraryKeys } from "~/utils/music-query-keys";

const { native, request } = useMusicApi();
const session = useSessionStore();
const tracks = useQuery({
  key: () => [...libraryKeys.user(session.userId), "integration-tracks"],
  enabled: false,
  retry: 0,
  query: async ({ signal }) =>
    (await request<{ id: string; url: string }[]>("/api/integration/tracks", { retry: 1, signal }))
      ._data,
});
const mode = ref<"sequential" | "loop" | "shuffle">("sequential");
const track = ref("");
const position = ref(0);
const status = ref("");
const activeAction = ref<"load" | "play" | "pause" | "seek" | "skip">();
const busy = computed(() => Boolean(activeAction.value));
let player: PlaylistPlugin | undefined;
let listener: PluginListenerHandle | undefined;
let operation: Promise<void> | undefined;
let releaseOperation: Promise<void> | undefined;

async function load() {
  const { data: urls } = await tracks.refetch(true);
  if (releaseOperation) {
    return;
  }
  if (!urls?.length) {
    throw new Error("没有可播放的测试音频。");
  }
  const { Playlist, RmxAudioStatusMessage } = await import("@dwbn/capacitor-plugin-playlist");
  if (!player) {
    await Playlist.initialize();
    player = Playlist;
    listener = await player.addListener("status", ({ status: event }) => {
      if (event.msgType === RmxAudioStatusMessage.RMXSTATUS_ERROR) {
        status.value = "播放失败，请检查网络或重新载入。";
        return;
      }
      if (["1", "2", "3"].includes(event.trackId)) {
        track.value = event.trackId;
      }
      if ("currentPosition" in event.value) {
        position.value = event.value.currentPosition;
      }
    });
  }
  const items: AudioTrack[] = urls.map(({ id, url }) => ({
    trackId: id,
    assetUrl: url,
    title: `测试音频 ${id}`,
    artist: "inYue",
    album: "集成验证",
  }));
  if (mode.value === "shuffle" && Math.random() < 0.5) {
    const second = items[1];
    const third = items[2];
    if (second && third) {
      items[1] = third;
      items[2] = second;
    }
  }
  await player.setLoop({ loop: mode.value === "loop" });
  await player.setPlaylistItems({ items, options: { startPaused: true } });
  status.value = `队列 ${items.map((item) => item.trackId).join(" → ")}`;
  await player.play();
}

function run(name: NonNullable<typeof activeAction.value>, action: () => Promise<void> | undefined) {
  if (busy.value || releaseOperation) {
    return;
  }
  activeAction.value = name;
  operation = Promise.resolve()
    .then(action)
    .catch((error: unknown) => {
      status.value =
        error instanceof Error
          ? error.message.replace(/https?:\/\/[^\s]+/g, "[地址]")
          : "播放操作失败。";
    })
    .finally(() => {
      activeAction.value = undefined;
    });
}

function release() {
  return (releaseOperation ??= Promise.resolve(operation).then(async () => {
    if (!player) {
      return;
    }
    try {
      await listener?.remove();
    } finally {
      await player.release();
    }
    player = undefined;
    track.value = "";
    position.value = 0;
    status.value = "";
  }));
}

onBeforeUnmount(() => {
  void release().catch(() => undefined);
});
defineExpose({ release });
</script>

<template>
  <section v-if="native" class="grid gap-3 border-t border-base-300 pt-4" aria-label="原生播放验证">
    <label class="grid gap-1">
      播放模式
      <select v-model="mode" class="select w-full" :disabled="busy">
        <option value="sequential">顺序播放</option>
        <option value="loop">列表循环</option>
        <option value="shuffle">随机播放</option>
      </select>
    </label>
    <button
      id="play-integration"
      type="button"
      class="btn btn-primary"
      :disabled="busy"
      :aria-busy="activeAction === 'load'"
      @click="run('load', load)"
    >
      <span v-if="activeAction === 'load'" class="loading loading-spinner loading-xs" aria-hidden="true" />
      载入并播放测试音频
    </button>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="btn btn-sm"
        :disabled="!track || busy"
        :aria-busy="activeAction === 'play'"
        @click="run('play', () => player?.play())"
      >
        <span v-if="activeAction === 'play'" class="loading loading-spinner loading-xs" aria-hidden="true" />
        播放
      </button>
      <button
        type="button"
        class="btn btn-sm"
        :disabled="!track || busy"
        :aria-busy="activeAction === 'pause'"
        @click="run('pause', () => player?.pause())"
      >
        <span v-if="activeAction === 'pause'" class="loading loading-spinner loading-xs" aria-hidden="true" />
        暂停
      </button>
      <button
        type="button"
        class="btn btn-sm"
        :disabled="!track || busy"
        :aria-busy="activeAction === 'seek'"
        @click="run('seek', () => player?.seekTo({ position: 8 }))"
      >
        <span v-if="activeAction === 'seek'" class="loading loading-spinner loading-xs" aria-hidden="true" />
        跳到 8 秒
      </button>
      <button
        type="button"
        class="btn btn-sm"
        :disabled="!track || busy"
        :aria-busy="activeAction === 'skip'"
        @click="run('skip', () => player?.skipForward())"
      >
        <span v-if="activeAction === 'skip'" class="loading loading-spinner loading-xs" aria-hidden="true" />
        下一首
      </button>
    </div>
    <p role="status">
      {{ status
      }}<template v-if="track"> · 第 {{ track }} 首 · {{ Math.floor(position) }} 秒</template>
    </p>
  </section>
</template>
