import { useRuntimeConfig } from "nitropack/runtime";
import { defineEventHandler } from "h3";
import { getGoogleCredentials } from "../utils/google-auth";

export default defineEventHandler((event) => ({
  googleClientId: getGoogleCredentials(useRuntimeConfig(event))?.clientId ?? null,
}));
