export type AppToastTone = "info" | "success" | "warning" | "error";

export interface AppToastMessage {
  id: number;
  message: string;
  tone: AppToastTone;
  offline: boolean;
}
