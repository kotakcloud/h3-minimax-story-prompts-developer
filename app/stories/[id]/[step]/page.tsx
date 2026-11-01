import { notFound, redirect } from "next/navigation";
import { Workshop } from "@/components/workshop";
import { readStory } from "@/lib/story-store";
import { isStoryStep, storyPath, storySteps } from "@/lib/types";

export default async function StoryStepPage({
  params,
}: {
  params: Promise<{ id: string; step: string }>;
}) {
  const { id, step } = await params;
  if (!isStoryStep(step)) {
    const story = await readStory(id);
    redirect(storyPath(id, story?.step || "gist"));
  }
  const story = await readStory(id);
  if (!story) notFound();
  // Imported stories only have the Video step.
  if (story.imported && step !== "video") redirect(storyPath(id, "video"));
  // type-1 stories have no Cast step.
  if (!storySteps(story).includes(step)) redirect(storyPath(id, "image"));
  return <Workshop storyId={id} step={step} />;
}
