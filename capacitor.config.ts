import type { CapacitorConfig } from "@capacitor/cli";
import { androidDevUserAgent, devOrigin } from "./shared/dev-server.mjs";

export default {
  appId: "com.tingyuan.inyue",
  appName: "inYue",
  webDir: ".output-capacitor/public",
  ...(process.env.INYUE_ANDROID_DEV === "1"
    ? { server: { url: devOrigin }, android: { appendUserAgent: androidDevUserAgent } }
    : {}),
  loggingBehavior: "none",
  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
    SplashScreen: {
      launchAutoHide: false,
    },
  },
} satisfies CapacitorConfig;
