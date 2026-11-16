import { getGoogleCredentials } from "../utils/google-auth";

export default defineEventHandler((event) => ({
  googleClientId: getGoogleCredentials(useRuntimeConfig(event))?.clientId ?? null,
}));
