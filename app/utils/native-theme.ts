import { Capacitor, registerPlugin } from "@capacitor/core";
import type { AppTheme, NativeThemePlugin } from "~/types/native-theme";

const nativeTheme = registerPlugin<NativeThemePlugin>("NativeTheme");

export async function syncNativeTheme(theme: AppTheme) {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("NativeTheme")) {
    return;
  }
  await nativeTheme.setTheme({ theme });
}
