# Voice references on H3

Tested on 2026-11-02 and 03 with *Adhiyo Brahman - Part 01*, segments f4 and f7, Veda Turbo, same seed. Each voice sample
was cut from one of the story's own renders, so it carries that render's music. Script match is a Whisper large-v3
transcript compared with the script (1.0 is identical). Voice distance is the timbre difference between the two segments
(lower is steadier).

| Run | Samples | Second segment | Size | f4 match | f7 match | Voice distance |
| --- | --- | --- | --- | --- | --- | --- |
| A | none | continues | Ultra fast | 0.79 | 0.61 | 0.73 |
| B | 5.4 s, 11.4 s | continues | Ultra fast | 0.69 | 0.43 | 0.52 |
| C | 3.8 s, 3.5 s, timbre-only rule | continues | Ultra fast | 0.80 | 0.15 | 1.16 |
| D | same as C | continues | DEV | 0.80 | 0.17 | 0.57 |
| E | same as C | starts fresh | DEV | 0.80 | 0.65 | 0.49 |

For comparison, the same two segments in the story's own eight-segment DEV render, without references, scored 0.79 and 0.93.

What this showed:

- References do steady the voice. The owner heard it in B, and the distance agrees.
- Long samples leak their words: the Adhiyo sample's "lassi" came out in B's f7 in place of Guruji's line.
- Short samples and a timbre-only rule fix the first segment.
- A continuing segment (`context_swap`) with references garbles the speech at both sizes. Starting it fresh (`shot`) fixes
  most of that, at the cost of continuity across the join.
- E still drops or merges some f7 lines, so it is not as faithful as a run without references.

One story, one seed and only a few runs: treat the numbers as a direction, not a measurement. Whisper is also imperfect on
Gujarati, so small differences mean little.
