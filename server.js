// Who's Behind That? — Proxy Server
// Handles: post text fetching, Claude AI scoring, shared history (PostgreSQL)
// Deploy to Render.com (free tier)
//
// ─────────────────────────────────────────────
// CHANGELOG
// ─────────────────────────────────────────────
// v1.21.1 — Entity DB: added entities table, GET /entities/list and
//            POST /entities/save endpoints. Admin pushes entities on every
//            save/refresh/import. Client loads entities on page load.
//
// v1.24.0 — New feature: fetchFromNews now extracts og:image, og:title
//             alongside article text and author — enables carousel post slides
//             to show article headline, thumbnail and source favicon.
//
// v1.23.1 — Performance: Phase 2 enrichment now runs once for ALL top
//             matches combined (was once per batch). Parallel batches already
//             in place. Rate limit fallback: if 429, retries sequentially.
//
// v1.23.0 — New two-phase scoring architecture:
//             Phase 1: numbers-only JSON (no text fields, no Hebrew/Arabic
//             in JSON values) — eliminates JSON parse errors on Hebrew content.
//             Phase 2: separate enrichment call for why/missing fields,
//             explicitly English-only output.
//             Phase 2 failure is non-fatal — scores remain valid.
//
// v1.22.17 — Rewrote extractJSON.
//
// v1.22.16 — Added stop_reason logging.
//
// v1.22.15 — Increased max_tokens for scan and coherence.
//             to prevent truncated JSON responses when entity database is large.
//
// v1.22.14 — Fixed JSON parsing in coherenceCheck and scoreBatch.
//             using plain JSON.parse instead of extractJSON, causing failures
//             on Hebrew/Arabic content. Now use extractJSON with raw logging.
//
// v1.22.13 — Improved extractJSON.
//             quote repair for unescaped quotes inside Hebrew/Arabic strings.
//             Added raw response logging on all parse failures.
//
// v1.22.12 — Hardened extractJSON.
//             char sanitization, then regex field extraction fallback.
//             Fixes "Unexpected non-whitespace character" errors on Hebrew/Arabic
//             content with embedded newlines or special chars in JSON strings.
//
// v1.22.11 — Smart URL detection.
//             news fetching (3-tier) instead of returning "Unsupported URL".
//             NEWS_DOMAINS whitelist still used for fast-path detection but
//             no longer the only way to trigger news fetch.
//
// v1.22.10 — Added missing news domains.
//             that were returning "Unsupported URL" instead of attempting fetch.
//
// v1.22.9 — Added error logging to news fetch tiers.
//
// v1.22.8 — Three-tier news article fetching.
//            Tier 1: basic headers (existing approach, 3 user agents).
//            Tier 2: full browser-like headers (sec-ch-ua, Sec-Fetch-*, Referer
//            google.com) to bypass aggressive anti-bot measures.
//            Tier 3: Archive.org fallback for blocked/paywalled articles.
//            extractArticle() and enrichWithYoutube() extracted as helpers.
//
// v1.22.7 — Client session tracking.
//            POST /client/register (called on client page load),
//            GET /client/sessions (returns all known versions with device count).
//
// v1.22.6 — bug fix: SyntaxError in synopsis prompt interpolation.
//            object literal. Moved before the fetch call.
//
// v1.22.5 — bug fix: DB prompts template variables sent as literal strings.
//            sent as literal strings. Added interpolatePrompt() helper that
//            resolves all ${var} placeholders before sending to Claude.
//            Affects all 6 prompts: scan, coherence, connection, synopsis,
//            actor, convergent.
//
// v1.22.4 — bug fix: promptCache ReferenceError on startup.
//            causing ReferenceError on startup. Fixed by using plain string
//            defaults in promptCache object literal.
//
// v1.22.3 — Prompt management system.
//            - New prompts table in DB (name, version, model, prompt_text, is_active)
//            - GET /prompts/list, GET /prompts/history/:name, POST /prompts/save,
//              POST /prompts/activate/:id endpoints
//            - In-memory prompt cache loaded from DB on startup
//            - All 6 prompts (scan, coherence, connection, synopsis, actor,
//              convergent) now use model from cache; admin can edit via UI
//
// v1.22.2 — Tightened cluster connection detection.
//            - Weak connections now filtered out (only medium/strong accepted)
//            - Detection prompt made more explicit: same-day posts about same
//              event from opposing camps are NOT a connection.
//
// v1.21.0 — YouTube performance improvements:
//            - Meta check and transcript fetch now run in parallel (Promise.all)
//              instead of sequentially — saves 300-500ms per scan.
//            - In-memory transcript cache (up to 100 entries) — repeat scans
//              of the same video return instantly without using a TranscriptAPI credit.
//
// v1.20.9 — Fixed TranscriptAPI response parsing.
//
// v1.20.8 — Debug logging.
//            Correct endpoint: /api/v2/youtube/transcript?video_url=...
//            Correct response field: segments[] not transcript[].
//
// v1.20.6 — Switched to TranscriptAPI.com.
//            Clean REST API, handles cloud IP blocking, 100 free credits/month.
//            Requires transcriptapi_API_KEY env var on Render.
//
// v1.20.5 — Switched to page HTML approach.
//            caption track baseUrl from ytInitialPlayerResponse. More reliable
//            than timedtext or innertube API approaches.
//
// v1.20.4 — Switched to YouTube innertube API.
//            same internal API YouTube's own frontend uses, works for ASR
//            (auto-generated) captions without OAuth authentication.
//
// v1.20.3 — Rewrote fetchYoutubeTranscript.
//            across multiple languages first, then falls back to captions API
//            list + srv3. Previous json3 format caused "Unexpected end of JSON"
//            errors on many videos.
//
// v1.20.2 — YouTube scanning limits.
//            - Videos longer than 10 minutes are rejected with a clear message.
//            - Live/streaming videos are rejected with a clear message.
//            Both checks use the YouTube Data API v3 video metadata endpoint.
//
// v1.20.1 — Switched to YouTube Data API v3.
//            package (blocked by YouTube CAPTCHA on cloud IPs) to YouTube Data
//            API v3 + timedtext endpoint. Requires YOUTUBE_API_KEY env var.
//            Removed youtube-transcript dependency from package.json.
//
// v1.20.0 — YouTube transcript support.
//              falls back to manual text entry if no transcript available.
//            - News articles with embedded YouTube videos: transcripts fetched
//              and appended to article text automatically. If no transcript
//              available, analysis proceeds on article text only with a note.
//            - YouTube added as a platform in detectPlatform().
//
// v1.19.4 — bug fix: posts column missing from clusters/list SELECT query.
//            posts were being saved correctly but never returned.
//
// v1.19.3 — clusters store full posts array.
//            overallScore, ts) so admin can reconstruct client clusters without
//            needing client's localStorage.
//
// v1.19.2 — clusters/list device_id filter.
//            passes its own device_id to see only its clusters; admin omits it
//            to see all.
//
// v1.19.1 — seeded 32 default FAQs.
//            Terminology, Scanning logic, Technical, Privacy).
//
// v1.19.0 — connections column, FAQ endpoints.
//            postCount now includes isolated posts; FAQ table + GET /faq/list,
//            POST /faq/save, DELETE /faq/:id endpoints.
//
// v1.18.3 — PATCH /clusters/rename.
//
// v1.18.2 — isolated_post_ids added to clusters.
//            omitted posts identically to the live investigation view.
//
// v1.18.1 — postSummaries added to synthesize.
//            post_summaries column added to clusters table; clusters/save and
//            clusters/list updated accordingly.
//
// v1.18.0 — Clusters history.
//            GET /clusters/list. Cluster IDs generated client-side same format
//            as post IDs (WBT-CLU-...).
//
// v1.17.5 — Buffer-based unicode sanitization.
//            surrogates from Hebrew/Arabic/emoji text in both detect and synthesize.
//
// v1.17.4 — Sanitize post text before sending to API — removes unpaired
//            Unicode surrogates (emoji, Arabic/Hebrew chars) that caused 400 errors.
//
// v1.17.3 — Better error logging in investigate/detect to surface root cause.
//
// v1.17.2 — Fixed extractJSON to handle JSON arrays.
//            investigation detection which returns an array of pair results).
//
// v1.17.1 — Optimized investigation token usage.
//            batches 4 pairs per call, and uses trimmed prompts (~75% cost
//            reduction vs v1.17.0). Stage 2 prompt also trimmed.
//
// v1.17.0 — Investigation endpoints.
//            connection detection per post pair) and POST /investigate/synthesize
//            (Stage 2 — synopsis + cluster name for connected posts).
//
// v1.16.2 — Strip citation markup from actor bio returned by web_search tool.
//
// v1.16.1 — Refresh endpoint: use Promise.allSettled so one entity failure
//            doesn't kill the whole batch; graceful JSON parse error handling.
//
// v1.16.0 — Entity refresh endpoint: POST /entities/refresh takes an array
//            of entities, queries Claude with web search for each, returns
//            changed fields and change descriptions.
//
// v1.15.1 — Robust JSON extraction for actor/publication research.
//            Claude preamble text before JSON (e.g. "Based on my research...").
//
// v1.15.0 — Token tracking: all Claude API calls now log input/output tokens.
//            input_tokens/output_tokens columns added to scans and actors tables.
//            /stats endpoint returns token totals broken down by post/actor/source.
//            Token counts included in fetch-and-analyze and research-actor responses.
//
// v1.14.0 — Entity format compacted for ~15-20% token savings.
//            reduced per-field char limits, comments only when present.
//            ~15-20% fewer input tokens per scan, no impact on scoring.
//
// v1.13.0 — News website support, actors DB, publication research.
//            text via OpenGraph + article body scraping. Hybrid publication
//            research: static DB for 35+ major outlets, Claude web search
//            for unknown outlets. Actor research updated to include
//            publication profile for news URLs. Actors table in PostgreSQL:
//            saves all actor searches with source, deviceId, actor/publication
//            data. New GET /actors/list endpoint for admin history.
//            Actor research now uses web_search tool for better results.
//
// v1.12.4 — Added whosbehindthat.com to CORS allowed origins.
//
// v1.12.3 — Translation prompt improved.
//            (1) Beneficiary chain — when A is attacked, A's rival scores
//            high even if never mentioned. Fixes zero-alignment on posts
//            that only attack rivals without naming the beneficiary.
//            (2) Preference/ranking lists — "X over 1000 Y" scores X high.
//            (3) Sarcasm detection — assume literal intent unless explicit
//            irony markers are present. Don't second-guess genuine posts.
//
// v1.12.0 — Context scoring + Facebook UA improvements.
//
// v1.10.4 — Facebook/Instagram redirect following, lower min text threshold.
//
// v1.9.0  — Instagram fetching via Puppeteer headless browser. Restored
//            oEmbed + OpenGraph scraping with 200-char minimum check.
//            Pre-translation for Hebrew/Arabic. Language-aware scoring.
//            Intra-coalition criticism rule. Entity relationship modeling
//            + coherence check. All changes from app v1.10.x–v1.12.x.
//
// v1.8.0  — Added /research-actor endpoint (Claude OSINT actor lookup).
//
// v1.7.0  — Primary/secondary alignment distinction. "Criticism ≠ alignment"
//            rule. alignment field mandatory on all matches.
//
// v1.6.0  — Batched scoring (10 per call), temperature:0, threshold 60%.
//
// v1.5.1  — Fixed PostgreSQL silent connection failure.
//
// v1.5.0  — Shared history via PostgreSQL. /history/save, /history/list,
//            /history/comment. Scan IDs. Version tracking. Comments field.
//
// v1.4.0  — Scoring prompt rewritten to narrative alignment framing.
//            Added "missing" context field per entity match.
//
// v1.3.0  — Scoring weights: interest 55%, MO 35%, narrative 10%.
//
// v1.2.0  — Core scoring engine: /fetch-and-analyze, /analyze, /fetch-post.
//
// v1.1.0  — Initial deployment: Express, CORS, health check, Anthropic key.
// ─────────────────────────────────────────────

