type TPlayerStatus = "idle" | "loading" | "playing" | "paused";

/** What is on in one voice channel. Every viewer of that channel sees the same one. */
type TPlayerState = {
  status: TPlayerStatus;
  url: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  /** null for live streams, which cannot be seeked */
  durationSec: number | null;
  positionSec: number;
  startedByUserId: number | null;
};

type TSharkord = {
  actions: {
    getState: { payload: void; response: TPlayerState };
    play: { payload: { url: string }; response: TPlayerState };
    pause: { payload: void; response: TPlayerState };
    resume: { payload: void; response: TPlayerState };
    seek: { payload: { positionSec: number }; response: TPlayerState };
    stop: { payload: void; response: TPlayerState };
  };
  commands: {
    "shiver-update-yt-dlp": { args: void; response: string };
  };
  push: { channelId: number; state: TPlayerState };
};

export type { TPlayerState, TPlayerStatus, TSharkord };
