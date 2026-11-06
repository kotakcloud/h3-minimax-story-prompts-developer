// Camera choices for a frame, in plain words for the owner (label + description) and precise words for the prompt AI
// (instruction). Blank = the AI chooses, as before.

export type CameraOption = { id: string; label: string; description: string; instruction: string };
export type CameraGroup = { label: string; options: CameraOption[] };

export const CAMERA_SHOTS: CameraGroup[] = [
  {
    label: "How much we see",
    options: [
      {
        id: "wide",
        label: "Wide shot",
        description: "Shows the whole place and everyone in it; people look small. Good for an opening or to show where we are.",
        instruction: "a wide shot: the whole setting and every character in it are visible, people small in the frame",
      },
      {
        id: "full",
        label: "Full shot",
        description: "People seen from head to toe. Good for walking, dancing, fighting or any whole-body movement.",
        instruction: "a full shot: the characters are framed head to toe with a little room around them",
      },
      {
        id: "medium",
        label: "Medium shot",
        description: "From the waist up, like a TV conversation. Faces and hands are both easy to see.",
        instruction: "a medium shot: the characters are framed from the waist up",
      },
      {
        id: "medium-close",
        label: "Medium close-up",
        description: "Head and chest. Keeps attention on what the person says and feels, with a little of the place behind.",
        instruction: "a medium close-up: head and chest of the main character fill the frame, a little background visible",
      },
      {
        id: "close-up",
        label: "Close-up",
        description: "The face fills the screen. For strong emotion, a reaction or the punchline. Only one person is seen.",
        instruction: "a close-up: one character's face fills most of the frame",
      },
      {
        id: "extreme-close",
        label: "Extreme close-up",
        description: "Only a detail: eyes, a hand, an object. For a dramatic small moment; best without talking.",
        instruction: "an extreme close-up on a single detail (eyes, a hand or a key object) that matters in this moment",
      },
      {
        id: "two-shot",
        label: "Two-shot",
        description: "Two people in the same picture, both faces visible. Best when two people talk to each other.",
        instruction: "a two-shot: the two main characters of this moment share the frame, both faces clearly visible the whole time",
      },
      {
        id: "over-shoulder",
        label: "Over the shoulder",
        description: "We look past one person's shoulder at the other person's face. The classic conversation view.",
        instruction:
          "an over-the-shoulder shot: from just behind one character's shoulder (back of the head and shoulder soft in the foreground) toward the other character's face",
      },
    ],
  },
  {
    label: "Where the camera is",
    options: [
      {
        id: "eye-level",
        label: "Eye level",
        description: "Camera at the people's eye height. Natural and neutral, like standing in the room.",
        instruction: "eye level: the camera is at the characters' eye height",
      },
      {
        id: "low-angle",
        label: "Low angle (looking up)",
        description: "Camera low, looking up at the person. Makes them look big, strong or scary.",
        instruction: "a low angle: the camera is below the characters' eye line looking up at them, making them look powerful",
      },
      {
        id: "high-angle",
        label: "High angle (looking down)",
        description: "Camera high, looking down at the person. Makes them look small, weak or lonely.",
        instruction: "a high angle: the camera is above the characters looking down at them, making them look small",
      },
      {
        id: "top-down",
        label: "From straight above",
        description: "Looking straight down, like a drone or a bird. Shows the layout of a place or a crowd.",
        instruction: "a top-down bird's-eye view looking straight down on the scene",
      },
      {
        id: "pov",
        label: "Through a character's eyes",
        description: "We see what one character sees. That character's own face is not shown.",
        instruction:
          "a point-of-view shot through the main character's eyes: we see what they see, their own face is not in frame",
      },
    ],
  },
];

