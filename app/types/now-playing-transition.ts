export type NowPlayingTransitionTarget = "none" | "player" | "dialog";

export type NowPlayingTransitionSlot =
  | "panel"
  | "cover"
  | "title"
  | "progress"
  | "elapsed"
  | "duration"
  | "prev"
  | "play"
  | "next";

export interface NowPlayingTransitionState {
  target: NowPlayingTransitionTarget;
  includeCover: boolean;
}
