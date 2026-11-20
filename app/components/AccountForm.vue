<script setup lang="ts">
import { useSessionStore } from "~/stores/session";
import { useAppStore } from "~/stores/app";
import { useAccountActions } from "~/composables/useAccountActions";
import { computed, reactive, ref, shallowRef, toRefs, useTemplateRef } from "vue";
import type { AccountFormMode } from "~/types/account";
import { googleLoginError, libraryReturnPath } from "~/utils/account-navigation";

defineOptions({ name: "AccountForm" });
const props = defineProps<{
  mode: AccountFormMode;
  token?: string;
  initialEmail?: string;
  initialNotice?: string;
  initialError?: string;
  googleClientId?: string | null;
  redirect?: string;
}>();
const emit = defineEmits<{ success: [email: string] }>();

const execute = useAccountActions();
const session = useSessionStore();
const app = useAppStore();
const { mode } = toRefs(props);
const email = ref(props.initialEmail ?? "");
const name = ref("");
const password = ref("");
const notice = ref(props.initialNotice ?? "");
const error = ref(props.initialError ?? "");
const accountFields = reactive({ name: "", email: "", password: "" });
const credentialsInvalid = ref(false);
const emailInput = useTemplateRef<HTMLInputElement>("emailInput");
const activeAction = shallowRef<(() => Promise<void>)>();
const busy = computed(() => Boolean(activeAction.value));
const invalidToken = ref(false);
const invalidReset = computed(() => mode.value === "reset" && (!props.token || invalidToken.value));

function clearCredentialsError() {
  if (!credentialsInvalid.value) {
    return;
  }
  credentialsInvalid.value = false;
  accountFields.password = "";
}

function clearAccountFields() {
  accountFields.name = "";
  accountFields.email = "";
  accountFields.password = "";
  credentialsInvalid.value = false;
}

function validateEmail() {
  accountFields.email = !email.value
    ? "请填写邮箱。"
    : emailInput.value?.validity.typeMismatch
      ? "请输入有效的邮箱地址。"
      : "";
  return !accountFields.email;
}

async function run(action: () => Promise<void>) {
  if (busy.value) {
    return;
  }
  activeAction.value = action;
  notice.value = "";
  error.value = "";
  clearAccountFields();
  try {
    await action();
  } catch (cause) {
    const data =
      typeof cause === "object" && cause !== null && "data" in cause ? cause.data : undefined;
    const code =
      typeof data === "object" && data !== null && "code" in data ? data.code : undefined;
    if (action === google) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "USER_CANCELLED"
      ) {
        return;
      }
      error.value = googleLoginError(code);
      return;
    }
    if (action === submit || action === resend) {
      switch (code) {
        case "INVALID_EMAIL":
          accountFields.email = "请输入有效的邮箱地址。";
          return;
        case "EMAIL_NOT_VERIFIED":
          accountFields.email = "请先验证邮箱。";
          return;
        case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
          accountFields.email = "该邮箱已注册。";
          return;
        case "INVALID_EMAIL_OR_PASSWORD":
          credentialsInvalid.value = true;
          accountFields.password = "邮箱或密码错误。";
          return;
        case "PASSWORD_TOO_SHORT":
          accountFields.password = "密码至少需要 8 个字符。";
          return;
        case "PASSWORD_TOO_LONG":
          accountFields.password = "密码最多允许 128 个字符。";
          return;
        case "INVALID_TOKEN":
          invalidToken.value = true;
          return;
      }
    }
    error.value = "操作失败，请检查网络和输入后重试。";
  } finally {
    activeAction.value = undefined;
  }
}

async function submit() {
  if (mode.value !== "reset") {
    validateEmail();
  }
  if (mode.value === "register" && !name.value) {
    accountFields.name = "请填写昵称。";
  }
  if (mode.value !== "forgot") {
    if (!password.value) {
      accountFields.password = "请填写密码。";
    } else if (password.value.length < 8) {
      accountFields.password = "密码至少需要 8 个字符。";
    } else if (mode.value !== "login" && password.value.length > 128) {
      accountFields.password = "密码最多允许 128 个字符。";
    }
  }
  if (accountFields.name || accountFields.email || accountFields.password) {
    return;
  }
  const submittedPassword = password.value;
  password.value = "";
  if (mode.value === "register") {
    await execute({
      type: "register",
      name: name.value,
      email: email.value,
      password: submittedPassword,
    });
    emit("success", email.value);
  } else if (mode.value === "forgot") {
    await execute({ type: "forgot", email: email.value });
    notice.value = "如果该邮箱已注册，请查收重置邮件。";
  } else if (mode.value === "reset") {
    if (!props.token) {
      return;
    }
    await execute({ type: "reset", token: props.token, password: submittedPassword });
    emit("success", "");
  } else {
    await execute({ type: "login", email: email.value, password: submittedPassword });
    await session.refreshAccount(true);
  }
}