export const CAMERA_MOVES: CameraGroup[] = [
  {
    label: "Camera move",
    options: [
      {
        id: "still",
        label: "Still",
        description: "The camera does not move, like on a tripod. Calm; lets the acting speak.",
        instruction: "the camera holds still the whole time",
      },
      {
        id: "push-in",
        label: "Slowly move closer",
        description: "The camera slowly comes closer to the person. Builds tension or focuses on a feeling.",
        instruction: "the camera pushes in with small amplitude at slow speed toward the main character",
      },
      {
        id: "pull-out",
        label: "Slowly move back",
        description: "The camera slowly moves away and shows more of the place. Good for endings, loneliness or a reveal.",
        instruction: "the camera pulls back with small amplitude at slow speed, revealing more of the setting",
      },
      {
        id: "pan",
        label: "Turn to follow (pan)",
        description: "The camera stays in one spot and turns left or right, like turning your head, to follow the action.",
        instruction: "the camera pans slowly with small amplitude, turning from one spot to follow the action",
      },
      {
        id: "tracking",
        label: "Walk along (tracking)",
        description: "The camera moves alongside a walking or running person, keeping them in the picture.",
        instruction: "the camera tracks smoothly at slow speed alongside the moving character, keeping them in frame",
      },
      {
        id: "orbit",
        label: "Circle around",
        description: "The camera slowly circles around the person. For a dramatic or heroic moment.",
        instruction: "the camera orbits slowly around the main character with small amplitude",
      },
      {
        id: "handheld",
        label: "Handheld (slight shake)",
        description: "A little natural shake, like a phone camera. Feels real, tense or chaotic.",
        instruction: "a handheld camera with a slight natural sway, never fast or jerky",
      },
    ],
  },
];

function find(groups: CameraGroup[], id: string | undefined): CameraOption | undefined {
  return id ? groups.flatMap((group) => group.options).find((option) => option.id === id) : undefined;
}

export const cameraShot = (id?: string) => find(CAMERA_SHOTS, id);
export const cameraMove = (id?: string) => find(CAMERA_MOVES, id);

// The owner's camera as a requirement for the prompt AI. A segment that must open on <Picture 1>'s framing (or continue
// the previous shot) cannot start on another one, so the chosen shot is reached by a visible camera move early on.
export function cameraRequirement(camera: string): string {
  return [
    `CAMERA REQUIRED BY THE OWNER FOR THIS SEGMENT: ${camera}`,
    "This choice wins over any framing or camera move in the frame summary and over your own choice of camera. Write it into the prompt in plain camera words (the framing and the camera motion type + amplitude + speed), so it is clearly visible in the video; never write \"the camera is locked off\" or \"holds still\" unless the owner chose a still camera.",
    "If the segment has to open on the framing of <Picture 1>, its storyboard panel or the previous shot, open that way and then reach the chosen shot within the first second or two through the chosen move (or a smooth push-in / pull-back when no move was chosen), and hold it for the rest of the segment.",
    "Still keep every on-screen speaker's face in frame while they speak; if the chosen shot cannot show them all, frame the one who speaks.",
  ].join("\n");
}

// How a written prompt names each choice (to check the AI kept it).
const NAMED: Record<string, RegExp> = {
  wide: /wide (shot|view|angle)/i,
  full: /full(-| )(shot|body)|head to toe/i,
  medium: /medium (shot|framing)|waist up/i,
  "medium-close": /medium close-?up|head and chest/i,
  "close-up": /close-?up/i,
  "extreme-close": /extreme close-?up/i,
  "two-shot": /two-?shot/i,
  "over-shoulder": /over[- ]the[- ]shoulder/i,
  "eye-level": /eye[- ]level/i,
  "low-angle": /low[- ]angle|looking up at/i,
  "high-angle": /high[- ]angle|looking down at/i,
  "top-down": /top-down|bird.s-eye|straight down|overhead/i,
  pov: /point[- ]of[- ]view|\bPOV\b|through (his|her|their|[a-z]+'s) (own )?eyes/i,
  still: /holds? still|locked[- ]off|static camera|does not move/i,
  "push-in": /push(es)? in|moves? closer|dolly in/i,
  "pull-out": /pull(s)? (back|out)|moves? back|dolly out/i,
  pan: /\bpan(s|ning)?\b/i,
  tracking: /\btrack(s|ing)?\b|alongside/i,
  orbit: /orbit|circles? (slowly )?around|arcs? around/i,
  handheld: /hand-?held/i,
};

// The owner's camera choices a written prompt does not name (as their labels).
export function cameraMisses(frame: { cameraShot?: string; cameraMove?: string }, prompt: string): string[] {
  return [cameraShot(frame.cameraShot), cameraMove(frame.cameraMove)]
    .filter((option): option is CameraOption => Boolean(option && NAMED[option.id] && !NAMED[option.id].test(prompt)))
    .map((option) => option.label);
}

// What the prompt AI is told for a frame, or "" when the owner left the camera to it.
export function cameraInstruction(frame: { cameraShot?: string; cameraMove?: string }): string {
  const shot = cameraShot(frame.cameraShot);
  const move = cameraMove(frame.cameraMove);
  if (!shot && !move) return "";
  return [shot && `Shot: ${shot.instruction}.`, move && `Camera move: ${move.instruction}.`].filter(Boolean).join(" ");
}