const SERVER_VERSION = '1.26.8';

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import pg from 'pg';
import https from 'https';
import http from 'http';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const TRANSCRIPT_API_KEY = process.env.transcriptapi_API_KEY || '';
const COBALT_URL = process.env.COBALT_URL || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// In-memory prompt cache — loaded from DB on startup, refreshed when admin saves
const promptCache = {
  scan:       { model: 'claude-sonnet-4-5', text: null },
  coherence:  { model: 'claude-sonnet-4-5', text: null },
  connection: { model: 'claude-haiku-4-5-20251001', text: null },
  synopsis:   { model: 'claude-sonnet-4-5', text: null },
  actor:      { model: 'claude-sonnet-4-5', text: null },
  convergent: { model: 'claude-sonnet-4-5', text: null }
};

// Seed default prompts on first boot
const DEFAULT_PROMPTS = {
  scan: {
    model: 'claude-sonnet-4-5',
    version: '1.0.0',
    text: 'You are a senior analyst specializing in geopolitical influence operations, information warfare, and social media manipulation. [FULL SCAN PROMPT — loaded from DB]'
  },
  coherence: { model: 'claude-sonnet-4-5', version: '1.0.0', text: 'You are a senior geopolitical analyst. A scoring engine has identified the following entities as potentially aligned with a social media post. [FULL COHERENCE PROMPT — loaded from DB]' },
  connection: { model: 'claude-haiku-4-5-20251001', version: '1.0.0', text: 'You are a narrative analyst for Who\'s Behind That?, focused on the Israeli-Palestinian conflict and Israeli domestic politics. [FULL CONNECTION PROMPT — loaded from DB]' },
  synopsis: { model: 'claude-sonnet-4-5', version: '1.0.0', text: 'Narrative analyst for Who\'s Behind That? (Israeli-Palestinian conflict / Israeli politics). [FULL SYNOPSIS PROMPT — loaded from DB]' },
  actor: { model: 'claude-sonnet-4-5', version: '1.0.0', text: 'You are an open-source intelligence (OSINT) researcher. [FULL ACTOR PROMPT — loaded from DB]' },
  convergent: { model: 'claude-sonnet-4-5', version: '1.0.0', text: 'You are a senior geopolitical analyst. A social media post primarily serves: [entities]. [FULL CONVERGENT PROMPT — loaded from DB]' }
};

async function loadPromptsFromDB() {
  if (!db) return;
  try {
    const count = await db.query(`SELECT COUNT(*) FROM prompts`);
    if (parseInt(count.rows[0].count) === 0) {
      console.log('No prompts in DB — admin must seed them via the Prompts tab.');
    }
    const result = await db.query(
      `SELECT DISTINCT ON (name) name, model, prompt_text FROM prompts WHERE is_active=TRUE ORDER BY name, created_at DESC`
    );
    result.rows.forEach(r => {
      if (promptCache[r.name]) {
        promptCache[r.name].model = r.model;
        promptCache[r.name].text = r.prompt_text;
      }
    });
    console.log('Prompts loaded from DB:', result.rows.length);
  } catch(e) { console.warn('Could not load prompts from DB:', e.message); }
}

function interpolatePrompt(template, vars) {
  return template.replace(/\$\{([^}]+)\}/g, function(match, key) {
    const val = vars[key];
    return val !== undefined ? String(val) : match;
  });
}

function getPrompt(name) {
  return promptCache[name]?.text || null;
}
function getModel(name) {
  return promptCache[name]?.model || 'claude-sonnet-4-5';
}

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ── PostgreSQL connection
// DATABASE_URL must be set in Render environment variables
let db = null;
if (process.env.DATABASE_URL) {
  console.log('DATABASE_URL found, connecting to PostgreSQL...');
  try {
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
    console.log('PostgreSQL pool created.');
  } catch(e) {
    console.error('Failed to create PostgreSQL pool:', e.message);
    db = null;
  }
} else {
  console.warn('DATABASE_URL not set — history endpoints will be unavailable');
}

// ── CORS
const ALLOWED_ORIGINS = [
  /^https:\/\/.*\.github\.io$/,
  /^https:\/\/(.*\.)?whosbehindthat\.com$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.some(r => r.test(origin))) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '2mb' }));

