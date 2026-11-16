import type { RuntimeConfig } from "nuxt/schema";

export function getGoogleCredentials(config: RuntimeConfig) {
  const clientId = config.public.googleClientId.trim();
  const clientSecret = config.googleClientSecret.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
