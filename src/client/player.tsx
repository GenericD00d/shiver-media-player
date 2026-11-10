import { createCallAction, useCanUseAction, usePush } from "@sharkord/plugin-sdk/client";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@sharkord/ui";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { TPlayerState, TSharkord } from "../contract";

const callAction = createCallAction<TSharkord>();

const IDLE: TPlayerState = {
  status: "idle",
  url: null,
  title: null,
  thumbnailUrl: null,
  durationSec: null,
  positionSec: 0,
  startedByUserId: null,
};

const formatTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");

  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** Server state plus the moment it arrived, so the clock ticks locally without trusting client clocks. */
const usePlayer = (channelId: number) => {
  const [state, setState] = useState({ player: IDLE, at: Date.now() });
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canControl = useCanUseAction<TSharkord>("play");

  const receive = (player: TPlayerState) => setState({ player, at: Date.now() });

  usePush<TSharkord>((data) => {
    if (data.channelId === channelId) receive(data.state);
  });

  useEffect(() => {
    let cancelled = false;

    callAction("getState")
      .then((p) => !cancelled && receive(p))
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const playing = state.player.status === "playing";

  useEffect(() => {
    if (!playing) return;

    const id = window.setInterval(() => setNow(Date.now()), 500);

    return () => window.clearInterval(id);
  }, [playing]);

  const { player } = state;
  const elapsed = player.positionSec + (playing ? (Math.max(now, state.at) - state.at) / 1000 : 0);
  const position = player.durationSec ? Math.min(elapsed, player.durationSec) : elapsed;

  const act = async (call: () => Promise<TPlayerState>) => {
    setBusy(true);
    setError("");

    try {
      receive(await call());
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return { player, position, error, busy, canControl, act };
};

const S: Record<string, CSSProperties> = {
  panel: { width: 360, display: "flex", flexDirection: "column", gap: 12, fontSize: 13 },
  row: { display: "flex", gap: 8, alignItems: "center" },
  now: { display: "grid", gridTemplateColumns: "96px 1fr", gap: 12, alignItems: "center" },
  thumb: {
    width: 96,
    height: 54,
    borderRadius: "var(--radius)",
    objectFit: "cover",
    background: "var(--muted)",
  },
  label: { fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted-foreground)" },
  title: { fontWeight: 600, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },
  times: { display: "flex", justifyContent: "space-between", color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" },
  seek: { width: "100%", accentColor: "var(--primary)" },
  error: { color: "var(--destructive)" },
  muted: { color: "var(--muted-foreground)" },
};

const ScreenIcon = ({ active }: { active: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="2" y="4" width="20" height="14" rx="2" />
    <path d="M8 21h8" />
    <path d="M10 8.5v5l4.5-2.5z" fill={active ? "currentColor" : "none"} />
  </svg>
);

const PlayerPanel = ({ channelId }: { channelId: number }) => {
  const { player, position, error, busy, canControl, act } = usePlayer(channelId);
  const [url, setUrl] = useState("");
  // held while dragging, so pushes do not yank the handle out from under the pointer
  const [seekDraft, setSeekDraft] = useState<number | null>(null);

  const active = player.status !== "idle";
  const live = active && player.durationSec === null;
  const locked = busy || !canControl;

  const submit = () => {
    if (!url.trim() || locked) return;

    act(() => callAction("play", { url: url.trim() }));
    setUrl("");
  };

  const seekTo = (sec: number) => act(() => callAction("seek", { positionSec: sec }));

  const commitSeek = () => {
    if (seekDraft !== null) seekTo(seekDraft);

    setSeekDraft(null);
  };

  return (
    <div style={S.panel}>
      <form
        style={S.row}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          value={url}
          placeholder="Paste a video link (YouTube, Dailymotion, .mp4...)"
          aria-label="Video link"
          disabled={!canControl}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button type="submit" disabled={locked || !url.trim()}>
          {active ? "Replace" : "Play"}
        </Button>
      </form>

      {active ? (
        <>
          <div style={S.now}>
            {player.thumbnailUrl ? <img src={player.thumbnailUrl} alt="" style={S.thumb} /> : <div style={S.thumb} />}
            <div>
              <div style={S.label}>
                {player.status === "loading" ? "Loading..." : player.status === "paused" ? "Paused" : live ? "Live" : "Now playing"}
              </div>
              <div style={S.title} title={player.title ?? player.url ?? ""}>
                {player.title ?? player.url}
              </div>
            </div>
          </div>

          {live ? null : (
            <div>
              <input
                type="range"
                style={S.seek}
                min={0}
                max={player.durationSec ?? 0}
                step={1}
                value={seekDraft ?? position}
                disabled={locked}
                aria-label="Seek"
                onChange={(e) => setSeekDraft(Number(e.target.value))}
                onPointerUp={commitSeek}
                onKeyUp={commitSeek}
              />
              <div style={S.times}>
                <span>{formatTime(seekDraft ?? position)}</span>
                <span>{formatTime(player.durationSec ?? 0)}</span>
              </div>
            </div>
          )}

          <div style={{ ...S.row, justifyContent: "center" }}>
            {live ? null : (
              <Button variant="ghost" disabled={locked} onClick={() => seekTo(position - 10)}>
                -10s
              </Button>
            )}
            {player.status === "paused" ? (
              <Button disabled={locked} onClick={() => act(() => callAction("resume"))}>
                Play
              </Button>
            ) : (
              <Button disabled={locked || player.status === "loading"} onClick={() => act(() => callAction("pause"))}>
                Pause
              </Button>
            )}
            {live ? null : (
              <Button variant="ghost" disabled={locked} onClick={() => seekTo(position + 10)}>
                +10s
              </Button>
            )}
            <Button variant="destructive" disabled={locked} onClick={() => act(() => callAction("stop"))}>
              Stop
            </Button>
          </div>
        </>
      ) : (
        <div style={S.muted}>Nothing is playing. Paste a link to watch it with everyone in this voice channel.</div>
      )}

      {!canControl ? <div style={S.muted}>You can watch, but not control playback.</div> : null}
      {error ? <div style={S.error}>{error}</div> : null}
    </div>
  );
};

const PlayerButton = ({ channelId }: { channelId: number }) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Watch together" title="Watch together">
          <ScreenIcon active={open} />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" style={{ width: "auto" }}>
        {/* mounted only while open: the panel's push listener and ticker cost nothing when closed */}
        <PlayerPanel channelId={channelId} />
      </PopoverContent>
    </Popover>
  );
};

export { PlayerButton };
