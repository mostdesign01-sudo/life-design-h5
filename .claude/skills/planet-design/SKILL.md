---
name: planet-design
description: Visual, typographic and motion rules for the 3D "你的小星球" pages (planet.html and planet/*), plus the screenshot-and-independent-critic loop used to check them. Use when adding a new planet or stop, changing copy, layout, colours, the postcard, sound or camera framing, or when asked to make the planet look more designed or polished.
---

# 小星球设计规范

The look is "warm, painterly nature with restrained design": a small planet in golden-hour light (soft shadows, sky-lit ambient, wind in the grass, bloom and a gentle tilt-shift) seen through a long perspective lens, with calm, editorial typography and UI on top. The warmth carries the emotion; the type, palette discipline and spacing keep it from feeling childish. Every answer visibly changes the world.

A flat, Monument Valley-style version was tried and rejected: on a sphere covered in small props it read as a toy rather than as architecture, and it lost the light that makes the planet feel alive. Do not drift back toward flat shading or a pastel-only palette.

## Typography

- Two faces only.
  - Display: `var(--font-display)` = "Planet Serif" (a Noto Serif SC 600 subset in `vendor/fonts/`). Use it for titles, object names, the HUD planet number, score numerals and postcard headlines.
  - Reading: `var(--font-body)` (system sans). Use it for stories, questions, buttons, hints and captions.
- Scale tokens in `planet.html`: `--text-xs` 11, `--text-sm` 13, `--text-md` 15, `--text-lg` 22 (sheet title), `--text-xl` 34 (intro title). Score numerals are 40px serif with a small "/10".
- Kickers are small, widely tracked (`--tracking-wide`) and led by an 18px accent rule. There is one kicker per sheet, and nothing else decorative.
- The planet's reply (`.reaction`) is a quoted note with a 2px accent rule on the left, not a filled box.
- Line length and breaks: titles use `text-wrap: balance` and body text `pretty`. Rewrite copy rather than leave an orphan character or a word split across lines. Headlines generated from scores must fit on one line at 390px.
- **The display font is a subset.** After adding or changing any Chinese copy in `planet.html`, `planet/main.js` or `planet/state.js`, regenerate it with `scripts/subset-font.py` (usage at the top of the script). Otherwise new characters fall back to a system serif.
- Canvas text (the postcard) uses the same two faces and sets `ctx.letterSpacing` for tracked captions.

## Colour

- The world palette is natural and warm: meadow greens (`MEADOW` in `planet/world.js`), warm woods, a terracotta roof, stone, clear teal water, and gold lamp light against a blue sky with a peach horizon.
- New objects use the same families. Keep accents rare: one warm light, one roof red. No neon or toy primaries.
- The UI accent is `--accent` #c95a26 (white text on it passes 4.5:1).
- Text contrast is at least 4.5:1 everywhere, including label subtitles and postcard captions. Check this when lightening anything grey.
- Scores must change the world in a way you can read from a screenshot, pushed to both extremes:
  - Play: sky golden or overcast, and the sun fades. Above about 7 the whole sky, top to horizon, slides into a pink-orange evening glow (`midDusk`, `topDusk`, `horizonDusk`, `bottomDusk`); to show it on camera, face away from the sun, because looking into it washes the sky out to cream.
  - Work: white or charcoal smoke, warm or red windows.
  - Health: clear or muddy water, mint or straw ground.
  - Love: N of 10 bulbs lit, gold against dark grey.

## Shape and materials

- Build with `MeshStandardMaterial`, using rounded boxes (`RoundedBoxGeometry`) and the painted canvas textures in `planet/look.js` (wood, roof tiles, stone). Foliage uses vertex-coloured blobs, shaded from dark at the base to sunlit at the crown.
- Objects cast soft shadows and sit on a contact blob (`addBlob`).
- Keep detail where the eye lands: the props and the traveler. The ground stays calm.
- The traveler is a small person, not a doll: long legs, a smaller head, muted jacket and beanie, no blush.
- Glow (`glow()` plus `addHalo`) is reserved for things that mean something: lamps, windows, the sprout, the diary gem. Keep emissive values below the bloom threshold when items need to be counted.
- Anything the user must count or compare should be large and separated at the stop's close-up framing.

## Layout and camera

- Close-ups frame the object and the traveler together, inside the area left free by the top HUD (`HUD_HEIGHT`) and the open sheet. Trees between the camera and the subject are hidden.
- An object with a clear front sets `front` in the layout, so the traveler steps aside and the camera looks from the open side.
- Labels sit above objects, never over them or under the HUD. Each label shows two lines: the name, then what it stands for. The next stop pulses, and the final stop stays dim until it is unlocked.
- The intro shows the planet above the copy, with no HUD clutter. The first rendered frame must already be a finished picture.
- Respect `--safe-top`/`--safe-bottom`, and `?host=xhs` (76px reserved at the top).

## Motion and sound

- Speed always varies. Use ease-out-back pop-ins, spring-driven score values, squash and stretch on confirm, and a dive with a held anticipation beat on landing.
- When idle, the traveler breathes and glances around, so nothing is fully frozen.
- Every confirmed answer has a visible reaction on its object, a traveler hop and a sound (`planet/sound.js`, all synthesised).
- New sounds stay in the C major pentatonic set used there.
- Sheet content enters line by line. Respect `prefers-reduced-motion`.

## Copy

- Use plain, warm Chinese. No design jargon ("原型", "重力问题" as a bare term) and no judgemental labels ("红灯").
- Use the planet's imagery: 老藤 and 新芽, 晚霞, 灯串.
- Never invent numbers, users or testimonials. AI output that fails to load is hidden, not shown as an error.

## Checking a change (do this before calling it done)

1. Serve the repo (`python3 -m http.server`) and drive `planet.html?quality=1` with Playwright on Chromium. Use `--use-angle=swiftshader` in a headless container.
2. Capture at least these screens on a 390×844 @2x phone, plus one 1280×800 desktop shot:
   - the first frame and the intro;
   - just after landing;
   - each stop, both open and after confirming;
   - the overview;
   - the generated postcard image.
3. Use the `window.__planet` hook (`goTo`, `openObject`, `setFollow`, `closeSheet`) to reach each state.
4. Hand the screenshots to a **fresh** subagent that has not seen the code. Ask it to judge them against polished indie mobile games and top Xiaohongshu H5s, and to return ranked issues with fixes and a verdict: "ready to publish" or "needs another round". Fix the top issues, recapture and repeat with a new critic until the verdict is "ready to publish".
5. Also confirm the end-to-end flow still writes the shared `lifeDesignH5StateV1` progress: `index.html` should resume at the next unanswered question.
