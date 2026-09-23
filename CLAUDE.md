# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server on :5173
npm run build    # tsc --noEmit && vite build
npm test         # sampling/randomness assertions
```

`npm test` runs one file (`test/sampling.test.ts`) directly under Node 24's native
type stripping — there is no test framework and no build step. To run a subset,
comment out calls in that file or run a scratch `.ts` file the same way
(`node scratch.ts`). Assertions print `PASS`/`FAIL` and the process exits nonzero
on any failure.

**Relative imports must carry explicit `.ts`/`.tsx` extensions.** Vite resolves
extensionless imports but Node does not, and `npm test` executes the real modules
rather than a bundle. `tsconfig.json` sets `allowImportingTsExtensions` to permit
this. Dropping an extension breaks `npm test` while leaving `npm run build` green.

## Architecture

A browser-only app that manufactures random GitHub repository samples. No backend:
`api.github.com` is CORS-open (`Access-Control-Allow-Origin: *`) and exposes
`X-RateLimit-*` headers, so the page calls it directly and reports real quota.

The difficulty is concentrated in `src/lib/`, not the components:

- **`sample.ts`** — window math. Decides *which* slice of GitHub to ask for.
- **`draw.ts`** — orchestration. Spends requests, fills a batch, manages the pool.
- **`github.ts`** — transport. Request/response, quota parsing, error classification.
- **`random.ts`** — seeded PRNG (`mulberry32`) plus seed-stable shuffle.
- **`ink.ts`** — language → one of four ink colors; star count → card size.

`App.tsx` holds all state (mode, star floor, seed, reserve pool) and passes plain
props down. Components are presentational.

### Why the sampling code looks the way it does

GitHub has no random endpoint, so randomness is synthesized: pick a random
`created:` time window, then a random page inside it. Four measured constraints
shape nearly every decision in `sample.ts` and `draw.ts`, and changing that code
without accounting for them will silently degrade randomness rather than error:

1. **Search returns at most 1000 results.** Page 11+ errors outright. A window
   holding more than 1000 repos is only samplable down to its top-ranked slice, so
   `draw.ts` probes `total_count` first and calls `narrowPlan()` to shrink the
   window proportionally when it overshoots. Skipping this turns a uniform sample
   into a popularity ranking that still *looks* random.
2. **Creation density rose ~150x** (90 repos/hour in 2012 → 13,808 in 2026).
   `DENSITY_ANCHORS` interpolates this logarithmically. A fixed window width finds
   nothing in old eras and blows the cap in recent ones.
3. **Star floors are age-dependent.** `stars:>=100` keeps ~2.5% of 2011-era repos
   but ~0.11% of 2021-era ones — old repos had years to accumulate. Hence
   `baseKeepRate()` *times* `ageMultiplier()`; the base table alone overshoots the
   cap badly on old windows.
4. **Truly random GitHub is mostly coursework.** 0 of 100 sampled repos had any
   stars and only 40 had descriptions. This is why the star-floor slider exists,
   and why its zero position (raw mode) deliberately surfaces those empty repos —
   that visible junk is the evidence the randomness isn't staged. Don't "improve"
   raw mode by filtering it.

### Two invariants worth knowing before editing

**Seed reproducibility.** The UI promises a shared link reproduces its batch, so
anything feeding window selection must be stable for a given seed. `sample.ts`
derives its upper bound from `samplingCeiling()` — `Date.now()` snapped to a day
boundary — rather than the raw clock. Using `Date.now()` directly anywhere in the
window path (including `ageMultiplier`) reintroduces per-second drift and breaks
shared links. `test/sampling.test.ts` guards this.

**The reserve pool.** Unauthenticated search allows 10 req/min. Every request asks
for `per_page=100` while a sheet shows 12; the remaining ~88 live in `App.tsx`
state, and `drawFromPool()` serves later draws — free for search-mode rows, one
hydration request for deep-mode rows, which arrive sparse. Roughly 8 draws per
request either way. Any change to the star floor, era bias, or draw mode must
clear the pool (`setPool([])`), since pooled results no longer match the new query.

Two sampling modes run through search (`curated` = star floor, `raw` = no
qualifier); `deep` mode walks the raw id space via `/repositories?since=` on the
core bucket (60/hour). Deep-mode rows are sparse — no stars, language, or topics —
so `hydrateRepos()` backfills them with one stacked `repo:A repo:B` search
(~12 per query, matched back by name since GitHub drops unresolvable ones).

Verified against the live API (2026-09-24): a listing returns 100 rows, ~22% forks,
with `stargazers_count`/`language`/`pushed_at` absent entirely; `since=1.38e9` still
returns rows. Stacked hydration resolved 8 of 12 names in one request, so *expect
partial results* — an unresolved row keeps `hydrated: false`, and the UI must show
that as unknown rather than printing `0` stars the API never reported.

**Deep mode spends both buckets**, and core (60/hour) is the one that runs out long
before search (600/hour). So quota is tracked per bucket (`DrawResult.quotas`,
keyed by `Resource`) rather than as one last-seen figure, and `Failure.resource`
names the bucket that actually walled — search refilling in a minute says nothing
about core's hour, and a token lifts them by different amounts.

### Styling

Two themes over one set of CSS custom properties in `src/styles/tokens.css`,
switched by `data-theme` on `<html>` (`press` | `terminal`). The press theme is a
Riso duplicator: four ink drums, flat black, **zero border-radius and zero
box-shadow** (the only `box-shadow` in the codebase is the focus ring, which is
functional). Card size tracks star count via `data-weight`.

The two themes are **different designs, not one design recolored**. Press gets its
structure from weight: 2px black frames, flat ink slabs, poster type, misregistered
hero layers. Terminal gets its structure from alignment: 1px hairlines, a console
chrome (title bar → `$` prompt → aligned table → exit line), `[selected]` brackets
on segmented controls, `# ` on provenance, `$ ` on the draw button. Whenever
terminal reuses press layout verbatim, it reads as a mockup of a press — that was
the bug this structure replaced.

