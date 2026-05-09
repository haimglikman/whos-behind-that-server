# Who's Behind That? — Server Changelog

### v1.3.1 — bug fix (server) | Main file: v1.7.2
- Fixed Instagram actor research: authorHandle now extracted from oEmbed author_url
- Handle correctly passed to frontend so "research this actor" prompt appears

## v1.3.0
**Main file: v1.6.2**
- **Batched scoring:** Entities now scored in batches of 10 instead of all 50 at once — each entity gets full Claude attention, dramatically improving consistency.
- **Deterministic output:** `temperature: 0` added to all Claude API calls — same input now produces the same output every time.
- **Wider scoring net:** Internal scoring threshold lowered to 60% (frontend still displays 85%+) so reasoning is available for moderate matches and marginal cases don't randomly flip between shown and hidden.
- **Parallel batches:** Batch calls run simultaneously via `Promise.all` keeping latency comparable to a single call.

## v1.2.2 — bug fix
**Main file: v1.6.2**
- Added `SERVER_VERSION` constant at top of file — version is now tracked in code and returned by the health check endpoint (`GET /`).
- Added inline changelog comment block to file header for easy reference when viewing the file directly.

## v1.2.1 — bug fix
**Main file: v1.6.2**
- Fixed missing `app.listen()` opening line that caused Render to exit with status 1 on every deploy attempt.

## v1.2.0
**Main file: v1.6.0**
- **Actor research endpoint:** Added `POST /research-actor` — accepts a social media handle and URL, uses Claude to perform an OSINT lookup and return the actor's name, biographical summary, location, and known handles/websites.

## v1.1.1 — bug fix
**Main file: v1.4.0**
- Updated Claude scoring weights: hidden interest 55%, modus operandi 35%, public narrative 10%.
- Claude now instructed to score interest independently of whether the entity publicly claims involvement.

## v1.1.0
**Main file: v1.4.0**
- **Narrative alignment framing:** Scoring prompt rewritten — question is now whose agenda a post serves and what it leaves out, not whether it is manipulative.
- **Missing context field:** Claude now returns a `missing` field per entity match describing what relevant facts or counter-narrative the post conspicuously omits.

## v1.0.0
**Main file: v1.3.0**
- Initial server deployment.
- Express server with CORS configured for GitHub Pages domains and localhost.
- X (Twitter) fetcher using free oEmbed API — no API key required.
- Facebook fetcher using oEmbed with Open Graph meta scraping as fallback.
- Instagram fetcher using oEmbed with Open Graph meta scraping as fallback.
- `/fetch-and-analyze` endpoint: one-shot fetch + Claude scoring.
- `/analyze` endpoint: Claude scoring for manually pasted text.
- `/fetch-post` endpoint: fetch post text only without scoring.
- Claude scoring engine with per-entity narrative, interest, and MO scores.
- `ANTHROPIC_API_KEY` stored as Render environment variable — never exposed to the browser.
