# Todo: add a floating sticky note (same behavior as Story Prompt Studio)

Build **one global scratch pad** that lives above the rest of the UI. It is not a page, not a stage artifact, and not mixed into the app’s main documents. It is a small always-available note.

## What it is

- A single floating icon (sticky-note / notepad glyph).
- Clicking the icon opens a **medium** pad.
- The pad is **always editable** (textarea, never a read-only view).
- The pad has a **Save** control inside it.
- The icon can be **dragged anywhere** on the screen.
- Icon position **and** saved note text **survive reload**.
- Open/closed state does **not** need to survive reload (start **closed**).

## Where it lives

- Show on **every screen** of the app (home, settings, all main views).
- Render as a **fixed overlay** (portal to `document.body` or equivalent) so it is not trapped in a CSS grid/flex layout.
- Sit above normal chrome. Do not let the debug/console panel permanently cover it.

## Icon (floater)

- One square button, about **40×40px**.
- Default park: **bottom-right** of the viewport (with ~20px inset), until the user has dragged it once.
- Cursor: grab / grabbing while dragging.
- Accessible name: **Note**. `aria-expanded` reflects open/closed.
- While the pad is open, the icon can look “active” (primary/highlighted).

## Click vs drag

Treat pointer down → move → up as one gesture:

1. If the pointer moves less than ~**5px**, it is a **click**: toggle the pad open/closed.
2. If it moves more than that, it is a **drag**: move the icon; **do not** toggle open/closed when the pointer is released.
3. Keyboard / programmatic activation still toggles (Enter/Space on the button).
4. Only the **primary** mouse/touch pointer starts a drag.

While dragging, keep the pointer captured so the icon does not get lost if the cursor leaves the button.

## Pad (opened note)

- Medium size: about **340×280px**.
- Shrink to stay on screen: width `min(340px, ~86vw)`, height `min(280px, viewport − 16px)`, and never shorter than ~**160px**.
- Header: label **note** + **Save**.
- Body: a resizable-off textarea, always editable.
- Placeholder copy is fine (generic scratch-note hint). Do not prefill any real content.
- Save is **disabled** when the draft matches the last saved text; enabled when dirty.
- Save **writes the draft** and does **not** close the pad.
- Clicking the icon again **closes** the pad. Unsaved draft can stay in memory until reload; reload restores **last saved** text only.

## Keep the pad on screen

When opening (and while the icon sits near an edge):

- Prefer opening **below** the icon if there is enough room, otherwise **above**.
- If that would still clip, shift the pad so it stays inside the viewport with an ~**8px** margin.
- If the icon is near the right edge, grow the pad **leftward** so it does not hang off-screen.
- On **window resize**, clamp the icon so it stays fully visible; reposition the open pad the same way.

## Persistence

Store three fields with the rest of the app’s UI prefs (or equivalent durable local settings):

```json
{ "x": 0, "y": 0, "text": "" }
```

- `x`, `y`: viewport **left/top** of the icon in CSS pixels. `0, 0` means “never dragged” → use the default bottom-right park.
- `text`: last **saved** body. Empty string is valid.
- Persist **position on drag end** (do not wait for Save).
- Persist **text only when Save is clicked** (no autosave on every keystroke).
- Dragging must **not** overwrite unsaved thoughts in storage, and must **not** wipe already-saved text.
- Other prefs writes (layout, last route, debug panel, etc.) must **merge** this object, never replace the whole prefs blob in a way that drops `x` / `y` / `text`.
- Wait until prefs have actually loaded from the server/store before writing, so a default empty note cannot clobber a real one on first paint.
- If two prefs saves race, keep the latest merge; never let an older write delete the note.

## Out of scope

- Multiple notes, per-project notes, folders, colors, or rich text.
- Remembering open/closed across reload.
- Autosave of the draft.
- Docking, snapping to a sidebar, or minimizing into the top bar.

## Done when

- [ ] Floater is on every route and starts bottom-right if never moved.
- [ ] Click toggles a medium editable pad; drag moves the icon without toggling.
- [ ] Pad stays fully on-screen near edges and after resize.
- [ ] Save is dirty-aware; reload restores saved text and last icon position.
- [ ] Unrelated settings/layout saves do not erase the note.
