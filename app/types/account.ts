export type AccountFormMode = "login" | "register" | "forgot" | "reset";

export type AccountAction =
  | { type: "login"; email: string; password: string }
  | { type: "logout" }
  | { type: "google"; clientId: string; callbackURL: string; errorCallbackURL: string }
  | { type: "register"; name: string; email: string; password: string }
  | { type: "forgot" | "resend"; email: string }
  | { type: "reset"; token: string; password: string };