// ── Auto-create scans table on startup
async function initDB() {
  if (!db) { console.warn('Skipping DB init — no pool available'); return; }
  try {
    await db.query('SELECT 1');
    console.log('PostgreSQL connection test passed.');
    await db.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        url TEXT NOT NULL,
        platform TEXT,
        source TEXT DEFAULT 'admin',
        device_id TEXT,
        post_text TEXT,
        overall_score INTEGER,
        overall_label TEXT,
        top_matches TEXT[],
        text_ai INTEGER,
        has_image BOOLEAN DEFAULT FALSE,
        app_version TEXT,
        server_version TEXT,
        comment TEXT DEFAULT '',
        full_result JSONB
      );
    `);
    await db.query(`ALTER TABLE scans ADD COLUMN IF NOT EXISTS platform TEXT;`);
    await db.query(`ALTER TABLE scans ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0;`);
    await db.query(`ALTER TABLE scans ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0;`);
    await db.query(`ALTER TABLE actors ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0;`);
    await db.query(`ALTER TABLE actors ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0;`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS actors (
        id TEXT PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        handle TEXT NOT NULL,
        source TEXT DEFAULT 'admin',
        device_id TEXT,
        app_version TEXT,
        server_version TEXT,
        actor_data JSONB,
        publication_data JSONB,
        url TEXT
      );
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS clusters (
        id TEXT PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cluster_name TEXT,
        synopsis TEXT,
        dominant_entity TEXT,
        connection_type TEXT,
        frame TEXT,
        event TEXT,
        post_ids TEXT[],
        isolated_post_ids TEXT[],
        post_summaries JSONB,
        connections JSONB,
        posts JSONB,
        post_count INTEGER,
        source TEXT DEFAULT 'admin',
        device_id TEXT,
        app_version TEXT,
        server_version TEXT
      );
      CREATE TABLE IF NOT EXISTS faq (
        id SERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        faq_group TEXT DEFAULT 'General',
        sort_order INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT TRUE
      );
      CREATE TABLE IF NOT EXISTS prompts (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0.0',
        model TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT DEFAULT 'admin',
        version TEXT DEFAULT '1.0.0'
      );
      CREATE TABLE IF NOT EXISTS client_sessions (
        device_id TEXT PRIMARY KEY,
        client_version TEXT NOT NULL,
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Seed default FAQs if table is empty
    const faqCount = await db.query(`SELECT COUNT(*) FROM faq`);
    if (parseInt(faqCount.rows[0].count) === 0) {
      const faqs = [
        // Terminology
        [1,'What is an entity?','An entity is any political actor, organization, government, movement, or ideological group whose interests the tool tracks. Examples include Benjamin Netanyahu, The Palestinian Authority, The US government, the IDF, or the Israeli protest movement. Each entity has a defined profile — their known interests, tactics, and public narrative — that the AI uses to score whether a given post serves their agenda.','Terminology',1],
        [2,'What is an actor?','An actor is the person or account behind a specific post — the author. When you research an actor, Who\'s Behind That? builds a profile of who they are: their background, known affiliations, political stance, and online presence. For news articles, actor research also profiles the publication itself — its editorial line, ownership, and known biases.','Terminology',2],
        [3,'What is primary vs secondary alignment?','Primary alignment means the post actively serves an entity\'s interests — its framing, message, or targets work in their favor. Secondary alignment means the entity benefits indirectly — the post wasn\'t necessarily crafted for them, but spreading it helps them nonetheless. Think of primary as "this post works for them" and secondary as "they\'d be happy this post exists." Important to note: alignment does not mean the post was commissioned by the entity, that the author works for them, or that there\'s any direct connection — it simply reflects whose interests the content serves, intentionally or not.','Terminology',3],
        [4,'What is Hidden Convergent Interest?','Hidden Convergent Interest is when two entities that are normally on opposite sides of the conflict both benefit from the same post — even if neither is the obvious intended audience. It reflects the idea that in a complex political landscape, a single piece of content can serve multiple agendas simultaneously, sometimes in ways that aren\'t immediately obvious. When Who\'s Behind That? detects this, it flags it as a separate finding so you can see not just who the post was likely written for, but also who quietly benefits from it being spread.','Terminology',4],
        [5,'What is a Frame?','A Frame is the wide, ongoing context that a post sits within — broader than a single event, it\'s the overarching situation that gives the content its meaning. Examples include "the war with Iran" or "the Israeli elections." A Frame can contain many Events, and understanding which Frame a post belongs to helps identify whether it connects to other posts about the same situation.','Terminology',5],
        [6,'What is an Event?','An Event is a specific, time-bounded happening that readers will immediately recognize — something like October 7th, the Nasrallah assassination, or the Hezbollah pager attack. Events sit within a broader Frame. A post scored as being "about" a particular Event is a candidate for connection with other posts about the same Event.','Terminology',6],
        [7,'What is a Connection?','A Connection is the specific relationship detected between exactly two posts — what ties them together narratively. A connection exists when two posts share the same framing goal, show signs of coordination, reinforce each other\'s narrative, or form a meaningful pattern together. Not every pair of posts about the same topic has a connection — the relationship needs to be meaningful, not just topical.','Terminology',7],
        [8,'What is a Cluster?','A Cluster is a group of posts that are all meaningfully connected to each other — directly or through shared connections. When you run an investigation, posts that pass the connection threshold are grouped into clusters. Posts that don\'t connect to any others remain isolated and are excluded from the synopsis.','Terminology',8],
        [9,'What is a Synopsis?','A Synopsis is the synthesized narrative output generated for a connected cluster — a short text that describes what story is being told across the posts, what framing pattern emerges, and whose interests it serves. A Synopsis is only generated when real connections are found. If no connections exist in a batch of posts, no Synopsis is produced.','Terminology',9],
        // Scanning logic
        [10,'How does post scanning work?','When you submit a URL, the server automatically fetches the text of the post or article. That text is then analyzed by Claude AI, which scores it against all entities in the database simultaneously. Each entity is evaluated based on whether the post advances their strategic interests, matches their known methods, and echoes their public narrative. The highest-scoring entities above the threshold appear as primary or secondary alignments.','Scanning logic',1],
        [11,'How does actor scanning work?','After a successful post scan, you\'re offered the option to research the account or author behind it. The server looks up publicly available information about them — their background, known affiliations, political stance, and online presence. For news articles, it also profiles the publication: its editorial line, ownership, and known biases. Results are generally accurate for well-known public figures but may be limited for anonymous or low-profile accounts.','Scanning logic',2],
        [12,'Does the scan consider context beyond the post text?','Each scan is based solely on the post or article being analyzed — it is not influenced by the author\'s other posts, past scans, or any external context outside of what\'s in the text itself. That said, the engine considers two dimensions within the post: what it says (content) and who it attacks (context). If a post directly attacks a named political figure, the engine identifies who benefits from that attack and factors that into the score. Actor research is separate — it adds background on the author for your own interpretation, but does not feed back into the post\'s scoring.','Scanning logic',3],
        [13,'Can you scan an actor without scanning a post first?','Not currently — actor research is triggered from a post scan result. This is intentional: Who\'s Behind That? is designed to analyze how content is framed, not to investigate individuals in isolation. The actor profile provides useful background for interpreting a specific scan, but the post itself is always the starting point.','Scanning logic',4],
        [14,'Why do some posts score 0%?','A zero score means the AI found no meaningful alignment with any entity above the detection threshold. This can happen when a post is genuinely neutral or factual, when the content is too vague or short to score reliably, or occasionally when the model misses context it should have caught — particularly for posts that rely heavily on irony, cultural shorthand, or implicit references. If you believe a zero result is wrong, feel free to contact us.','Scanning logic',5],
        [15,'What does the score percentage mean?','The score reflects how strongly a post serves a given entity\'s interests, on a scale of 0 to 100. It combines three factors: strategic interest alignment, tactical fingerprint, and narrative echo. Only entities scoring above 85% appear in your results — below that threshold the signal is considered too weak to be meaningful.','Scanning logic',6],
        [16,'What\'s the difference between scanning a social media post and a news article?','Both are analyzed the same way — the text is scored against the entity database to detect whose narrative it serves. The difference is in what you\'re measuring: a social media post reflects what an individual chose to say and how they framed it; a news article reflects how a publication chose to cover a story, what angle it took, and what it emphasized or left out. Both are valid and meaningful signals.','Scanning logic',7],
        [17,'I think the scan results were wrong','AI scoring is imperfect. The model may miss context, misread sarcasm, or fail to identify an indirect beneficiary — especially for posts that are ambiguous, highly local, or rely on cultural knowledge. If you consistently see wrong results for a certain type of post, you can contact us — it helps improve the model.','Scanning logic',8],
        [18,'Are the entities interchangeable?','Yes — the entity database is designed to evolve with the political landscape. Entities can be added, edited, split, or removed to reflect new developments, shifting alliances, emerging figures, or entirely new topics. The database is versioned, so you can always see which version was used for any given scan.','Scanning logic',9],
        [19,'How up to date is the entity database?','The database is updated periodically to reflect the current political landscape — new parties, splits, emerging figures, and shifting alliances. Each version is numbered, and every scan records which database version was used, so you can always trace results back to the entity set that produced them.','Scanning logic',10],
        [20,'Can Who\'s Behind That? work for other topics?','Yes — in principle the tool can be adapted to any topic where narrative alignment matters. Currently it\'s built specifically for the Israeli-Palestinian conflict and Israeli domestic politics, and the results are most reliable within that scope. Applying it to other conflicts or political landscapes would require building a dedicated entity database for that domain, which is something we\'re open to exploring.','Scanning logic',11],
        [21,'Are the entities static or dynamic?','The entity database is reviewed on a weekly basis and updated when meaningful developments occur — such as election results, shifting alliances, new political figures, or major strategic changes. Minor day-to-day news doesn\'t trigger updates; only changes that genuinely affect an entity\'s interests or behavior do.','Scanning logic',12],
        // Technical
        [22,'What languages are supported?','Posts in Hebrew and Arabic are automatically detected and pre-translated before scoring, with political context extracted as part of the process. English posts are scored directly. Other languages may work but results are less reliable.','Technical',1],
        [23,'How does the Investigate feature work?','The Investigate tab lets you cross-analyze multiple posts together to detect narrative patterns that wouldn\'t be visible from a single scan. You add posts to an investigation basket from your history or directly from a scan result, then run the investigation when ready. The process works in two stages: first, every pair of posts is evaluated for a meaningful connection — same framing, coordinated narrative, or escalating pattern. Pairs that pass the threshold form clusters. Second, each cluster gets a synthesized synopsis describing what narrative is being constructed and whose interests it serves. Posts with no detected connections are excluded and noted separately. The basket persists across sessions so you can build an investigation over time.','Technical',2],
        [24,'What platforms are supported? Does scanning work the same for all?','Who\'s Behind That? supports posts from X (Twitter), Facebook, and Instagram, as well as articles from major news and media websites including Ynet, Haaretz, Times of Israel, BBC, Al Jazeera, New York Times, and many others. The analysis itself works the same way across all platforms — once the text is retrieved, it goes through the same scoring process regardless of source. That said, every platform is built differently, and some are more restrictive than others when it comes to automated access. If scanning from a particular platform doesn\'t work, manually copying and pasting the text is always an option.','Technical',3],
        [25,'I got an error when trying to scan a post','Who\'s Behind That? can only access publicly available content. Private social media posts, friends-only content, closed groups, and articles behind a paywall cannot be fetched — in those cases, you can paste the text manually instead. For Facebook and Instagram specifically, automated access is sometimes temporarily blocked by the platform — copying and pasting the post text manually is the best workaround. If the server is waking up from sleep, waiting 30 seconds and trying again usually resolves the issue.','Technical',4],
        [26,'Does actor scanning count toward my daily quota?','Yes — each actor research uses one of your daily credits, the same as a post scan. This is because it involves an AI call which has a real cost.','Technical',5],
        [27,'Can Who\'s Behind That? integrate with other platforms via API?','We\'d love to make that possible. API access isn\'t available yet — the tool is currently a web app only — but if you\'re interested in integration for research, journalism, or institutional use, we\'d be happy to hear from you at contact@whosbehindthat.com.','Technical',6],
        // Privacy
        [28,'Is login or identification required?','No login, account, or registration is required. Who\'s Behind That? uses a randomly generated device identifier stored in your browser to track your daily scan quota and link your local history — nothing more. There is no user profile, no email address, and no authentication of any kind. You can start scanning immediately.','Privacy',1],
        [29,'Is Who\'s Behind That? free?','Yes — Who\'s Behind That? is free to use during the beta period. There are no subscription fees, no payment required, and no premium tier. The tool is currently limited to 10 scans per day per device to manage API costs, but this limit may be adjusted in future versions. If you need higher usage for research or institutional purposes, contact us at contact@whosbehindthat.com.','Privacy',2],
        [30,'Can someone know what I scanned for?','Your scan history is stored locally on your device and is private to you. The service operator (Who\'s Behind That?) can see anonymized scan data — the post URL, content, and results — linked only to a randomly generated device identifier. No personal information is collected or visible to us: no IP address, no email, no device identifiers such as MAC address, and no account information of any kind. Your scans are never shared with third parties.','Privacy',3],
        [31,'Is my data used to train AI models?','No. Your scan data is not used to train Claude or any other AI model. Post text is sent to Anthropic\'s Claude API for analysis and is subject to Anthropic\'s privacy policy, but Who\'s Behind That? does not share your data for training purposes.','Privacy',4],
        [32,'Does Who\'s Behind That? use cookies?','No, Who\'s Behind That? does not use cookies. Instead, it uses your browser\'s local storage to keep track of an anonymous device identifier, your scan history, and your daily quota — all of which stay on your device and are never sent automatically with requests the way cookies are. There\'s no cross-site tracking and no third-party tracking technology involved.','Privacy',5],
        [33,'Does WBT detect bots?','Yes — when you research an actor, WBT estimates the likelihood that the account is a bot or inauthentic account. The assessment is shown as a percentage alongside the actor profile.\n\nThe detection is powered by Claude\'s web search, which surfaces publicly available profile information across platforms — X, Facebook, Instagram, news publications, and more. Since it relies on open-source intelligence rather than direct API access, signal quality varies by platform and account visibility.\n\nThe following signals are evaluated: bio authenticity (does it contain verifiable specifics like a job title, institution, or city, or is it a generic ideological template?); activity inflection (is there a sudden spike in posting volume from an otherwise dormant old account — a classic sign of a purchased or hijacked account?); follower/following ratio (mass-following with few followers back is a known signal); narrative focus (does the account post exclusively about one geopolitical topic with no personal content?); and account name patterns (suspiciously ideological or generated-looking names suggest a manufactured identity).\n\nJournalists and public figures with a verifiable publication history typically score very low. The score is a directional signal, not forensic proof.','Scanning logic',6],
      ];
      for (const [sortOrder, question, answer, group, so] of faqs) {
        await db.query(
          `INSERT INTO faq (question, answer, faq_group, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [question, answer, group, so]
        );
      }
      console.log('FAQ: seeded ' + faqs.length + ' default items.');
    }
    console.log('Database ready. Table scans exists or was created.');
    await loadPromptsFromDB();
  } catch (err) {
    console.error('DB init error:', err.message);
    db = null;
  }
}

