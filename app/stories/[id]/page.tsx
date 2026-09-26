import { redirect } from "next/navigation";
import { readStory } from "@/lib/story-store";
import { storyPath } from "@/lib/types";

export default async function StoryIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const story = await readStory(id);
  redirect(storyPath(id, story?.step || "gist"));
}
