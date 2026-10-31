import type { Story } from "@/lib/types";

// Video tab of an imported story: what the file brought along from the earlier steps.
export function ImportedDetails({ story }: { story: Story }) {
  const imported = story.imported;
  if (!imported) return null;
  return (
    <div className="mb-6 rounded-2xl border border-line bg-card p-4 text-xs leading-5 text-muted">
      <p>
        Imported from <span className="text-foreground">{imported.fileName}</span>
        {imported.exportedAt && ` · exported ${new Date(imported.exportedAt).toLocaleString()}`}
      </p>
      {imported.sources.map((source) => (
        <div key={source.storyId} className="mt-3 space-y-2">
          <p className="text-sm font-medium text-foreground">
            {source.title}
            {source.language && <span className="ml-2 text-xs font-normal text-muted">{source.language} dialogue</span>}
          </p>
          {source.gist && <p className="whitespace-pre-wrap">{source.gist}</p>}
          {source.characters.length > 0 && (
            <p>
              <span className="text-foreground">Cast: </span>
              {source.characters.map((character) => `${character.name}: ${character.look}`).join(" · ")}
            </p>
          )}
          {source.location.name && (
            <p>
              <span className="text-foreground">Location: </span>
              {source.location.name}
              {source.location.description && `, ${source.location.description}`}
            </p>
          )}
        </div>
      ))}
      <ol className="mt-3 space-y-1">
        {story.segments.map((segment, index) => {
          const frame = story.frames.find((item) => item.id === segment.id);
          return (
            <li key={`${segment.id}-${index}`}>
              <details>
                <summary className="cursor-pointer">
                  <span className="text-foreground">
                    {index + 1}. {frame?.title || segment.id}
                  </span>{" "}
                  · {segment.duration}s
                  {segment.panel ? ` · panel ${segment.panel}` : ""}
                  {segment.join === "cut" ? " · cut" : ""}
                </summary>
                {frame?.summary && <p className="mt-1">{frame.summary}</p>}
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-background p-2 font-mono text-[11px] text-foreground">
                  {segment.prompt}
                </pre>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
