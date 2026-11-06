import { CAMERA_MOVES, CAMERA_SHOTS, cameraMove, cameraShot, type CameraGroup } from "@/lib/camera";

function CameraSelect({
  label,
  groups,
  value,
  onChange,
}: {
  label: string;
  groups: CameraGroup[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`max-w-56 rounded-md border bg-background px-2 py-1 text-xs ${value ? "border-accent text-foreground" : "border-line text-muted"}`}
      >
        <option value="">Let the AI choose</option>
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.id} value={option.id} title={option.description}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

// A frame's camera: the shot (how much we see, from where) and the camera move, each explained in plain words.
export function CameraPicker({
  shot,
  move,
  onChange,
}: {
  shot?: string;
  move?: string;
  onChange: (next: { cameraShot?: string; cameraMove?: string }) => void;
}) {
  const chosenShot = cameraShot(shot);
  const chosenMove = cameraMove(move);
  return (
    <div className="mt-2 border-t border-line pt-2 text-xs text-muted">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-foreground">Camera</span>
        <CameraSelect
          label="Shot"
          groups={CAMERA_SHOTS}
          value={chosenShot?.id || ""}
          onChange={(value) => onChange({ cameraShot: value || undefined, cameraMove: move })}
        />
        <CameraSelect
          label="Move"
          groups={CAMERA_MOVES}
          value={chosenMove?.id || ""}
          onChange={(value) => onChange({ cameraShot: shot, cameraMove: value || undefined })}
        />
      </div>
      {(chosenShot || chosenMove) && (
        <ul className="mt-1.5 space-y-0.5">
          {chosenShot && (
            <li>
              <span className="text-foreground">{chosenShot.label}:</span> {chosenShot.description}
            </li>
          )}
          {chosenMove && (
            <li>
              <span className="text-foreground">{chosenMove.label}:</span> {chosenMove.description}
            </li>
          )}
          <li className="text-muted/80">Used when the prompts are written; it wins over any camera words in the summary.</li>
        </ul>
      )}
    </div>
  );
}
