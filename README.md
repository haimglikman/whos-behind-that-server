# Who's Behind That? — Server Changelog

### v1.22.6 — bug fix (server) | Admin: v2.16.0 | Client: v1.17.2
- Fixed SyntaxError: const declarations were placed inside fetch() object literal — moved before the fetch call

### v1.22.5 — bug fix (server) | Admin: v2.16.0 | Client: v1.17.2
- Fixed DB prompts sending template variables as literal strings (${postText}, ${postsText} etc) — added interpolatePrompt() helper that resolves all placeholders before sending to Claude
- Applies to all 6 prompts: scan, coherence, connection, synopsis, actor, convergent

### v1.22.4 — bug fix (server) | Admin: v2.15.0
- Fixed ReferenceError on startup: promptCache was calling getModel() during its own initialization

### v1.22.3 (server) | Admin: v2.14.3
- Prompt management system: new prompts table in DB
- GET /prompts/list, GET /prompts/history/:name, POST /prompts/save, POST /prompts/activate/:id
- In-memory prompt cache — loaded from DB on startup, refreshed immediately when admin saves
- All 6 prompts (scan, coherence, connection, synopsis, actor, convergent) now use model from cache

### v1.22.2 (server) | Admin: v2.14.2 | Client: v1.16.2 - NEVER TRIED, JUMPED DIRECTLY TO 1.22.3
- Cluster detection: weak connections now filtered out — only medium and strong connections form clusters
- Cluster detection: prompt tightened to explicitly exclude same-day posts about the same event from opposing camps (news cycle proximity is not a connection)

### v1.22.1 (server) | Admin: v2.14.2 | Client: v1.16.2
- Added entities table to DB
- GET /entities/list — returns current entity list with version
- POST /entities/save — stores entity list from admin

### v1.22.0 (server — live) | Admin: v2.14.0 | Client: v1.16.0 
- First live production release — based on dev v1.21.0
- All YouTube features, cluster investigation, FAQ, cross-device reconstruction

### v1.16.2 — bug fix (server) | Admin: v2.10.2 | Client: v1.12.0
- Strip citation markup injected by web_search tool from actor bio field before returning

### v1.16.1 — bug fix (server) | Admin: v2.10.1 | Client: v1.10.2
- Refresh endpoint now uses Promise.allSettled — one entity failure no longer aborts the entire batch
- Graceful JSON parse error handling per entity — returns changed:false instead of throwing

### v1.16.0 (server) | Admin: v2.10.0 | Client: v1.10.2
- New POST /entities/refresh endpoint: takes array of entities, queries Claude with web search for each in batches of 5, returns changed fields and descriptions

### v1.15.1 — bug fix (server) | Admin: v2.9.4 | Client: v1.9.3
- Fixed actor research failing with JSON parse error when Claude adds preamble text before the JSON response — now extracts JSON robustly regardless of surrounding text

### v1.15.0 (server) | Admin: v2.8.0 | Client: v1.9.1
- Token tracking: all Claude API calls log input/output token counts
- input_tokens/output_tokens columns added to scans and actors tables
- New GET /stats endpoint: token totals broken down by post scans (admin/client) and actor scans
- Token counts included in fetch-and-analyze and research-actor API responses

### v1.14.0 (server) | Admin: v2.7.0 | Client: v1.9.0
- Entity format in scoring prompt compacted: shorter field labels, reduced char limits, comments omitted when empty
- ~15-20% fewer input tokens per scan, no impact on scoring quality

### v1.13.0 (server) | Admin: v2.7.0 | Client: v1.8.0
- News domain detection: 60+ outlets across Israeli and international press
- Article scraping: tries article body selectors, falls back to OpenGraph meta tags
- Hybrid publication research: static DB with 35+ major outlets (instant, no tokens), Claude web search for unknown outlets
- Actor research updated: includes publication profile for news URLs, uses web_search tool for better actor results
- New actors table in PostgreSQL: stores all actor searches with source, deviceId, actor/publication data
- New GET /actors/list endpoint for admin history sync

