import { useState } from "react";
import type { Character, VideoRun, VideoSettings } from "@/lib/types";
import { VOICE_SAMPLE_DEFAULT_SECONDS, VOICE_SAMPLE_MAX_SECONDS, VOICE_SAMPLE_MIN_SECONDS, type VoiceSample } from "@/lib/voice-references";

function sampleUrl(voice: VoiceSample) {
  const query = new URLSearchParams({ filename: voice.filename, subfolder: voice.subfolder, type: "input" });
  return `/api/image/view?${query}`;
}

function runLabel(run: VideoRun, index: number) {
  return `Video ${index + 1} · ${run.durations?.reduce((sum, value) => sum + value, 0) ?? "?"} s · seed ${run.seed}`;
}

// Video tab: one short voice sample per character, sent to H3 so a voice stays the same across segments.
export function VoiceSamples({
  storyId,
  characters,
  videos,
  settings,
  onChange,
  onError,
}: {
  storyId: string;
  characters: Character[];
  videos: VideoRun[];
  settings: VideoSettings;
  onChange: (next: Partial<VideoSettings>) => void;
  onError: (message: string) => void;
}) {
  const finished = videos.filter((run) => run.status === "done" && run.video);
  const [runId, setRunId] = useState("");
  const [starts, setStarts] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState(VOICE_SAMPLE_DEFAULT_SECONDS);
  const [working, setWorking] = useState("");
  const source = finished.find((run) => run.id === runId) ?? finished[0];

  function store(voice: VoiceSample) {
    onChange({ voices: [...settings.voices.filter((item) => item.speaker !== voice.speaker), voice] });
  }

  async function save(speaker: string, init: RequestInit) {
    setWorking(speaker);
    onError("");
    try {
      const response = await fetch("/api/voice-sample", { method: "POST", ...init });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not make the voice sample.");
      store(data.voice as VoiceSample);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not make the voice sample.");
    } finally {
      setWorking("");
    }
  }

  function upload(speaker: string, file: File) {
    const form = new FormData();
    form.append("storyId", storyId);
    form.append("speaker", speaker);
    form.append("seconds", String(seconds));
    form.append("audio", file);
    return save(speaker, { body: form });
  }

  function cut(speaker: string) {
    return save(speaker, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId, speaker, seconds, start: Number(starts[speaker]) || 0, video: source?.video }),
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm text-foreground">
      <label
        className="flex items-center gap-2"
        title="Keeps each character's voice the same across segments. Every segment then starts fresh from the picture, so joins become cuts."
      >
        <input
          type="checkbox"
          checked={settings.voiceRefs}
          onChange={(event) => onChange({ voiceRefs: event.target.checked })}
        />
        Voice references
      </label>
      {settings.voiceRefs && (
        <>
          <p className="text-xs text-muted">
            Same voice in every segment, but each segment starts fresh, so joins become cuts, and some lines may still drop
            out. Use {VOICE_SAMPLE_MIN_SECONDS}–{VOICE_SAMPLE_MAX_SECONDS} s of one person speaking: longer samples leak
            their words into the dialogue.
          </p>
          <div className="flex flex-wrap items-end gap-3 text-xs text-muted">
            {finished.length > 0 && (
              <label className="flex flex-col gap-1">
                Cut from
                <select
                  value={source?.id}
                  onChange={(event) => setRunId(event.target.value)}
                  className="rounded-md border border-line bg-background px-2 py-1 text-foreground"
                >
                  {finished.map((run, index) => (
                    <option key={run.id} value={run.id}>
                      {runLabel(run, index)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              Length (s)
              <input
                type="number"
                min={VOICE_SAMPLE_MIN_SECONDS}
                max={VOICE_SAMPLE_MAX_SECONDS}
                step={0.5}
                value={seconds}
                onChange={(event) => setSeconds(Number(event.target.value))}
                className="w-16 rounded-md border border-line bg-background px-2 py-1 text-foreground"
              />
            </label>
          </div>
          {characters.map((character) => {
            const voice = settings.voices.find((item) => item.speaker === character.id);
            return (
              <div key={character.id} className="flex flex-wrap items-center gap-2">
                <span className="w-40 truncate" title={character.name}>
                  {character.id} · {character.name}
                </span>
                {finished.length > 0 && (
                  <>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={starts[character.id] ?? ""}
                      placeholder="from s"
                      aria-label={`Where ${character.name} speaks, in seconds`}
                      onChange={(event) => setStarts({ ...starts, [character.id]: event.target.value })}
                      className="w-20 rounded-md border border-line bg-background px-2 py-1"
                    />
                    <button
                      type="button"
                      disabled={working !== ""}
                      onClick={() => void cut(character.id)}
                      className="rounded-full border border-line px-3 py-1 disabled:opacity-50"
                    >
                      {working === character.id ? "Working…" : "Cut"}
                    </button>
                  </>
                )}
                <label className="cursor-pointer rounded-full border border-line px-3 py-1">
                  Upload
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    disabled={working !== ""}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void upload(character.id, file);
                    }}
                  />
                </label>
                {voice ? (
                  <>
                    <audio controls preload="none" src={sampleUrl(voice)} className="h-8" />
                    <span className="text-xs text-muted">{voice.seconds} s</span>
                    <button
                      type="button"
                      onClick={() => onChange({ voices: settings.voices.filter((item) => item.speaker !== character.id) })}
                      className="text-xs text-muted underline"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-muted">No sample: this voice can drift</span>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