Border weight and frame color are tokens (`--hair`, `--frame`) precisely so the
themes can disagree about them without every component restating an override. Add
structural borders as `var(--hair) solid var(--frame)`, not hardcoded `2px`.

`TerminalView` uses a real `<table>` with `ch`-based `<colgroup>` widths rather
than space-padded strings. Descriptions arrive in any language and CJK glyphs are
double-width, so padding by character count misaligns exactly where the data varies
most. That's why the old `padEnd` version looked crude.

Spacing lives on containers as `> * + *`, never as per-component margins — this
is deliberate, so sibling rules can't cancel each other out. Follow it when adding
sections.

Contrast is computed, not eyeballed — a throwaway script over the WCAG formula,
which is faster than arguing about it. Press was verified at 20 pairs; the terminal
palette adds 20 more (body 14.88:1 on the ground, every accent above 7:1 including
on the row-hover fill). Two values are load-bearing: `--rule` at `#5d6c58` is the
darkest green-grey clearing 3:1 on all three surfaces it touches — one step darker
(`#556351`) fails at 2.77 — and `--rule` as *text* is only 3.16:1, fine for row
ordinals that repeat what position says, not for meaningful markers like `?` or
`(无描述)`, which sit on `--quiet`. Don't darken either for looks.

Latin display type is Big Shoulders Display, which has **no CJK glyphs** — the hero
is Chinese, so ZCOOL QingKe HuangYou sits beside it in `--type-display` for
per-glyph fallback. Removing it silently drops the largest type on the page to a
system font. The terminal theme steps `--t-hero` down for the same reason in
reverse: its monospace stack has no CJK either, so press-scale type there would
render the hero in a system fallback at 9.5rem.

**Verifying a theme change visually.** No browser driver is installed, but headless
Edge works: `--headless=new --screenshot=out.png --window-size=1440,2100
--virtual-time-budget=9000`. Theme lives in `localStorage`, so hop through a
same-origin scratch page that sets `randomcode.theme` then redirects to
`/?seed=…` (a seed makes the app draw on mount). Delete the scratch file after.

## Conventions

- Commit messages: English, Conventional Commits prefixes (`feat:`, `fix:`, …).
  UI copy and code comments-to-user are Chinese; commits are not.
- UI copy is Chinese. Errors state what happened and what shortens the wait
  (e.g. quota walls show a live countdown), rather than apologizing.
- GitHub Actions: pin to the newest major, verified via
  `gh api repos/actions/<name>/releases/latest --jq .tag_name` rather than recall.
- A user token, if provided, lives in `localStorage` only — never in code, `.env`,
  or the build output.
