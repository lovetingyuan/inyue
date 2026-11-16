import { defineServerAuth } from "@nuxtjs/better-auth/config";
import { bearer } from "better-auth/plugins";
import { sendAccountMail } from "./utils/account-mail";
import { getGoogleCredentials } from "./utils/google-auth";
import { devOrigin } from "~~/shared/dev-server.mjs";

export default defineServerAuth(() => {
  const config = useRuntimeConfig();
  const google = getGoogleCredentials(config);

  return {
    trustedOrigins: import.meta.dev
      ? [config.public.androidOrigin, devOrigin]
      : [config.public.androidOrigin],
    plugins: [bearer({ requireSignature: true })],
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    account: { encryptOAuthTokens: true },
    rateLimit: { enabled: true, storage: "database" },
    onAPIError: { errorURL: "/?google=failed" },
    socialProviders: google
      ? {
          google: {
            ...google,
            // Keep the OAuth state cookie on the same loopback host as the login page.
            redirectURI: import.meta.dev ? `${devOrigin}/api/auth/callback/google` : undefined,
            includeGrantedScopes: false,
            requireEmailVerification: true,
            mapProfileToUser: (profile) => ({
              // Google is authoritative for Gmail and Workspace addresses.
              emailVerified:
                profile.email_verified === true &&
                (Boolean(profile.hd) || profile.email?.toLowerCase().endsWith("@gmail.com")),
            }),
          },
        }
      : {},
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => sendAccountMail(user.email, "重置密码", url),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: ({ user, url }) => sendAccountMail(user.email, "验证邮箱", url),
    },
  };
});
