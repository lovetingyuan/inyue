export type AppTheme = "system" | "light" | "dark";

export interface NativeThemePlugin {
  setTheme(options: { theme: AppTheme }): Promise<void>;
}
