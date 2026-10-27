# Who's Behind That? — Engineering Decisions

**Doc version:** 1.2.0 · Reflects server v2.7.0.2 · admin v2.30.1 · client v1.20.0 · chatbot v1.2.3.2

Key decisions behind WBT, in chronological order. Each entry covers the problem, what was tried, what was chosen, and the result. Version numbers refer to the component changelogs.

---

## 1. Move AI calls behind a server proxy
**Server v1.0.0 · Admin v1.3.0**

**Problem:** The first version ran entirely in the browser. Users had to paste post text by hand (browsers can't fetch social platforms because of CORS) and enter their own API keys.

**Decision:** Add a Node/Express server on Render that fetches post content from a URL and calls Claude, with the Anthropic key stored only as a server environment variable.

**Outcome:** Users just paste a URL, with no setup and no keys. Manual paste stays as the fallback for private or deleted posts.

---

## 2. Reframe from "manipulation detection" to "narrative alignment"
**Server v1.1.0 · Admin v1.4.0**

**Problem:** Labeling content "manipulative" is a judgment the model can't make reliably or fairly, and it framed the tool as an accuser.

**Decision:** Change the question to *whose agenda does this post serve, and what does it leave out?* Every match now includes a "missing context" field. The UI moved from a danger scale to an intensity scale.

**Outcome:** This became the product's core concept. Every later feature (primary / secondary alignment, clusters, carousels) builds on it.

---

## 3. Make scoring consistent: batching and determinism
**Server v1.3.0**

**Problem:** Scoring 50 entities in a single call gave inconsistent results, and the same post could score differently on each run.

**Decision:** Score entities in parallel batches of 10 (`Promise.all`), set `temperature: 0`, and lower the internal threshold so borderline matches don't flip in and out of the results. If parallel calls hit rate limits, they fall back to sequential.

**Outcome:** Repeatable results without extra latency.

---

## 4. Shared history in PostgreSQL
**Server v1.5.0**

**Problem:** Scans existed only in each browser's local storage, so nothing could be compared across devices or users.

**Decision:** Store every scan in Neon PostgreSQL with a traceable scan ID that encodes the date, app version and server version. Tables are created automatically on startup. If the DB is unreachable, the server keeps serving everything else.

**Outcome:** Admin gets a full cross-user view, and every result can be traced to the exact release that produced it.

---

## 5. Pre-translate Hebrew and Arabic
**Server v1.7.0–v1.7.1, v1.12.3**

**Problem:** Hebrew posts produced zero alignment even when they clearly named known actors. Political slang, ranking lists ("X over 1,000 Y") and intra-coalition criticism were misread.

**Decision:** Translate and summarize non-Latin posts with explicit political context before scoring. Add prompt rules: criticism is not alignment, ranking lists count as preference, and posts are read literally unless irony is explicit.

**Outcome:** Hebrew and Arabic posts score reliably. Translation is still a step in the current engine.

---

## 6. Fix Hebrew/Arabic JSON failures by changing the architecture, not by patching
**Server v1.22.12–v1.23.0**

**Problem:** Claude's JSON responses broke when Hebrew or Arabic text inside string values contained unescaped quotes or control characters.

**What was tried:** Four rounds of increasingly aggressive JSON repair: sanitizing, regex extraction, character-by-character quote repair, and string-aware parsing. Raising `max_tokens` fixed a separate truncation issue. Each round reduced failures but didn't eliminate them.

**Decision:** Split scoring into two calls. *Phase 1* returns numbers only, so no free text can break the JSON. *Phase 2* adds the explanations in English only, and is non-fatal: if it fails, the scores still stand.

**Outcome:** The parse errors were eliminated, not just mitigated. The lesson: when a failure keeps recurring, change the output contract instead of hardening the parser.

---

## 7. Resilient news fetching
**Server v1.22.8–v1.22.11**

**Problem:** Many news sites block automated requests, and a hard-coded domain whitelist rejected legitimate outlets.

**Decision:** Fetch in three tiers (basic headers → full browser-like headers → Archive.org fallback), and attempt any URL with a non-root path instead of relying on the whitelist.

**Outcome:** Broad coverage of Israeli and international outlets, with a clear error suggesting manual paste when every tier fails.

---

## 8. Prompts as data, not code
**Server v1.22.3–v1.22.5**

**Problem:** Every prompt change required a server redeploy.

**Decision:** Store prompts in the DB with version history and a model per prompt. Edit and activate them live from admin, and keep an in-memory cache that refreshes on save.

**Outcome:** Prompt iteration went from a deploy cycle to a save button, and every prompt version is auditable.

---

## 9. Separate dev and production environments
**First production release: server v1.22.0 · client v1.16.0 · admin v2.14.0**

**Problem:** Building large features directly on the live system put users at risk.

**Decision:** Run parallel `-dev` repos and deployments for client, admin and server. Major features (cluster investigation, the v2 scoring engine, comment analysis) are built and tested there before being promoted to production.

**Outcome:** Features can be explored and dropped without touching production. Comment alignment, for example, was built in dev and never shipped.


---

## 10. Video transcription: three approaches before it worked
**Server v1.26.0–v1.28.0**

**Problem:** Video posts (TikTok, Reels, YouTube, X) carry their message in speech, not text.

**What was tried:**
- YouTube: an npm transcript package and YouTube's timedtext endpoints both failed before TranscriptAPI proved reliable.
- Other platforms: a self-hosted Cobalt service extracted audio for Groq Whisper. It needed keep-alive pings on Render's free tier and suffered from expiring tunnel URLs and 0-byte audio. Fixing it took a long run of patch releases (v1.26.1–v1.26.6).

**Decision:** Drop Cobalt and use a standalone yt-dlp binary, downloaded at runtime, with Groq Whisper. This adds no Python, no ffmpeg and no npm dependencies. Video scans also include the creator's caption, hashtags and account, plus a note on what transcripts can't capture.

**Outcome:** One less service to run, and video coverage across all supported platforms, including Telegram.

---

## 11. Scoring engine v2: Jev screens, Claude judges
**Server v2.0.0–v2.0.5**

**Problem:** Asking one model to score every entity was expensive and noisy, and the Sonnet 4.x models in use were being deprecated. The goal was better results at lower cost.

**Decision:** Split the work by each model's strength:
- **Jev** (a classification model) screens all entities in a single request, using only literal questions: *mentioned, criticized, praised*.
- **Claude Opus** judges the shortlist in one structured-output call. It also receives a names-only list of the other entities so it can add beneficiaries the post never names (for example, the opposition, when a post criticizes the government).
- Score calibration anchors are built into the prompt, and the final score is computed in code.

**Design details:**
- An early design asked Jev to infer *benefit*. It was redesigned so Jev answers only literal questions and Claude decides who benefits.
- Without calibration anchors, Opus scored clear alignments around 60, which broke the display threshold. Explicit 0–100 anchors restored it.
- Opus rejected forced tool calls. Claude calls now detect per-model restrictions, remember them, and skip the failing attempt on later calls.
- No models are hard-coded; each task's model is configurable. If Jev fails, the server falls back to sending every entity to the judge.

**Outcome:** One engine replaced batch scoring, Phase 2 enrichment and the coherence check. Every scan records the models and Jev tokens it used. It was built and tested in dev, then shipped as v2.0.5.

---

## 12. Clusters that can't be gamed by chaining
**Server v1.22.2, v2.2.0**

**Problem:** Posts that only share a news cycle looked "connected", and chains of pairwise links could merge unrelated narratives into one cluster.

**Decision:** Filter out weak connections, and exclude same-day posts from opposing camps about the same event. Clusters of three or more posts get a membership review. Coordination evidence (near-identical wording, same account, shared links and hashtags, bot-flagged authors) is computed deterministically in code and leads the synopsis.

**Outcome:** Clusters reflect real narrative coordination, with evidence a reader can verify.

---

## 13. Version discipline across three components
**Throughout**

**Decision:**
- Each component is versioned independently.
- Every changelog entry names the matching versions of the other two components.
- Versions only move forward: a rollback ships as a new version.
- Discarded or never-deployed versions are marked as such in the changelog.

**Outcome:** Any scan, bug report or deployment can be traced to an exact combination of client, admin and server.

---

## 14. Protect operator endpoints and enforce quotas on the server
**Server v2.6.0 · Admin v2.29.0**

**Problem:** The frontends are static pages and all three repos are public, so every server endpoint is visible. Anyone could call the write endpoints directly to change prompts, entities or the FAQ, or download every user's scan history. The 10-scans-a-day limit was enforced only in the browser, so direct API calls had no cost ceiling. CORS didn't help, because it only restricts browsers.

**Decision:**
- Operator endpoints require an `X-Admin-Key` header matching the `ADMIN_KEY` environment variable, compared in constant time. That covers writes, AI-cost operator actions, and reads that expose all users' data. If the variable is missing, those endpoints refuse every request rather than running unprotected.
- The admin page asks for the key once and keeps it in that browser only, never in the public HTML. A small fetch interceptor attaches it to every request to the WBT server.
- Daily quotas move to the server, stored in a `usage_quota` table so they survive restarts: 10 scans per device and 30 per IP (the IP cap catches device-ID resets), with only successful scans counted, plus 20 investigation calls per IP. Device IDs and IPs are stored hashed. Admin requests are exempt.
- All of this lives in two middleware functions in one place, so no route handler changed and the client needed no update.

**Outcome:** The public API now does only what the public client needs. Operator actions need the key, and AI spend has a hard ceiling per device and per IP.

---

## 15. Keep the runtime and dependencies patched without manual work
**Server v2.7.0.2 · Chatbot v1.2.3.2 (documentation of the setup)**

**Problem:** A vulnerability review surfaced two gaps. First, HTTP2Shell (CVE-2026-111497), a flaw in Node.js's Brotli decoder, applied to WBT because the server fetches user-submitted URLs, yet Render had frozen the services on the Node version current when each was created. Second, `npm audit` reported 4 vulnerabilities (1 moderate, 2 high, 1 critical). With no lockfile, `npm install` kept reusing old sub-dependencies from Render's build cache.

**Decision:**
- Pin Node with `NODE_VERSION=^24.22.1`: always the newest 24.x patch, never an untested new major.
- Redeploy every service weekly through Render deploy hooks, triggered from cron-job.org on Friday mornings and staggered per service, so new Node patches and the latest yt-dlp arrive without a code change.
- Commit `package-lock.json` and build with `npm ci`, so every deploy is a clean install of exactly the locked versions.
- Turn on Dependabot alerts, security updates, malware alerts and grouped security updates, with a simple merge → deploy → verify → revert-if-broken flow.
- Apply the same setup to the chatbot.

**Outcome:** Clearing the stale cache took the audit from 4 vulnerabilities to 0, and the first `npm ci` deploy reported "found 0 vulnerabilities". Runtime patches and dependency fixes now arrive on a schedule or as reviewable PRs, rather than depending on someone remembering to check.

