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

## Samples only where the character speaks

A full Ultra fast render with both samples shared on all 8 segments scored 0.77-0.95 on simple segments but 0.40 on f5 and
0.39 on f7, and silent f8 spoke the Guruji sample word for word. Shared references reach every segment, so the samples
became audio clips placed at the start of the segments that use them, with fresh `shot` segments as before.

| Segment | Shared samples | Samples per segment |
| --- | --- | --- |
| f5 | 0.40 | 0.74 |
| f7 | 0.39 | 0.94 |
| f5 to f7 voice distance | 0.60 | 0.46 |

The no-references DEV render's f5 to f7 distance is 0.77. f8 no longer repeats a sample; Whisper still printed words there
over the music, and that was not checked by ear. The log shows less reference audio per segment than expected (72.75 KiB,
about 1.8 s at the rate of the shared run, for two samples totalling 7.3 s). The cause is unknown, and this shorter audio may
be part of why the speech is cleaner.

One story, one seed and only a few runs: treat the numbers as a direction, not a measurement. Whisper is also imperfect on
Gujarati, so small differences mean little.