async function resend() {
  if (!validateEmail()) {
    return;
  }
  await execute({ type: "resend", email: email.value });
  notice.value = "请查收验证邮件。";
}

async function google() {
  if (!props.googleClientId) {
    return;
  }
  const callbackURL = libraryReturnPath(props.redirect) ?? "/";
  const errorCallbackURL =
    callbackURL === "/"
      ? "/login?google=failed"
      : `/login?${new URLSearchParams({ google: "failed", redirect: callbackURL })}`;
  await execute({ type: "google", clientId: props.googleClientId, callbackURL, errorCallbackURL });
  if (app.native) {
    await session.refreshAccount(true);
  }
}
</script>

<template>
  <p v-if="invalidReset" class="alert alert-error" role="alert">
    重置链接无效或已过期，请重新发送重置邮件。
  </p>
  <form v-if="!invalidReset" class="grid gap-3" novalidate @submit.prevent="run(submit)">
    <div v-if="mode === 'register'" class="grid gap-1.5 text-sm">
      <label for="account-name" class="font-medium">昵称</label>
      <input
        id="account-name"
        v-model.trim="name"
        class="input validator w-full"
        autocomplete="nickname"
        required
        :disabled="busy"
        :aria-invalid="!!accountFields.name"
        :aria-describedby="accountFields.name ? 'account-name-error' : undefined"
        @input="accountFields.name = ''"
      />
      <p v-if="accountFields.name" id="account-name-error" class="validator-hint mt-0" role="alert">
        {{ accountFields.name }}
      </p>
    </div>
    <div v-if="mode !== 'reset'" class="grid gap-1.5 text-sm">
      <label for="account-email" class="font-medium">邮箱</label>
      <input
        id="account-email"
        ref="emailInput"
        v-model.trim="email"
        type="email"
        class="input validator w-full"
        autocomplete="email"
        required
        :disabled="busy"
        :aria-invalid="!!accountFields.email || credentialsInvalid"
        :aria-describedby="
          accountFields.email
            ? 'account-email-error'
            : credentialsInvalid
              ? 'account-password-error'
              : undefined
        "
        @input="
          accountFields.email = '';
          clearCredentialsError();
        "
      />
      <p
        v-if="accountFields.email"
        id="account-email-error"
        class="validator-hint mt-0"
        role="alert"
      >
        {{ accountFields.email }}
      </p>
    </div>
    <div v-if="mode !== 'forgot'" class="grid gap-1.5 text-sm">
      <label for="account-password" class="font-medium">密码</label>
      <input
        id="account-password"
        v-model="password"
        type="password"
        class="input validator w-full"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
        required
        minlength="8"
        :disabled="busy"
        :aria-invalid="!!accountFields.password"
        :aria-describedby="accountFields.password ? 'account-password-error' : undefined"
        @input="
          accountFields.password = '';
          clearCredentialsError();
        "
      />
      <p
        v-if="accountFields.password"
        id="account-password-error"
        class="validator-hint mt-0"
        role="alert"
      >
        {{ accountFields.password }}
      </p>
    </div>
    <button
      id="account-submit"
      class="btn btn-primary mt-2"
      :disabled="busy"
      :aria-busy="activeAction === submit"
    >
      <span v-if="activeAction === submit" class="loading loading-spinner loading-xs" aria-hidden="true" />
      {{ { login: "登录", register: "注册", forgot: "发送重置邮件", reset: "保存密码" }[mode] }}
    </button>
  </form>
  <div class="flex flex-wrap gap-1">
    <slot :busy="busy" :invalid-reset="invalidReset" />
    <button
      v-if="mode === 'login'"
      class="btn btn-ghost btn-sm"
      type="button"
      :disabled="busy"
      :aria-busy="activeAction === resend"
      @click="run(resend)"
    >
      <span v-if="activeAction === resend" class="loading loading-spinner loading-xs" aria-hidden="true" />
      重发验证邮件
    </button>
  </div>
  <button
    v-if="mode === 'login' && googleClientId"
    class="btn btn-outline w-full"
    type="button"
    :disabled="busy"
    :aria-busy="activeAction === google"
    @click="run(google)"
  >
    <span v-if="activeAction === google" class="loading loading-spinner loading-xs" aria-hidden="true" />
    <img v-else
      src="/assets/icon/google-g.png"
      width="18"
      height="18"
      class="box-content shrink-0 rounded-sm bg-google-icon-background object-contain p-0.5"
      alt=""
    />
    Google 登录
  </button>
  <p v-if="notice" class="alert alert-info" role="status">{{ notice }}</p>
  <p v-if="error" class="alert alert-error" role="alert">{{ error }}</p>
</template>
