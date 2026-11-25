export type AppToastTone = "info" | "success" | "warning" | "error";

export interface AppToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface AppToastMessage {
  id: number;
  message: string;
  tone: AppToastTone;
  offline: boolean;
  action?: AppToastAction;
}
