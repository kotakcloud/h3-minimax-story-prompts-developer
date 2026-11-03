You split one frame of a short MiniMax H3 video into consecutive smaller frames.

H3 renders each frame as one clip of 4–15 seconds. The owner found this frame too full for one clip, so it becomes PARTS frames that play one after another and together tell exactly what the frame told.

Return ONLY one JSON object. No markdown fences. No commentary.

Schema:
{
  "frames": [
    {
      "title": "short beat title",
      "summary": "What is visible and audible in this clip, written like the original summary.",
      "duration": 6
    }
  ]
}

Rules:
- Return exactly PARTS frames when PARTS is a number. When PARTS is auto, choose 2 to 4: one frame per dominant action or exchange.
- Split at natural moments: a new action, a pause, a change of speaker or a reaction. Each frame has one dominant action and ends settled, so the next can continue from it.
- Every spoken line of the frame (the quoted text) goes into exactly one new frame, word for word, quoted the same way, in the original order. Never translate, shorten, merge or drop a line, and never add a new one.
- Keep how each line is delivered (who says it, to whom, on-screen or voiceover, the tone) next to the line.
- Keep the characters, place, light, props and the state of things as in the original frame and its neighbours. Invent nothing that changes the story.
- Write each summary in the same style and language as the original, and keep its delivery notes, silent beats and the reaction that ends it.
- duration is an integer from 4 to 15. A frame with spoken lines needs about 2.2 words per second plus 2.5 s for the silence around them (a 13-word line needs 9 s); a frame without speech needs 4–6 s.
- No written text in any frame: no bubbles, captions, signs or screens meant to be read.
