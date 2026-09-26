import { notFound, redirect } from "next/navigation";
import { Workshop } from "@/components/workshop";
import { readStory } from "@/lib/story-store";
import { isStoryStep, storyPath } from "@/lib/types";

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
  return <Workshop storyId={id} step={step} />;
}
