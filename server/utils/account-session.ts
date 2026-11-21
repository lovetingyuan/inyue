import { requireUserSession as requireAuthSession } from "#better-auth-session";
import { getClient, setUser } from "@sentry/cloudflare";

export async function requireAccountSession(...args: Parameters<typeof requireAuthSession>) {
  const auth = await requireAuthSession(...args);
  if (getClient()) {
    const { id, name, email } = auth.user;
    setUser({ id, username: name, email });
  }
  return auth;
}
