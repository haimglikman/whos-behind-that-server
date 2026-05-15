# Who's Behind That? — Server Changelog

### v1.8.3 — bug fix (server) | Main file: v1.12.1
- Instagram auto-fetch removed — Instagram blocks all automated access
- Facebook retains Claude web search auto-fetch

### v1.8.2 — bug fix (server) | Main file: v1.12.0
- Fixed Claude web search not actually calling the tool (was responding from memory)
- Added tool_choice: any to force tool use before responding
- Added proper multi-turn handling: tool_use → tool_result → final answer

### v1.8.1 — bug fix (server) | Main file: v1.12.0
- Fixed Instagram/Facebook response parsing: three-tier extraction (clean parse → regex → raw text fallback)
- Added debug logging so Render logs show exactly what Claude returns
- Increased web search max_tokens from 1000 to 2000

### v1.8.0 — bug fix update NO VERSION UPDATE
- Fixed duplicate fetchFromFacebook declaration causing server startup failure

### v1.8.0 (server) | Main file: v1.12.0
- Instagram and Facebook fetching replaced with Claude web_search tool
- Removes dependency on broken oEmbed and OpenGraph scraping
- Falls back to manual text if post is private or requires login

### v1.7.1 — bug fix (server) | Main file: v1.11.0
- Added pre-translation step: Hebrew/Arabic posts translated + summarized with political context before scoring
- Fixes zero alignment on Hebrew settler/opposition posts that correctly identified entities in the vocabulary but failed to match
- Translation runs only when >10 non-Latin characters detected — English posts unaffected

### v1.7.0 (server) | Main file: v1.11.0
- Language-aware scoring: prompt now handles English, Hebrew, and Arabic with vocabulary glossary
- Intra-coalition criticism rule: settler/Ben Gvir posts criticizing Netanyahu no longer flag Netanyahu as aligned
- Coherence check updated with finer coalition distinction logic

### v1.6.0 (server) | Main file: v1.10.0
- Coherence check: second Claude call after batch scoring filters rival-bloc entities
- Post serving Israeli opposition no longer flags Iran/Hamas as co-alignments
- Relationship context (Axis of Resistance, Israeli opposition coalition, US pro-Israel bloc etc.) passed to coherence prompt
- Graceful fallback to raw scores if coherence check fails

### v1.5.1 — bug fix (server) | Main file: v1.9.0
- Fixed silent PostgreSQL failure: connection errors now logged explicitly to Render logs
- Added SELECT 1 connection test on startup to verify database is reachable
- Graceful fallback: if connection fails, server sets db=null and continues serving all other endpoints
- Accurate health check: "db": true/false now correctly reflects whether connection succeeded

### v1.5.0 (server) | Main file: v1.9.0 - FIX WITHOUT VERSION UPDATE
- Shared history: all scans saved to PostgreSQL and visible to all users across all devices
- Scan IDs in format WBT-{date}-{appVer}-{srvVer}-{random}
- App and server version logged per scan for tracing issues to specific releases
- Comments field per scan, editable inline, synced to server
- New endpoints: POST /history/save, GET /history/list, PATCH /history/comment
- Auto table creation: scans table created on first server start, no manual DB setup needed
- New dependency: pg added to package.json — update both files when deploying

### v1.5.0 (server) | Main file: v1.9.0
- PostgreSQL integration: /history/save, /history/list, /history/comment endpoints
- Auto-creates scans table on first run
- DATABASE_URL environment variable support
- New dependency: pg (PostgreSQL Node.js client)

### v1.4.1 — bug fix (server) | Main file: v1.8.1
- alignment field now mandatory on every match — was being omitted causing all to show as primary
- Added "criticism ≠ alignment" rule to prompt — post attacking Netanyahu no longer scores as Netanyahu-aligned

### v1.4.0 (server) | Main file: v1.8.0
- Scoring prompt updated with primary/secondary alignment classification
- Claude now distinguishes between entities a post was written for vs entities that indirectly benefit
- Max 3 primary, 2 secondary enforced in prompt

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
