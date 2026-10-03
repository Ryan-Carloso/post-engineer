---
name: Preview UI
description: Visually verify a web UI change in the running dev server with the authenticated browser — screenshots, filled form states, both locales, console errors. Use after editing anything under apps/web (pages, components, styles), when the user says "see how it looks" / "is it broken" / "check the layout", or before reporting a screen as done.
---

# Preview the web UI

Tests prove behavior; only the browser proves **layout**. Every "it's broken
without styles" report in this repo was invisible to a green test suite.

## 1. Dev server

- Web serves `http://localhost:3434` (`pnpm dev:web` from the repo root).
- Check first: `lsof -nP -iTCP:3434 -sTCP:LISTEN`. If nothing is listening, start
  it in the background (`shell` with `background: true`) and wait for the port.
- **Never restart a server that is already listening** — the user is probably
  using it.

## 2. Open the page with the logged-in session

- This project already configures the Playwright MCP (`opencode.json`:
  `@playwright/mcp --browser chromium`). Its browser profile keeps the app
  session, so `browser_navigate` to a protected route lands **inside** the app.
- Prove you are authenticated before trusting anything: `browser_snapshot` must
  show the sidebar (Posts / Contas / Personas / Tokens / API Keys) and the token
  balance. A bounce to `/landing` or a bare login form means **no session** —
  ask the user to sign in in the browser window. Never guess credentials or
  read them out of `apps/web/.env`.
- **Never mutate real data to take a picture.** No post scheduling (it spends
  tokens), no account connect, no delete, no OAuth. Fill the form, read the
  preview, stop. If a state is only reachable through a paid/destructive action,
  describe it instead and ask first.

## 3. Actually look at the result

- `browser_take_screenshot` **requires** `scale` (`"css"` or `"device"`); it also
  takes `filename` and `fullPage`.
- Write to `.playwright-mcp/<name>.png` — that directory is gitignored. The
  repo root is not.
- **A screenshot path in the tool result is not a look.** Read the PNG back with
  the `read` tool (that is how you see it), or `browser.preview` to show the user.
- `browser_snapshot` (accessibility tree) is for structure and refs; the
  screenshot is for styling. Use both; they fail differently.
- Delete the throwaway PNGs when done. Never stage them.

## 4. Scrolling: the shell scrolls, not the window

`window.scrollTo(0, N)` silently does nothing — the app shell owns the scroll:

```js
() => { const m = document.querySelector('main'); m.scrollTop = 900; return m.scrollTop; }
```

Check the returned value is non-zero before screenshotting the lower half.

## 5. Drive the form

- Prefer the real tools: `browser_select_option`, `browser_fill_form`,
  `browser_click`, `browser_type`, `browser_press_key`.
- Only fall back to `browser_evaluate`. React ignores a plain `el.value = x`, so
  go through the native setter and dispatch **both** events:

  ```js
  (el, value) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  ```

- Checkboxes: `el.click()`. Dates/times: set the `datetime-local` / `time` input
  with a real value (`YYYY-MM-DDTHH:mm`, `HH:MM`) — an empty one shows
  `dd/mm/yyyy, --:--` in the shot and proves nothing.
- Fill **every** mandatory field before the screenshot: a half-filled form
  renders the empty states, not the layout you changed.

## 6. Both locales, and both widths

- The app defaults to **PT**. Toggle **EN** and look again: an untranslated key,
  a wrong plural ("1 tokens", "1 vídeo(s)"), or copy that overflows its card only
  shows in one language.
- Narrow width: `browser_resize({ width: 390, height: 844 })`. Grids declared
  `lg:grid-cols-*` collapse to one column — confirm the mobile stack, then resize
  back.

## 7. Console

`browser_console_messages({ level: "error" })` after each interaction. Known
pre-existing noise in this repo — not yours:

- `400 (Bad Request) /_next/image?url=%2Flogo.png` (sidebar logo)
- the Vercel analytics `script.debug.js` CSP block

Anything else came from your change. Fix it before reporting done.

## 8. What this catches that tests do not

- Broken or missing styling (bare inputs, no cards, wrong grid, no sticky column).
- Copy problems in one locale only, including plural forms.
- Empty / loading / error states that exist only in the test fixtures.
- Layout that works at 1200px and collapses at 390px.
- Preview/summary panels that show nothing because a helper returns null.

## 9. Report back

Say what you saw, not what you built: "the preview column renders, cost shows
'1 token / 1 video', Instagram group is empty because no account is connected"
plus any console error you introduced. If the screenshot showed something the
code comments claim otherwise, fix the comment too — this repo's standing rule is
that comments describe the code that exists.
