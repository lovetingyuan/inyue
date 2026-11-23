import type { AppThemeColor, ThemeColorPreset } from "~/types/theme";

export const defaultThemeColor: AppThemeColor = "emerald";

export const themeColorPresets: readonly ThemeColorPreset[] = [
  { id: "emerald", label: "翠绿" },
  { id: "teal", label: "湖青" },
  { id: "blue", label: "晴蓝" },
  { id: "violet", label: "靛紫" },
  { id: "rose", label: "玫红" },
  { id: "coral", label: "珊瑚" },
  { id: "amber", label: "琥珀" },
];

const themeColorIds = new Set<string>(themeColorPresets.map(({ id }) => id));

export function isAppThemeColor(value: string): value is AppThemeColor {
  return themeColorIds.has(value);
}