// ─────────────────────────────────────────────
// POST /clusters/save
// ─────────────────────────────────────────────
app.post('/clusters/save', async (req, res) => {
  const { id, clusterId, clusterName, synopsis, dominantEntity, connectionType, frame, event, postIds, isolatedPostIds, postSummaries, connections, posts, postCount, source, deviceId, appVersion } = req.body;
  const clustId = clusterId || id;
  if (!clustId) return res.status(400).json({ error: 'clusterId required' });
  if (!db) return res.json({ success: true, warning: 'DB not available' });
  try {
    await db.query(`ALTER TABLE clusters ADD COLUMN IF NOT EXISTS post_summaries JSONB`);
    await db.query(`ALTER TABLE clusters ADD COLUMN IF NOT EXISTS isolated_post_ids TEXT[]`);
    await db.query(`ALTER TABLE clusters ADD COLUMN IF NOT EXISTS connections JSONB`);
    await db.query(`ALTER TABLE clusters ADD COLUMN IF NOT EXISTS posts JSONB`);
    const totalCount = (postIds||[]).length + (isolatedPostIds||[]).length;
    await db.query(
      `INSERT INTO clusters (id, cluster_name, synopsis, dominant_entity, connection_type, frame, event, post_ids, isolated_post_ids, post_summaries, connections, posts, post_count, source, device_id, app_version, server_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET cluster_name=$2, synopsis=$3, post_summaries=$10, connections=$11, posts=$12`,
      [clustId, clusterName||'', synopsis||'', dominantEntity||'', connectionType||'', frame||'', event||'', postIds||[], isolatedPostIds||[], JSON.stringify(postSummaries||[]), JSON.stringify(connections||[]), JSON.stringify(posts||[]), totalCount, source||'admin', deviceId||null, appVersion||'', SERVER_VERSION]
    );
    res.json({ success: true });
  } catch(err) {
    console.error('clusters/save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /clusters/list
// ─────────────────────────────────────────────
app.get('/clusters/list', async (req, res) => {
  if (!db) return res.json({ success: true, clusters: [] });
  const { device_id } = req.query;
  try {
    let query, params;
    if (device_id) {
      query = `SELECT id, ts, cluster_name, synopsis, dominant_entity, connection_type, frame, event, post_ids, isolated_post_ids, post_summaries, connections, posts, post_count, source, device_id, app_version, server_version
               FROM clusters WHERE device_id=$1 ORDER BY ts DESC LIMIT 200`;
      params = [device_id];
    } else {
      query = `SELECT id, ts, cluster_name, synopsis, dominant_entity, connection_type, frame, event, post_ids, isolated_post_ids, post_summaries, connections, posts, post_count, source, device_id, app_version, server_version
               FROM clusters ORDER BY ts DESC LIMIT 200`;
      params = [];
    }
    const result = await db.query(query, params);
    res.json({ success: true, clusters: result.rows.map(r => ({
      id: r.id, ts: r.ts, clusterName: r.cluster_name, synopsis: r.synopsis,
      dominantEntity: r.dominant_entity, connectionType: r.connection_type,
      frame: r.frame, event: r.event, postIds: r.post_ids,
      isolatedPostIds: r.isolated_post_ids || [],
      postSummaries: r.post_summaries || [],
      connections: r.connections || [],
      posts: r.posts || [],
      postCount: r.post_count,
      source: r.source, deviceId: r.device_id, appVersion: r.app_version, serverVersion: r.server_version
    }))});
  } catch(err) {
    console.error('clusters/list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /clusters/rename
// ─────────────────────────────────────────────
app.patch('/clusters/rename', async (req, res) => {
  const { clusterId, clusterName } = req.body;
  if (!clusterId) return res.status(400).json({ error: 'clusterId required' });
  if (!db) return res.json({ success: true, warning: 'DB not available' });
  try {
    await db.query(`UPDATE clusters SET cluster_name=$1 WHERE id=$2`, [clusterName||'', clusterId]);
    res.json({ success: true });
  } catch(err) {
    console.error('clusters/rename error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /faq/list
// ─────────────────────────────────────────────
app.get('/faq/list', async (req, res) => {
  if (!db) return res.json({ success: true, faqs: [] });
  try {
    const result = await db.query(
      `SELECT id, question, answer, faq_group, sort_order, active FROM faq WHERE active=TRUE ORDER BY faq_group, sort_order, id`
    );
    res.json({ success: true, faqs: result.rows.map(r => ({
      id: r.id, question: r.question, answer: r.answer,
      group: r.faq_group, sortOrder: r.sort_order, active: r.active
    }))});
  } catch(err) {
    console.error('faq/list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /faq/save  (add or update)
// ─────────────────────────────────────────────
app.post('/faq/save', async (req, res) => {
  const { id, question, answer, group, sortOrder } = req.body;
  if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
  if (!db) return res.json({ success: true, warning: 'DB not available' });
  try {
    let result;
    if (id) {
      result = await db.query(
        `UPDATE faq SET question=$1, answer=$2, faq_group=$3, sort_order=$4 WHERE id=$5 RETURNING id`,
        [question, answer, group||'General', sortOrder||0, id]
      );
    } else {
      result = await db.query(
        `INSERT INTO faq (question, answer, faq_group, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`,
        [question, answer, group||'General', sortOrder||0]
      );
    }
    res.json({ success: true, id: result.rows[0]?.id });
  } catch(err) {
    console.error('faq/save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /faq/:id
// ─────────────────────────────────────────────
app.delete('/faq/:id', async (req, res) => {
  const { id } = req.params;
  if (!db) return res.json({ success: true, warning: 'DB not available' });
  try {
    await db.query(`UPDATE faq SET active=FALSE WHERE id=$1`, [id]);
    res.json({ success: true });
  } catch(err) {
    console.error('faq/delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /entities/list
// ─────────────────────────────────────────────
app.get('/entities/list', async (req, res) => {
  if (!db) return res.json({ success: false, error: 'DB not available' });
  try {
    const result = await db.query(`SELECT data, updated_at, version FROM entities ORDER BY updated_at DESC LIMIT 1`);
    if (result.rows.length === 0) return res.json({ success: false, error: 'No entities found' });
    res.json({ success: true, entities: result.rows[0].data, updatedAt: result.rows[0].updated_at, version: result.rows[0].version });
  } catch(err) {
    console.error('entities/list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /entities/save
// ─────────────────────────────────────────────
app.post('/entities/save', async (req, res) => {
  const { entities, version } = req.body;
  if (!entities || !Array.isArray(entities)) return res.status(400).json({ error: 'entities array required' });
  if (!db) return res.json({ success: true, warning: 'DB not available' });
  try {
    await db.query(
      `INSERT INTO entities (id, data, updated_at, version) VALUES ('main', $1, NOW(), $2)
       ON CONFLICT (id) DO UPDATE SET data=$1, updated_at=NOW(), version=$2`,
      [JSON.stringify(entities), version || '1.0.0']
    );
    res.json({ success: true });
  } catch(err) {
    console.error('entities/save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /prompts/list
// ─────────────────────────────────────────────
app.get('/prompts/list', async (req, res) => {
  if (!db) return res.json({ success: false, error: 'DB not available' });
  try {
    const result = await db.query(
      `SELECT DISTINCT ON (name) id, name, version, model, prompt_text, created_at
       FROM prompts WHERE is_active=TRUE ORDER BY name, created_at DESC`
    );
    res.json({ success: true, prompts: result.rows });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /prompts/history/:name
// ─────────────────────────────────────────────
app.get('/prompts/history/:name', async (req, res) => {
  if (!db) return res.json({ success: false, error: 'DB not available' });
  try {
    const result = await db.query(
      `SELECT id, name, version, model, prompt_text, is_active, created_at
       FROM prompts WHERE name=$1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.name]
    );
    res.json({ success: true, history: result.rows });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /prompts/save
// ─────────────────────────────────────────────
app.post('/prompts/save', async (req, res) => {
  const { name, version, model, prompt_text } = req.body;
  if (!name || !model || !prompt_text) return res.status(400).json({ error: 'name, model, prompt_text required' });
  if (!db) return res.json({ success: true, warning: 'DB not available' });
  try {
    // Deactivate previous versions for this prompt
    await db.query(`UPDATE prompts SET is_active=FALSE WHERE name=$1`, [name]);
    // Insert new version
    await db.query(
      `INSERT INTO prompts (name, version, model, prompt_text, is_active) VALUES ($1,$2,$3,$4,TRUE)`,
      [name, version || '1.0.0', model, prompt_text]
    );
    // Reload into cache immediately
    if (promptCache[name]) {
      promptCache[name].model = model;
      promptCache[name].text = prompt_text;
    }
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /prompts/activate/:id — roll back to a specific version
// ─────────────────────────────────────────────
app.post('/prompts/activate/:id', async (req, res) => {
  if (!db) return res.json({ success: true, warning: 'DB not available' });
  try {
    const row = await db.query(`SELECT * FROM prompts WHERE id=$1`, [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'Version not found' });
    const p = row.rows[0];
    await db.query(`UPDATE prompts SET is_active=FALSE WHERE name=$1`, [p.name]);
    await db.query(`UPDATE prompts SET is_active=TRUE WHERE id=$1`, [req.params.id]);
    if (promptCache[p.name]) {
      promptCache[p.name].model = p.model;
      promptCache[p.name].text = p.prompt_text;
    }
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});
// ─────────────────────────────────────────────
// POST /client/register
// ─────────────────────────────────────────────
app.post('/client/register', async (req, res) => {
  const { deviceId, clientVersion } = req.body;
  if (!deviceId || !clientVersion) return res.json({ success: false });
  if (!db) return res.json({ success: true, warning: 'DB not available' });
  try {
    await db.query(
      `INSERT INTO client_sessions (device_id, client_version, last_seen, first_seen)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (device_id) DO UPDATE SET client_version=$2, last_seen=NOW()`,
      [deviceId, clientVersion]
    );
    res.json({ success: true });
  } catch(err) {
    console.error('client/register error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /client/sessions
// ─────────────────────────────────────────────
app.get('/client/sessions', async (req, res) => {
  if (!db) return res.json({ success: false, error: 'DB not available' });
  try {
    const result = await db.query(
      `SELECT client_version, COUNT(*) as device_count, MAX(last_seen) as last_seen, MIN(first_seen) as first_seen
       FROM client_sessions GROUP BY client_version ORDER BY client_version DESC`
    );
    res.json({ success: true, sessions: result.rows });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /proxy-image — proxy external images for canvas (CORS bypass)
// ─────────────────────────────────────────────
app.get('/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Invalid URL' });
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (!response.ok) return res.status(response.status).end();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: "Who's Behind That? API", version: SERVER_VERSION, db: !!db });
});

// ─────────────────────────────────────────────
// POST /fetch-post
// ─────────────────────────────────────────────
app.post('/fetch-post', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Unsupported URL. Paste a URL from X, Facebook, Instagram, YouTube, or a supported news website.' });
    let result;
    if (platform === 'x') result = await fetchFromX(url);
    else if (platform === 'facebook') result = await fetchFromFacebook(url);
    else if (platform === 'instagram') result = await fetchFromInstagram(url);
    else if (platform === 'youtube') result = await fetchFromYoutube(url);
    else if (platform === 'news') result = await fetchFromNews(url);
    res.json({ success: true, platform, ...result });
  } catch (err) {
    console.error('fetch-post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /analyze
// ─────────────────────────────────────────────
app.post('/analyze', async (req, res) => {
  const { url, postText, entities } = req.body;
  if (!postText) return res.status(400).json({ error: 'postText is required' });
  if (!entities || !entities.length) return res.status(400).json({ error: 'entities array is required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  try {
    const result = await scoreWithClaude(postText, entities);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /fetch-and-analyze
// ─────────────────────────────────────────────
app.post('/fetch-and-analyze', async (req, res) => {
  const { url, entities } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!entities || !entities.length) return res.status(400).json({ error: 'entities array is required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  try {
    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Unsupported URL. Paste a URL from X, Facebook, Instagram, TikTok, YouTube, or a supported news website.' });
    let postData;

    // For video-capable platforms, try yt-dlp+Groq first
    if (isVideoUrl(url) && GROQ_API_KEY) {
      console.log('Video URL detected, attempting yt-dlp+Groq transcript:', url);
      const videoTranscript = await fetchVideoTranscript(url);
      if (videoTranscript) {
        postData = { text: videoTranscript, source: platform, domain: extractDomain(url), hasVideoTranscript: true };
      }
    }

    // Fall back to regular platform fetch if no video transcript
    if (!postData) {
      if (platform === 'x') postData = await fetchFromX(url);
      else if (platform === 'facebook') postData = await fetchFromFacebook(url);
      else if (platform === 'instagram') postData = await fetchFromInstagram(url);
      else if (platform === 'youtube') postData = await fetchFromYoutube(url);
      else if (platform === 'tiktok') {
        if (!GROQ_API_KEY) throw new Error('TikTok requires GROQ_API_KEY to be configured. Paste the caption manually instead.');
        throw new Error('Could not transcribe TikTok video — it may be private or geo-restricted. Paste the caption manually.');
      }
      else if (platform === 'news') postData = await fetchFromNews(url);
    }

    if (!postData || !postData.text) return res.status(422).json({ error: 'Could not extract text. The content may be private, paywalled, or the platform may be blocking access. Try pasting the text manually.' });
    const minLen = (platform === 'news' || platform === 'youtube') ? 50 : 30;
    if (postData.text.length < minLen) return res.status(422).json({ error: `Fetched text is too short (${postData.text.length} chars). Please paste the content text manually.` });
    const analysis = await scoreWithClaude(postData.text, entities);
    const responseUrl = postData.normalizedUrl || url;
    const tokens = analysis._tokens || { input: 0, output: 0 };
    res.json({ success: true, platform, post: postData, analysis, url: responseUrl, inputTokens: tokens.input, outputTokens: tokens.output });
  } catch (err) {
    console.error('fetch-and-analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /research-actor
// ─────────────────────────────────────────────
app.post('/research-actor', async (req, res) => {
  const { handle, url, source, deviceId, appVersion, actorScanId } = req.body;
  if (!handle) return res.status(400).json({ error: 'handle is required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  try {
    const isNews = url && isNewsDomain(url);
    const domain = isNews ? extractDomain(url) : null;
    const [actor, publication] = await Promise.all([
      researchActorWithClaude(handle, url, isNews),
      isNews ? researchPublicationWithClaude(domain) : Promise.resolve(null)
    ]);
    const actorTokens = (actor._tokens?.input || 0) + (publication?._tokens?.input || 0);
    const actorTokensOut = (actor._tokens?.output || 0) + (publication?._tokens?.output || 0);
    console.log(`[TOKENS] actor research: in=${actorTokens} out=${actorTokensOut}`);
    if (db && actorScanId) {
      await db.query(
        `INSERT INTO actors (id, ts, handle, source, device_id, app_version, server_version, actor_data, publication_data, url, input_tokens, output_tokens)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
        [actorScanId, handle, source || 'admin', deviceId || null, appVersion || '', SERVER_VERSION,
         JSON.stringify(actor), publication ? JSON.stringify(publication) : null, url || null,
         actorTokens, actorTokensOut]
      ).catch(e => console.warn('Actor DB save failed:', e.message));
    }
    res.json({ success: true, actor, publication, isNews, inputTokens: actorTokens, outputTokens: actorTokensOut });
  } catch (err) {
    console.error('research-actor error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /entities/refresh
// ─────────────────────────────────────────────
app.post('/entities/refresh', async (req, res) => {
  const { entities } = req.body;
  if (!entities || !entities.length) return res.status(400).json({ error: 'entities array is required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  try {
    const results = await Promise.allSettled(entities.map(async (entity) => {
      const prompt = `You are a political analyst maintaining an entity database for an AI tool that analyzes narrative alignment in the Israeli-Palestinian conflict and Israeli domestic politics.

Review this entity profile and update it based on the latest publicly available information:

Entity: ${entity.name}
Type: ${entity.type}
Current narrative: ${entity.narrative || ''}
Current interest: ${entity.interest || ''}
Current MO: ${entity.mo || ''}
Current comments: ${entity.comments || ''}

Search for recent news and developments about this entity. Then:
1. Determine if any field needs updating based on recent developments
2. If yes, provide updated text for the changed fields only
3. If nothing significant has changed, return changed:false

Focus on: new political positions, changed tactics, election developments, major events, shifts in alliances or stated goals.
Do NOT update for minor day-to-day news. Only update for meaningful strategic or behavioral shifts.

Respond ONLY with valid JSON:
{
  "changed": true/false,
  "changes": ["brief description of what changed"],
  "narrative": "updated text or null if unchanged",
  "interest": "updated text or null if unchanged",
  "mo": "updated text or null if unchanged",
  "comments": "updated text or null if unchanged"
}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5', max_tokens: 1000, temperature: 0,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(`API error for ${entity.name}: ${response.status} ${errBody.error?.message || ''}`);
      }
      const data = await response.json();
      const raw = data.content.filter(c => c.type === 'text').map(c => c.text || '').join('').trim();
      if (!raw) return { changed: false, entityId: entity.id, entityName: entity.name, _tokens: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 } };
      try {
        const result = extractJSON(raw);
        result._tokens = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };
        result.entityId = entity.id;
        result.entityName = entity.name;
        return result;
      } catch(parseErr) {
        console.warn(`JSON parse failed for ${entity.name}:`, parseErr.message, '| raw:', raw.slice(0, 300));
        return { changed: false, entityId: entity.id, entityName: entity.name, error: 'Parse error', _tokens: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 } };
      }
    }));
    // Flatten allSettled results — treat rejected as unchanged
    const flatResults = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      console.warn(`Entity refresh failed for index ${i}:`, r.reason?.message);
      return { changed: false, entityId: entities[i].id, entityName: entities[i].name, error: r.reason?.message };
    });
    res.json({ success: true, results: flatResults });
  } catch(err) {
    console.error('entities/refresh error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /actors/list
// ─────────────────────────────────────────────
app.get('/actors/list', async (req, res) => {
  if (!db) return res.json({ success: true, actors: [] });
  try {
    const result = await db.query(
      `SELECT id, ts, handle, source, device_id, app_version, server_version, actor_data, publication_data, url
       FROM actors ORDER BY ts DESC LIMIT 500`
    );
    function hashDeviceId(did) {
      if (!did) return null;
      let h = 0;
      for (let i = 0; i < did.length; i++) h = (Math.imul(31, h) + did.charCodeAt(i)) | 0;
      return 'usr_' + Math.abs(h).toString(36).slice(0,4).toUpperCase();
    }
    const actors = result.rows.map(r => ({
      id: r.id, ts: r.ts, handle: r.handle,
      source: r.source || 'admin',
      deviceId: hashDeviceId(r.device_id),
      appVersion: r.app_version, serverVersion: r.server_version,
      actorData: r.actor_data, publicationData: r.publication_data,
      url: r.url
    }));
    res.json({ success: true, actors });
  } catch(e) {
    console.error('actors/list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /stats
// ─────────────────────────────────────────────
app.get('/stats', async (req, res) => {
  if (!db) return res.json({ success: true, stats: {} });
  try {
    const scansResult = await db.query(
      `SELECT source, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as count
       FROM scans GROUP BY source`
    );
    const actorsResult = await db.query(
      `SELECT SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as count
       FROM actors`
    );
    const stats = { post: { admin: { in: 0, out: 0, count: 0 }, client: { in: 0, out: 0, count: 0 } }, actor: { in: 0, out: 0, count: 0 } };
    scansResult.rows.forEach(r => {
      const src = r.source || 'admin';
      if (stats.post[src]) {
        stats.post[src].in += parseInt(r.input_tokens) || 0;
        stats.post[src].out += parseInt(r.output_tokens) || 0;
        stats.post[src].count += parseInt(r.count) || 0;
      }
    });
    if (actorsResult.rows[0]) {
      stats.actor.in = parseInt(actorsResult.rows[0].input_tokens) || 0;
      stats.actor.out = parseInt(actorsResult.rows[0].output_tokens) || 0;
      stats.actor.count = parseInt(actorsResult.rows[0].count) || 0;
    }
    res.json({ success: true, stats });
  } catch(e) {
    console.error('stats error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /history/save
// ─────────────────────────────────────────────
app.post('/history/save', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const { id, ts, url, platform, source, deviceId, postText, overallScore, overallLabel, topMatches, textAI, hasImage, appVersion, serverVersion, fullResult, inputTokens, outputTokens } = req.body;
  if (!id || !url) return res.status(400).json({ error: 'id and url are required' });
  try {
    await db.query(
      `INSERT INTO scans (id, ts, url, platform, source, device_id, post_text, overall_score, overall_label, top_matches, text_ai, has_image, app_version, server_version, comment, full_result, input_tokens, output_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, '', $15, $16, $17)
       ON CONFLICT (id) DO NOTHING`,
      [id, ts || new Date().toISOString(), url, platform || null, source || 'admin', deviceId || null, postText || '', overallScore || 0, overallLabel || '', topMatches || [], textAI || 5, hasImage || false, appVersion || '', serverVersion || '', fullResult ? JSON.stringify(fullResult) : null, inputTokens || 0, outputTokens || 0]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error('history/save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /history/list
// Supports query params: platform, appVersion, serverVersion,
// entity, dateFrom, dateTo, minScore, maxScore, minTextAI,
// hasComment, alignmentType
// ─────────────────────────────────────────────
app.get('/history/list', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { platform, appVersion, serverVersion, entity, dateFrom, dateTo, minScore, maxScore, minTextAI, hasComment, alignmentType, source, deviceId } = req.query;
    let where = [];
    let params = [];
    let idx = 1;
    if (platform) { where.push(`platform = $${idx++}`); params.push(platform); }
    if (appVersion) { where.push(`app_version = $${idx++}`); params.push(appVersion); }
    if (serverVersion) { where.push(`server_version = $${idx++}`); params.push(serverVersion); }
    if (entity) { where.push(`$${idx++} = ANY(top_matches)`); params.push(entity); }
    if (dateFrom) { where.push(`ts >= $${idx++}`); params.push(dateFrom); }
    if (dateTo) { where.push(`ts <= $${idx++}`); params.push(dateTo); }
    if (minScore) { where.push(`overall_score >= $${idx++}`); params.push(parseInt(minScore)); }
    if (maxScore) { where.push(`overall_score <= $${idx++}`); params.push(parseInt(maxScore)); }
    if (minTextAI) { where.push(`text_ai >= $${idx++}`); params.push(parseInt(minTextAI)); }
    if (hasComment === 'true') { where.push(`comment != ''`); }
    if (source) { where.push(`source = $${idx++}`); params.push(source); }
    if (deviceId) { where.push(`device_id = $${idx++}`); params.push(deviceId); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await db.query(
      `SELECT id, ts, url, platform, source, device_id, post_text, overall_score, overall_label, top_matches, text_ai, has_image, app_version, server_version, comment, full_result, input_tokens, output_tokens
       FROM scans ${whereClause} ORDER BY ts DESC LIMIT 500`,
      params
    );
    function hashDeviceId(did) {
      if (!did) return null;
      let h = 0;
      for (let i = 0; i < did.length; i++) h = (Math.imul(31, h) + did.charCodeAt(i)) | 0;
      return 'usr_' + Math.abs(h).toString(36).slice(0,4).toUpperCase();
    }
    const rows = result.rows.map(r => ({
      id: r.id, ts: r.ts, url: r.url, platform: r.platform,
      source: r.source || 'admin',
      deviceId: hashDeviceId(r.device_id),
      rawDeviceId: r.device_id,
      postText: r.post_text, overallScore: r.overall_score,
      overallLabel: r.overall_label, topMatches: r.top_matches,
      textAI: r.text_ai, hasImage: r.has_image,
      appVersion: r.app_version, serverVersion: r.server_version,
      comment: r.comment || '', fullResult: r.full_result,
      inputTokens: r.input_tokens || 0, outputTokens: r.output_tokens || 0
    }));
    let filtered = rows;
    if (alignmentType === 'primary') filtered = rows.filter(r => r.fullResult?.matches?.some(m => !m.secondary));
    if (alignmentType === 'secondary') filtered = rows.filter(r => r.fullResult?.matches?.some(m => m.secondary));
    const uniqueUsers = [...new Set(rows.filter(r => r.source === 'client' && r.deviceId).map(r => r.deviceId))];
    res.json({ success: true, scans: filtered, clientUsers: uniqueUsers });
  } catch (err) {
    console.error('history/list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /history/comment
// ─────────────────────────────────────────────
app.patch('/history/comment', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const { id, comment } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    await db.query('UPDATE scans SET comment = $1 WHERE id = $2', [comment || '', id]);
    res.json({ success: true, id });
  } catch (err) {
    console.error('history/comment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /investigate/detect
// ─────────────────────────────────────────────
// Stage 1: for each pair of posts in the batch, detect whether a meaningful
// connection exists. Returns connection graph — only pairs that pass threshold.
app.post('/investigate/detect', async (req, res) => {
  const { posts } = req.body;
  if (!posts || posts.length < 2) return res.status(400).json({ error: 'At least 2 posts required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  try {
    // Build all pairs
    const pairs = [];
    for (let i = 0; i < posts.length; i++) {
      for (let j = i + 1; j < posts.length; j++) {
        pairs.push([posts[i], posts[j]]);
      }
    }

    // Optimization 1: batch pairs — 4 pairs per Claude call instead of 1
    // Optimization 2: use Haiku for detection (pattern matching, not deep synthesis)
    // Optimization 3: trim prompts — lead with structured data, short text excerpt only
    const BATCH_SIZE = 4;
    const allResults = [];

    // Safe string: remove unpaired surrogates and non-printable chars
    const safe = (s, max) => {
      if (!s) return '';
      return Buffer.from(String(s).replace(/[\uD800-\uDFFF]/g, ''), 'utf8')
        .toString('utf8')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .slice(0, max || 200)
        .replace(/\n/g, ' ')
        .trim();
    };

    for (let b = 0; b < pairs.length; b += BATCH_SIZE) {
      const batch = pairs.slice(b, b + BATCH_SIZE);

      const pairsText = batch.map(([a, bPost], idx) => {
        const aDate = a.ts ? new Date(a.ts).toISOString().slice(0,10) : '?';
        const bDate = bPost.ts ? new Date(bPost.ts).toISOString().slice(0,10) : '?';
        const aExcerpt = safe(a.postText, 150);
        const bExcerpt = safe(bPost.postText, 150);
        const aAlign = safe((a.topMatches||[]).slice(0,2).join('+') || 'none', 80);
        const bAlign = safe((bPost.topMatches||[]).slice(0,2).join('+') || 'none', 80);
        return `PAIR ${idx+1}:\nA: [${aDate}] alignment=${aAlign} (${a.overallScore||0}%) | "${aExcerpt}"\nB: [${bDate}] alignment=${bAlign} (${bPost.overallScore||0}%) | "${bExcerpt}"`;
      }).join('\n\n');

      const prompt = `You are a narrative analyst for Who's Behind That?, focused on the Israeli-Palestinian conflict and Israeli domestic politics.

For each pair below, decide if there is a meaningful NARRATIVE CONNECTION. The bar is HIGH — connection requires more than topical overlap or being published on the same day about the same event.

A REAL connection means:
- The posts share the same specific framing goal (not just the same topic)
- One post directly responds to or escalates the other's narrative
- Both posts push the same specific claim or talking point
- There are signs of coordination (same language, same framing, same sequence)

NOT a connection:
- Two posts about the same event from opposing camps (that's just the news cycle)
- Two posts published on the same day about the same political figure
- Topical similarity without shared narrative purpose

${pairsText}

Respond ONLY with a JSON array, one object per pair, in order:
[
  {
    "pair": 1,
    "connected": true/false,
    "connectionType": "narrative reinforcement"|"coordination signal"|"narrative escalation"|"explicit reference"|null,
    "strength": "strong"|"medium"|"weak"|null,
    "reasoning": "one sentence"
  }
]`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: getModel('connection'),
          max_tokens: 800,
          temperature: 0,
          messages: [{ role: 'user', content: getPrompt('connection') ? interpolatePrompt(getPrompt('connection'), {pairsText}) : prompt }]
        })
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        console.error('Haiku API error:', response.status, JSON.stringify(errBody));
        throw new Error(`API error ${response.status}: ${errBody.error?.message || 'unknown'}`);
      }
      const data = await response.json();
      const raw = data.content.filter(c => c.type === 'text').map(c => c.text || '').join('').trim();
      if (!raw) throw new Error('Empty response from API');
      let batchResults;
      try {
        batchResults = extractJSON(raw);
      } catch(parseErr) {
        console.error('JSON parse error, raw response:', raw.slice(0, 500));
        throw new Error('Failed to parse API response: ' + parseErr.message);
      }
      const totalTokens = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };

      // Map batch results back to their pairs
      batch.forEach(([a, bPost], idx) => {
        const r = Array.isArray(batchResults) ? batchResults[idx] : batchResults;
        allResults.push({
          postA: a.scanId,
          postB: bPost.scanId,
          connected: r?.connected || false,
          connectionType: r?.connectionType || null,
          strength: r?.strength || null,
          reasoning: r?.reasoning || '',
          _tokens: totalTokens
        });
      });
    }

    const connections = allResults.filter(r => r.connected && r.strength !== 'weak');

    // Build clusters using union-find
    const postIds = posts.map(p => p.scanId);
    const parent = {};
    postIds.forEach(id => { parent[id] = id; });
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function union(x, y) { parent[find(x)] = find(y); }
    connections.forEach(c => union(c.postA, c.postB));

    const clusterMap = {};
    postIds.forEach(id => {
      const root = find(id);
      if (!clusterMap[root]) clusterMap[root] = [];
      clusterMap[root].push(id);
    });

    const clusters = Object.values(clusterMap).filter(c => c.length > 1);
    const isolated = postIds.filter(id => !clusters.flat().includes(id));

    res.json({ success: true, connections, clusters, isolated });
  } catch(err) {
    console.error('investigate/detect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /investigate/synthesize
// ─────────────────────────────────────────────
// Stage 2: for each cluster of connected posts, generate a synopsis + cluster name.
app.post('/investigate/synthesize', async (req, res) => {
  const { cluster, posts } = req.body;
  if (!cluster || !posts || posts.length < 2) return res.status(400).json({ error: 'cluster array and posts array required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  try {
    const clusterPosts = posts.filter(p => cluster.includes(p.scanId));
    const safe3 = (s, max) => {
      if (!s) return '';
      return Buffer.from(String(s).replace(/[\uD800-\uDFFF]/g, ''), 'utf8')
        .toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .slice(0, max || 300).replace(/\n/g, ' ').trim();
    };
    const postsText = clusterPosts.map((p, i) => {
      const date = p.ts ? new Date(p.ts).toISOString().slice(0,10) : '?';
      const excerpt = safe3(p.postText, 300);
      const alignment = safe3((p.topMatches||[]).slice(0,2).join('+') || 'none', 80);
      return `POST ${i+1} [${date}] alignment=${alignment} (${p.overallScore||0}%): "${excerpt}"`;
    }).join('\n\n');

    const prompt = `Narrative analyst for Who's Behind That? (Israeli-Palestinian conflict / Israeli politics).

These ${clusterPosts.length} posts share narrative connections. Synthesize them.

${postsText}

Respond ONLY with valid JSON:
{
  "clusterName": "3-6 word name: [topic framing] · [entity]",
  "synopsis": "2-4 sentences: what narrative is constructed, what pattern emerges, whose interests served",
  "dominantEntity": "entity name",
  "connectionType": "narrative reinforcement"|"coordination signal"|"narrative escalation"|"explicit reference",
  "frame": "overarching frame/arc",
  "event": "specific event or null",
  "postSummaries": ["one sentence narrative summary for POST 1", "one sentence for POST 2", ...]
}`;

    const dbSynopsisPrompt = getPrompt('synopsis');
    const finalSynopsisPrompt = dbSynopsisPrompt ? interpolatePrompt(dbSynopsisPrompt, { postsText, 'clusterPosts.length': String(clusterPosts.length) }) : prompt;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: getModel('synopsis'), max_tokens: 900, temperature: 0, messages: [{ role: 'user', content: finalSynopsisPrompt }] })
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const raw = data.content.filter(c => c.type === 'text').map(c => c.text || '').join('').trim();
    const result = extractJSON(raw);
    result.postIds = cluster;
    result._tokens = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };
    res.json({ success: true, synthesis: result });
  } catch(err) {
    console.error('investigate/synthesize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /convergent-interest
// Given post text + primary matches, finds hidden
// convergent interests between entities (including rivals)
// Returns at most ONE pair — the most significant only
// ─────────────────────────────────────────────
app.post('/convergent-interest', async (req, res) => {
  const { postText, primaryMatches, allEntities } = req.body;
  if (!postText || !primaryMatches || !allEntities) return res.status(400).json({ error: 'postText, primaryMatches, allEntities required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  try {
    const result = await findConvergentInterest(postText, primaryMatches, allEntities);
    res.json({ success: true, convergent: result });
  } catch (err) {
    console.error('convergent-interest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function findConvergentInterest(postText, primaryMatches, allEntities) {
  const entitySummaries = allEntities.map(e =>
    `ID:${e.id} NAME:${e.name}\nHIDDEN INTEREST: ${(e.interest||'').slice(0,200)}`
  ).join('\n---\n');

  const primaryNames = primaryMatches.map(m => m.name).join(', ');

  const prompt = `You are a senior geopolitical analyst. A social media post primarily serves: ${primaryNames}.

Your task: identify whether this post touches on a RARE, SPECIFIC, HIGH-CONFIDENCE convergent interest between two entities that are NOT normally aligned — including rivals or enemies.

THIS IS A HIGH BAR. The vast majority of posts should return { "found": false }. Only flag a convergent interest if you are highly confident (9/10 or above) that a neutral senior analyst would immediately agree with your assessment without hesitation.

STRICT REQUIREMENTS — ALL must be met:
1. The two entities must have genuinely opposing primary interests on most issues
2. The convergent interest must be DIRECTLY caused by THIS SPECIFIC POST — not a general structural overlap
3. The shared outcome must be named in one precise sentence, citing specific post content
4. The connection requires zero inferential leaps — it must be immediately obvious
5. At least one entity must NOT appear in the primary matches
6. The connection cannot be explained by coalition membership or general ideological overlap

EXPLICIT ANTI-EXAMPLES — these are NOT convergent interests:
- Ben Gvir/Smotrich + Iran: they are absolute enemies. The fact that both oppose a two-state solution is NOT convergent — their reasons, methods and goals are completely incompatible. Do NOT flag this.
- Any two entities that both "oppose" something (opposition is not convergence)
- Entities that benefit from "instability" in general (too vague)
- Rival entities where the connection requires assuming what each entity "secretly wants"
- Any pair where the connection would be dismissed as conspiratorial by a mainstream analyst

LEGITIMATE EXAMPLES (rare cases that actually meet the bar):
- Netanyahu + Hamas: both have structurally benefited from each other remaining in power, preventing a two-state solution — this is documented by Israeli analysts
- Israel + Saudi Arabia: documented secret security cooperation against Iran
- Russia + Iran: documented military cooperation on drones and weapons

SOCIAL MEDIA POST:
"${postText}"

ENTITY DATABASE:
${entitySummaries}

Before responding, ask yourself: "Would a Haaretz or Foreign Affairs editor immediately agree with this connection, or would they call it a stretch?" If any doubt — return { "found": false }.

Respond ONLY with valid JSON:
{
  "found": true,
  "confidence": 9,
  "entityA": { "id": 1, "name": "..." },
  "entityB": { "id": 3, "name": "..." },
  "sharedOutcome": "Precise one sentence citing specific post content",
  "explanation": "2-3 sentences. Must cite specific post phrases and each entity's documented interest.",
  "isRivals": true
}

Or: { "found": false }`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: getModel('convergent'), max_tokens: 600, temperature: 0, messages: [{ role: 'user', content: getPrompt('convergent') ? interpolatePrompt(getPrompt('convergent'), {postText, primaryNames, entitySummaries}) : prompt }] })
  });
  if (!response.ok) { const err = await response.json().catch(()=>({})); throw new Error('Claude API error: ' + (err.error?.message || response.status)); }
  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  const result = JSON.parse(clean);
  // Extra safety: only show if confidence >= 9
  if (result.found && (result.confidence || 0) < 9) return { found: false };
  return result;
}


function detectPlatform(url) {
  if (/x\.com|twitter\.com/i.test(url)) return 'x';
  if (/facebook\.com|fb\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (isNewsDomain(url)) return 'news';
  // Fall back to news for any URL with an article-like path
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path && path.length > 1 && path !== '/') return 'news';
  } catch(e) {}
  return null;
}

// ─────────────────────────────────────────────
// YOUTUBE HELPERS
// ─────────────────────────────────────────────
function extractYoutubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractEmbeddedYoutubeIds(html) {
  const ids = new Set();
  const patterns = [
    /(?:youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/g,
    /data-video-id="([a-zA-Z0-9_-]{11})"/g,
    /"videoId":"([a-zA-Z0-9_-]{11})"/g
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(html)) !== null) ids.add(m[1]);
  }
  return [...ids];
}

async function fetchYoutubeTranscript(videoId) {
  if (!TRANSCRIPT_API_KEY) { console.log('No TRANSCRIPT_API_KEY set'); return null; }
  try {
    const res = await fetch(`https://transcriptapi.com/api/v2/youtube/transcript?video_url=${videoId}&format=json&include_timestamp=false`, {
      headers: { 'Authorization': `Bearer ${TRANSCRIPT_API_KEY}` }
    });
    if (!res.ok) {
      const errText = await res.text();
      console.log('TranscriptAPI failed:', res.status, errText);
      return null;
    }
    const data = await res.json();
    const segments = data.transcript || data.segments || [];
    if (!segments.length) { console.log('TranscriptAPI: no segments for', videoId); return null; }
    const text = segments.map(function(s){ return s.text || ''; }).join(' ').replace(/\s+/g, ' ').trim();
    if (text.length < 50) { console.log('TranscriptAPI: transcript too short for', videoId); return null; }
    const words = text.split(' ');
    const result = words.length > 3000 ? words.slice(0, 3000).join(' ') + '...' : text;
    console.log(`TranscriptAPI: fetched transcript for ${videoId}, ${words.length} words`);
    return result;
  } catch(e) {
    console.log('TranscriptAPI error for', videoId, ':', e.message);
    return null;
  }
}

function fetchBuffer(url, redirectCount = 0) {
  return new Promise(function(resolve, reject) {
    if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
    }, function(res) {
      console.log('Audio response: status', res.statusCode, 'content-length', res.headers['content-length'], 'transfer-encoding', res.headers['transfer-encoding']);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchBuffer(res.headers.location, redirectCount + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', function(c){ chunks.push(c); });
      res.on('end', function(){ resolve(Buffer.concat(chunks)); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// ─────────────────────────────────────────────
// VIDEO TRANSCRIPT via yt-dlp + Groq Whisper
// Supports: TikTok, Instagram, Facebook, X/Twitter videos
// ─────────────────────────────────────────────
function isVideoUrl(url) {
  if (!url) return false;
  if (/tiktok\.com\/@[^/]+\/video\//i.test(url)) return true;
  if (/vm\.tiktok\.com\//i.test(url)) return true;
  if (/instagram\.com\/(reel|p|tv)\//i.test(url)) return true;
  if (/facebook\.com\/.+\/(videos|reel)\//i.test(url)) return true;
  if (/fb\.watch\//i.test(url)) return true;
  if (/x\.com\/.+\/status\//i.test(url)) return true;
  if (/twitter\.com\/.+\/status\//i.test(url)) return true;
  return false;
}

async function fetchVideoTranscript(url) {
  if (!GROQ_API_KEY) { console.log('Video transcript: GROQ_API_KEY not set, skipping'); return null; }
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  const os = (await import('os')).default;
  const path = (await import('path')).default;
  const fs = (await import('fs')).default;
  const tmpBase = path.join(os.tmpdir(), 'wbt_audio_' + Date.now());

  try {
    // Ensure yt-dlp is installed
    try { await execFileAsync('yt-dlp', ['--version'], {timeout:10000}); }
    catch(e) { console.log('Installing yt-dlp...'); await execFileAsync('pip', ['install','yt-dlp','--break-system-packages','-q'], {timeout:60000}); }

    console.log('yt-dlp: downloading audio from', url);
    await execFileAsync('yt-dlp', [
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '64K',
      '--max-filesize', '24M', '--no-playlist', '--quiet',
      '-o', tmpBase + '.%(ext)s', url
    ], { timeout: 90000 });

    // Find output file
    const dir = os.tmpdir();
    const base = path.basename(tmpBase);
    const match = fs.readdirSync(dir).find(f => f.startsWith(base) && !f.endsWith('.part'));
    if (!match) { console.log('yt-dlp: no output file found'); return null; }
    const audioFile = path.join(dir, match);
    const audioBytes = fs.readFileSync(audioFile);
    try { fs.unlinkSync(audioFile); } catch(e) {}
    console.log('yt-dlp: downloaded', (audioBytes.length/1024).toFixed(0), 'KB');
    if (audioBytes.length === 0) { console.log('yt-dlp: empty file'); return null; }

    // Send to Groq Whisper
    const form = new FormData();
    form.append('file', new Blob([audioBytes], {type:'audio/mpeg'}), 'audio.mp3');
    form.append('model', 'whisper-large-v3');
    form.append('response_format', 'json');
    console.log('Sending to Groq Whisper...');
    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: {'Authorization': 'Bearer ' + GROQ_API_KEY}, body: form
    });
    if (!groqRes.ok) { const e = await groqRes.text(); console.log('Groq error:', groqRes.status, e.slice(0,200)); return null; }
    const groqData = await groqRes.json();
    const transcript = (groqData.text||'').trim();
    if (!transcript || transcript.length < 20) { console.log('Groq: transcript too short'); return null; }
    const words = transcript.split(' ');
    const result = words.length > 3000 ? words.slice(0,3000).join(' ')+'...' : transcript;
    console.log('Groq Whisper: transcribed', words.length, 'words');
    return result;
  } catch(e) {
    console.log('fetchVideoTranscript error:', e.message);
    try { require('fs').unlinkSync(tmpBase+'.mp3'); } catch(err) {}
    return null;
  }
}