### v1.12.4 — bug fix (server) | Admin: v2.3.1 | Client: v1.5.1
- Added whosbehindthat.com and admin.whosbehindthat.com to CORS allowed origins

### v1.12.3 — bug fix (server) | Admin: v2.3.1 | Client: v1.5.1
- Translation prompt now explicitly extracts who is praised vs attacked, and interprets ranking/preference lists politically
- Fixes zero-alignment on Hebrew list posts (e.g. "Netanyahu 1 over 1,000,000,000 Bennett/Lapid/Golan")

### v1.12.2 — bug fix (server) | Admin: v2.3.1 | Client: v1.5.1
- X oEmbed fetcher now reconstructs proper username URL using author_url from oEmbed response
- Normalized URL returned in API response so both frontends store the correct URL

### v1.12.1 (server) | Admin: v2.3.0 | Client: v1.5.0
- Beneficiary chain rule: when a post attacks Entity A, A's documented rivals now score high even if never mentioned in the post — fixes zero-alignment on posts that only attack rivals
- Preference/ranking list rule: "X over 1000 Y" correctly scores X high, not just Y low
- Sarcasm detection rule: assume literal intent unless explicit Hebrew/English irony markers are present — prevents genuine political posts from being misread as sarcastic

### v1.12.0 (server) | Admin: v2.3.0 | Client: v1.4.0
- Scoring engine: context analysis added — when a post explicitly attacks a named rival, the rival's political beneficiaries are scored accordingly. Single unified score. Only applied when attack is central and rival relationship is documented.
- Facebook fetcher: tries 3 different user agents before failing, falls back to Claude web search if all OpenGraph attempts fail

### v1.11.1 — bug fix (server) | Admin: v2.2.1 | Client: v1.2.1
- No server code changes — version bump to log client fix

### v1.11.0 (server) | Admin v2.0.0 / Client v1.0.1
- source and device_id columns added to scans table
- history/save accepts and stores source + deviceId
- history/list supports source and deviceId filter params
- Device IDs hashed to usr_XXXX for privacy
- clientUsers array returned for admin filter dropdown

### v1.10.4 — bug fix (server) | Main file: v1.13.2
- OpenGraph scraper follows redirects — fixes Facebook share URLs
- Added meta[name="description"] fallback
- Minimum text threshold lowered from 200 to 100 chars

### v1.10.3 — bug fix (server) | Main file: v1.13.1
- Facebook fetcher switched from Claude web search to OpenGraph scraping
- More reliable for public posts, no extra API cost
- Instagram fetcher unchanged

### v1.10.2 — bug fix (server) | Main file: v1.13.1
- Convergent interest threshold raised: confidence ≥ 9/10 required
- Explicit anti-examples added to prompt (Ben Gvir + Iran = illegitimate)
- "Opposing something" no longer qualifies as convergent interest

### v1.10.1 — bug fix (server) | Main file: v1.13.0
- Switched from puppeteer to puppeteer-core — fixes Render build failure
- Added /convergent-interest endpoint
- History filters via query params on /history/list
- Platform column added to scans table

### v1.10.0 (server) | Main file: v1.13.0
- POST /convergent-interest endpoint: finds hidden shared interests between rival entities
- History filters via query params on GET /history/list
- Platform column added to scans table (ALTER TABLE adds it to existing tables)
- history/save now stores platform field

### v1.9.0 (server) | Main file: v1.12.3
- Instagram fetching now uses Puppeteer headless browser for full text extraction
- Puppeteer executes JavaScript like a real browser, bypassing OpenGraph truncation
- Falls back to OpenGraph scraping if Puppeteer fails
- New dependency: puppeteer — update package.json alongside server.js

### v1.8.5 — bug fix (server) | Main file: v1.12.3
- Added minimum text length check: fetched text under 200 chars triggers manual fallback
- Prevents OpenGraph title-only results from being sent to scoring engine silently

### v1.8.4 — bug fix (server) | Main file: v1.12.3
- Restored Instagram oEmbed + OpenGraph scraping that worked before v1.8.0
- Restored scrapeOpenGraph function that was accidentally removed
- Manual fallback still shown if fetch fails

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
