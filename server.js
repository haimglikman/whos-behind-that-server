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
// v1.22.3 — Prompt management system:
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

const SERVER_VERSION = '1.22.3';

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import pg from 'pg';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const TRANSCRIPT_API_KEY = process.env.transcriptapi_API_KEY || '';

// In-memory prompt cache — loaded from DB on startup, refreshed when admin saves
const promptCache = {
  scan:       { model: 'claude-sonnet-4-5', text: null },
  coherence:  { model: 'claude-sonnet-4-5', text: null },
  connection: { model: getModel('connection'), text: null },
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
    if (!platform) return res.status(400).json({ error: 'Unsupported URL. Paste a URL from X, Facebook, Instagram, YouTube, or a supported news website.' });
    let postData;
    if (platform === 'x') postData = await fetchFromX(url);
    else if (platform === 'facebook') postData = await fetchFromFacebook(url);
    else if (platform === 'instagram') postData = await fetchFromInstagram(url);
    else if (platform === 'youtube') postData = await fetchFromYoutube(url);
    else if (platform === 'news') postData = await fetchFromNews(url);
    if (!postData.text) return res.status(422).json({ error: 'Could not extract text. The content may be private, paywalled, or the platform may be blocking access.' });
    const minLen = (platform === 'news' || platform === 'youtube') ? 50 : 100;
    if (postData.text.length < minLen) return res.status(422).json({ error: `Fetched text is too short (${postData.text.length} chars). Please paste the article text manually.` });
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
        console.warn(`JSON parse failed for ${entity.name}:`, parseErr.message);
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
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }]
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: getModel('synopsis'), max_tokens: 900, temperature: 0, messages: [{ role: 'user', content: getPrompt('synopsis') || prompt }] })
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
    body: JSON.stringify({ model: getModel('convergent'), max_tokens: 600, temperature: 0, messages: [{ role: 'user', content: getPrompt('convergent') || prompt }] })
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
  if (/facebook\.com|fb\.com/i.test(url)) return 'facebook';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (isNewsDomain(url)) return 'news';
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

async function fetchFromNews(url) {
  const domain = extractDomain(url);
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)'
  ];
  let lastError;
  for (const ua of userAgents) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9,he;q=0.8' },
        redirect: 'follow'
      });
      if (!response.ok) { lastError = new Error(`HTTP ${response.status}`); continue; }
      const html = await response.text();
      const $ = cheerio.load(html);
      // Try to get article body first, fall back to meta tags
      const articleSelectors = ['article p', '.article-body p', '.story-body p', '[itemprop="articleBody"] p', '.content-area p'];
      let text = '';
      for (const sel of articleSelectors) {
        const paragraphs = $(sel).map((i, el) => $(el).text().trim()).get().filter(t => t.length > 50);
        if (paragraphs.length > 0) { text = paragraphs.slice(0, 10).join(' '); break; }
      }
      // Fall back to meta tags if no article body found
      if (!text || text.length < 100) {
        text = $('meta[property="og:description"]').attr('content') ||
               $('meta[name="description"]').attr('content') ||
               $('meta[property="og:title"]').attr('content') || '';
      }
      const title = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
      // Get author if available
      const author = $('meta[name="author"]').attr('content') ||
                     $('[rel="author"]').first().text() ||
                     $('[itemprop="author"]').first().text() || null;
      if (!text || text.length < 50) { lastError = new Error('Could not extract article text'); continue; }
      const fullText = title ? `${title}\n\n${text}` : text;

      // Look for embedded YouTube videos and fetch their transcripts
      const embeddedIds = extractEmbeddedYoutubeIds(html);
      let videoNote = '';
      if (embeddedIds.length > 0) {
        const transcripts = [];
        for (const vid of embeddedIds.slice(0, 5)) { // max 5 videos
          const t = await fetchYoutubeTranscript(vid);
          if (t) transcripts.push(t);
        }
        if (transcripts.length > 0) {
          const combined = transcripts.join('\n\n');
          const words = combined.split(' ');
          const trimmed = words.length > 3000 ? words.slice(0, 3000).join(' ') + '...' : combined;
          console.log(`News fetch: appended ${transcripts.length} YouTube transcript(s) from ${domain}`);
          return { text: fullText + '\n\n' + trimmed, author: author ? author.trim() : null, authorHandle: author ? author.trim() : null, source: 'news', domain, hasVideoTranscript: true };
        } else {
          // Videos found but no transcripts available
          videoNote = 'Note: this article contains embedded video(s) whose transcript could not be retrieved. Analysis is based on article text only.';
        }
      }

      console.log(`News fetch success from ${domain}, text length: ${fullText.length}`);
      return { text: fullText, author: author ? author.trim() : null, authorHandle: author ? author.trim() : null, source: 'news', domain, videoNote: videoNote || null };
    } catch(e) { lastError = e; }
  }
  throw new Error(`Could not fetch article from ${domain}. ${lastError?.message || ''}. The article may be paywalled or require login.`);
}

// In-memory transcript cache — transcripts don't change once a video is published
const transcriptCache = new Map();

async function checkVideoMeta(videoId) {
  if (!YOUTUBE_API_KEY) return null;
  try {
    const metaUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`;
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) return null;
    const metaData = await metaRes.json();
    const item = (metaData.items || [])[0];
    if (!item) return null;
    const liveBroadcastContent = item.snippet?.liveBroadcastContent;
    if (liveBroadcastContent === 'live') {
      return { error: 'This video is currently live streaming. Live videos cannot be scanned — please try again after the stream ends.' };
    }
    const duration = item.contentDetails?.duration || '';
    const durationMatch = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (durationMatch) {
      const hours = parseInt(durationMatch[1] || 0);
      const minutes = parseInt(durationMatch[2] || 0);
      if (hours > 0 || hours * 60 + minutes > 10) {
        return { error: `This video is ${hours > 0 ? hours + 'h ' : ''}${minutes}m long. Who's Behind That? only supports videos up to 10 minutes. Please paste the relevant transcript manually instead.` };
      }
    }
    return { ok: true };
  } catch(e) { return null; }
}

async function fetchFromYoutube(url) {
  const videoId = extractYoutubeId(url);
  if (!videoId) throw new Error('Could not extract YouTube video ID from URL.');

  // Run meta check and transcript fetch in parallel
  const [meta, transcript] = await Promise.all([
    checkVideoMeta(videoId),
    transcriptCache.has(videoId)
      ? Promise.resolve(transcriptCache.get(videoId))
      : fetchYoutubeTranscript(videoId)
  ]);

  // Meta check gate — if video is live or too long, reject
  if (meta && meta.error) throw new Error(meta.error);

  if (!transcript) throw new Error('No transcript available for this YouTube video. You can paste the video text manually instead.');

  // Cache the transcript
  if (!transcriptCache.has(videoId)) {
    transcriptCache.set(videoId, transcript);
    // Limit cache size to 100 entries
    if (transcriptCache.size > 100) {
      const firstKey = transcriptCache.keys().next().value;
      transcriptCache.delete(firstKey);
    }
  }

  // Get title via oEmbed (run alongside cache store — no await needed before returning)
  let title = '';
  try {
    const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (oe.ok) { const d = await oe.json(); title = d.title || ''; }
  } catch(e) {}
  const fullText = title ? `${title}\n\n${transcript}` : transcript;
  console.log(`YouTube: fetched for ${videoId}, length: ${fullText.length}, cached: ${transcriptCache.has(videoId)}`);
  return { text: fullText, author: null, authorHandle: null, source: 'youtube', domain: 'youtube.com' };
}

// ─────────────────────────────────────────────
// X FETCHER (oEmbed)
// ─────────────────────────────────────────────
async function fetchFromX(url) {
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
  const response = await fetch(oembedUrl, { headers: { 'User-Agent': 'WhoBehindThat/1.5' }, timeout: 10000 });
  if (!response.ok) throw new Error(`X oEmbed API returned ${response.status}. The post may be private, deleted, or from a protected account.`);
  const data = await response.json();
  const $ = cheerio.load(data.html || '');
  $('a').last().remove();
  const rawText = $('p').first().text().trim();
  const authorHandle = data.author_url ? data.author_url.split('/').pop() : null;
  // Reconstruct proper username URL if we got an /i/status/ format
  const statusId = url.match(/status\/(\d+)/)?.[1];
  const normalizedUrl = (authorHandle && statusId)
    ? `https://x.com/${authorHandle}/status/${statusId}`
    : url;
  return {
    text: rawText,
    author: data.author_name || null,
    authorHandle,
    html: data.html,
    source: 'oembed',
    normalizedUrl
  };
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// INSTAGRAM FETCHER — OpenGraph scraping
// Puppeteer removed (caused Render build failures).
// Falls back to manual text if fetch is too short.
// ─────────────────────────────────────────────
async function fetchFromInstagram(url) {
  return await scrapeOpenGraph(url, 'instagram');
}

// ─────────────────────────────────────────────
// FACEBOOK FETCHER — OpenGraph scraping
// Same approach as Instagram. Works for public
// posts/pages via og:description meta tag.
// ─────────────────────────────────────────────
async function fetchFromFacebook(url) {
  // Try OpenGraph first
  try {
    const result = await scrapeOpenGraph(url, 'facebook');
    if (result && result.text && result.text.length >= 100) return result;
    console.log('Facebook OpenGraph too short, trying Claude web search');
  } catch(e) {
    console.log('Facebook OpenGraph failed:', e.message, '— trying Claude web search');
  }
  // Fall back to Claude web search
  return await fetchWithClaudeWebSearch(url, 'Facebook');
}

// ─────────────────────────────────────────────
// OPEN GRAPH SCRAPER
// Fallback for Instagram and Facebook
// ─────────────────────────────────────────────
async function scrapeOpenGraph(url, platform) {
  // Try multiple user agents — Facebook blocks Googlebot aggressively now
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
  ];
  let lastError;
  for (const ua of userAgents) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9,he;q=0.8,ar;q=0.7',
          'Cache-Control': 'no-cache'
        },
        redirect: 'follow'
      });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const html = await response.text();
      const $ = cheerio.load(html);
      const text =
        $('meta[property="og:description"]').attr('content') ||
        $('meta[name="twitter:description"]').attr('content') ||
        $('meta[property="og:title"]').attr('content') ||
        $('meta[name="description"]').attr('content') || '';
      if (!text) { lastError = new Error('No text in meta tags'); continue; }
      const canonicalUrl = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || url;
      const handleMatch = canonicalUrl.match(/(?:instagram|facebook)\.com\/([^\/\?p][^\/\?]+)/i);
      console.log(`${platform} OpenGraph success with UA: ${ua.slice(0,40)}... text length: ${text.length}`);
      return { text, author: null, authorHandle: handleMatch ? handleMatch[1] : null, source: 'opengraph' };
    } catch(e) { lastError = e; }
  }
  throw new Error(`Could not extract text from ${platform} post — ${lastError?.message || 'unknown error'}. It may require login to view.`);
}

// ─────────────────────────────────────────────
// CLAUDE WEB SEARCH FETCHER (Facebook)
// Uses Claude's web_search tool to fetch and extract
// post text from Instagram/Facebook public posts
// ─────────────────────────────────────────────
async function fetchWithClaudeWebSearch(url, platform) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const prompt = `Use your web_search tool to search for this URL and retrieve the post content: ${url}

After searching, extract the full post text and author information. Return JSON only:
{
  "text": "full post caption/text",
  "author": "author name or null",
  "authorHandle": "username without @ or null"
}`;

  // First call — force tool use
  const firstResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      temperature: 0,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!firstResponse.ok) {
    const err = await firstResponse.json().catch(() => ({}));
    throw new Error('Claude web search error: ' + (err.error?.message || firstResponse.status));
  }

  const firstData = await firstResponse.json();
  console.log(`${platform} fetch — stop_reason: ${firstData.stop_reason}, blocks: ${firstData.content.length}`);

  // If Claude returned text directly (tool_choice:any but still returned text), extract it
  if (firstData.stop_reason === 'end_turn') {
    const textContent = firstData.content.filter(c => c.type === 'text').map(c => c.text).join('');
    return extractPostFromText(textContent, platform);
  }

  // Claude used the tool — send back tool results and get final answer
  const toolUseBlocks = firstData.content.filter(c => c.type === 'tool_use');
  const toolResults = firstData.content
    .filter(c => c.type === 'tool_result' || c.type === 'web_search_tool_result')
    .map(c => c);

  // Build messages with assistant response and tool results
  const messages = [
    { role: 'user', content: prompt },
    { role: 'assistant', content: firstData.content },
    {
      role: 'user',
      content: toolUseBlocks.map(block => ({
        type: 'tool_result',
        tool_use_id: block.id,
        content: 'Search completed. Extract the post text and author from the search results above and return JSON.'
      }))
    }
  ];

  const secondResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      temperature: 0,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages
    })
  });

  if (!secondResponse.ok) {
    const err = await secondResponse.json().catch(() => ({}));
    throw new Error('Claude web search (turn 2) error: ' + (err.error?.message || secondResponse.status));
  }

  const secondData = await secondResponse.json();
  const textContent = secondData.content.filter(c => c.type === 'text').map(c => c.text).join('');
  console.log(`${platform} second turn full content:`, JSON.stringify(secondData.content).slice(0, 500));
  console.log(`${platform} second turn text (first 500):`, textContent.slice(0, 500));
  return extractPostFromText(textContent, platform);
}

function extractPostFromText(textContent, platform) {
  // Try JSON extraction
  try {
    const clean = textContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(clean);
    if (result.text) return { text: result.text, author: result.author || null, authorHandle: result.authorHandle || null, html: null, source: 'claude_web_search' };
    throw new Error(result.error || `Could not extract ${platform} post text`);
  } catch(e1) {
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        if (result.text) return { text: result.text, author: result.author || null, authorHandle: result.authorHandle || null, html: null, source: 'claude_web_search' };
      }
    } catch(e2) {}
  }
  // Last resort: use raw text if it looks like post content
  if (textContent.length > 80 && !textContent.toLowerCase().includes('cannot access') && !textContent.toLowerCase().includes('unable to')) {
    return { text: textContent.slice(0, 2000), author: null, authorHandle: null, html: null, source: 'claude_web_search' };
  }
  throw new Error(`Could not extract text from ${platform} post. It may be private or require login.`);
}

// ─────────────────────────────────────────────
// CLAUDE SCORING ENGINE
// ─────────────────────────────────────────────
const BATCH_SIZE = 10;

// Detect if text contains significant Hebrew or Arabic characters
function isNonEnglish(text) {
  const nonLatinChars = (text.match(/[\u0590-\u05FF\u0600-\u06FF]/g) || []).length;
  return nonLatinChars > 10;
}

// Translate and summarize non-English post for scoring context
async function translatePost(postText) {
  const prompt = `The following social media post is written in Hebrew or Arabic. Provide:
1. A full English translation
2. A political context analysis identifying:
   - What is the main argument or message?
   - Which political figures or entities are being PRAISED, ELEVATED, or DEFENDED?
   - Which political figures or entities are being ATTACKED, CRITICIZED, or DISMISSED?
   - What political camp does this language belong to?
   - If this is a ranking or preference list ("X over Y"), explicitly state who is ranked higher and what that implies politically.

POST TEXT:
"${postText}"

Respond ONLY with valid JSON:
{
  "translation": "...",
  "political_context": "..."
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: getModel('actor'), max_tokens: 800, temperature: 0, messages: [{ role: 'user', content: prompt }] })
  });
  if (!response.ok) return null;
  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    const result = JSON.parse(clean);
    result._tokens = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };
    return result;
  } catch(e) { return null; }
}

async function scoreWithClaude(postText, entities) {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  let enrichedText = postText;
  if (isNonEnglish(postText)) {
    try {
      const translation = await translatePost(postText);
      if (translation) {
        enrichedText = `ORIGINAL TEXT:\n${postText}\n\nENGLISH TRANSLATION:\n${translation.translation}\n\nPOLITICAL CONTEXT:\n${translation.political_context}`;
        totalInputTokens += translation._tokens?.input || 0;
        totalOutputTokens += translation._tokens?.output || 0;
        console.log('Post translated for scoring. Political context:', translation.political_context.slice(0, 150));
      }
    } catch(e) {
      console.warn('Translation failed, using original text:', e.message);
    }
  }

  const batches = [];
  for (let i = 0; i < entities.length; i += BATCH_SIZE) batches.push(entities.slice(i, i + BATCH_SIZE));
  const batchResults = await Promise.all(batches.map(batch => scoreBatch(enrichedText, batch)));
  const allMatches = [];
  let text_ai_score = 5, text_ai_reason = '';
  for (const result of batchResults) {
    if (result.text_ai_score) text_ai_score = result.text_ai_score;
    if (result.text_ai_reason) text_ai_reason = result.text_ai_reason;
    totalInputTokens += result._tokens?.input || 0;
    totalOutputTokens += result._tokens?.output || 0;
    for (const match of (result.matches || [])) {
      if (!allMatches.find(m => m.id === match.id)) allMatches.push(match);
    }
  }
  allMatches.sort((a, b) => b.pct - a.pct);

  const candidates = allMatches.filter(m => m.pct >= 60);
  let finalMatches = allMatches;
  if (candidates.length > 1) {
    try {
      const coherent = await coherenceCheck(enrichedText, candidates, entities);
      totalInputTokens += coherent._tokens?.input || 0;
      totalOutputTokens += coherent._tokens?.output || 0;
      const coherentIds = new Set(coherent.map ? coherent.map(m => m.id) : []);
      finalMatches = allMatches.map(m => {
        if (!coherentIds.has(m.id) && m.pct >= 60) {
          return Object.assign({}, m, { pct: Math.min(m.pct, 50), why: '', missing: '', alignment: '' });
        }
        const refined = Array.isArray(coherent) ? coherent.find(c => c.id === m.id) : null;
        return refined ? Object.assign({}, m, refined) : m;
      });
    } catch(e) {
      console.warn('Coherence check failed, using raw scores:', e.message);
    }
  }

  console.log(`[TOKENS] scan total: in=${totalInputTokens} out=${totalOutputTokens}`);
  return { text_ai_score, text_ai_reason, matches: finalMatches, _tokens: { input: totalInputTokens, output: totalOutputTokens } };
}

async function coherenceCheck(postText, candidates, allEntities) {
  const candidateSummary = candidates.map(m => {
    const e = allEntities.find(x => x.id === m.id);
    return `ID:${m.id} NAME:${m.name} SCORE:${m.pct}% ALIGNMENT:${m.alignment||'?'}`;
  }).join('\n');

  const prompt = `You are a senior geopolitical analyst. A scoring engine has identified the following entities as potentially aligned with a social media post. Your job is to apply a coherence filter — a single post can only realistically serve one coherent political direction at a time.

SOCIAL MEDIA POST TEXT:
"${postText}"

CANDIDATE MATCHES (already scored):
${candidateSummary}

ENTITY RELATIONSHIPS TO CONSIDER:
- Iran, Hamas, Hezbollah, PIJ, Houthis, Muslim Brotherhood form the "Axis of Resistance" — they share interests
- Israeli Opposition, Protest Movement, Hostage Families, Lieberman, Israeli Left are anti-Netanyahu Israeli domestic voices — they share interests
- Netanyahu government, Ben Gvir/Smotrich, AIPAC, Evangelical Zionists, US pro-Israel bloc share interests BUT have distinct sub-interests
- Palestinian Authority / Fatah and Hamas are RIVALS
- Israel and Iran are RIVALS
- US pro-Israel bloc (Trump, Rubio, Vance, AIPAC) and US Progressive Caucus (AOC) are RIVALS on this issue
- Russia and China benefit opportunistically but are not part of any primary bloc
- Human rights orgs (Amnesty, HRW, B'Tselem, ICC/ICJ) operate independently but often align with criticism of Israeli military conduct
- AOC/Progressive Caucus may align with human rights orgs and Israeli left — but NOT with Iran or Hamas

INTRA-COALITION DISTINCTION — CRITICAL:
Entities in the same broad coalition can have conflicting sub-interests. Treat them as distinct:
- A post criticizing Netanyahu from the RIGHT (settlers demanding harder enforcement, sovereignty language, West Bank infrastructure) aligns with Ben Gvir/Smotrich and the Settler Movement — but NOT with Netanyahu himself, who is being criticized
- A post criticizing Netanyahu from the LEFT (hostage deal, judicial reform, democratic norms) aligns with Israeli Opposition/Protest Movement — but NOT with Iran or Hamas even if they also oppose Netanyahu
- Ben Gvir/Smotrich and Netanyahu share a coalition but have genuine tension — settler posts that demand action Netanyahu hasn't taken align with the former, not the latter

TASK:
1. Identify the single most coherent political direction this post serves
2. Keep entities that genuinely fit that direction (including legitimate secondary/collateral beneficiaries)
3. REMOVE entities that belong to rival blocs or whose specific interests don't fit this post's framing
4. You may adjust the "alignment" field (primary/secondary) based on your coherence assessment
5. Maximum 3 primary, 2 secondary in your final output

CRITICAL: A post criticizing Netanyahu may align with Israeli opposition AND human rights orgs AND AOC — that is coherent. But it should NOT align with Iran or Hamas. A settler enforcement post aligns with Ben Gvir/Settler Movement — but NOT with Netanyahu if he is being pressured.

Respond ONLY with valid JSON — the filtered list of matches to KEEP:
{
  "matches": [
    {
      "id": 51,
      "name": "Israeli Opposition Bloc",
      "pct": 91,
      "alignment": "primary",
      "why": "...",
      "missing": "..."
    }
  ]
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: getModel('coherence'), max_tokens: 1500, temperature: 0, messages: [{ role: 'user', content: getPrompt('coherence') || prompt }] })
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error('Coherence check API error: ' + (err.error?.message || response.status)); }
  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  const result = JSON.parse(clean);
  const matches = result.matches || [];
  matches._tokens = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };
  return matches;
}

// Pre-process entities into compact format at call time (saves ~15-20% tokens)
function formatEntityCompact(e) {
  return `[${e.id}] ${e.name} (${e.type})\n` +
    `N: ${(e.narrative||'').slice(0,250)}\n` +
    `I: ${(e.interest||'').slice(0,250)}\n` +
    `M: ${(e.mo||'').slice(0,250)}` +
    (e.comments ? `\nC: ${(e.comments||'').slice(0,150)}` : '');
}

async function scoreBatch(postText, entities) {
  const entitySummaries = entities.map(formatEntityCompact).join('\n---\n');

  const prompt = `You are a senior analyst specializing in geopolitical influence operations, information warfare, and social media manipulation. Your task is to determine whose agenda a social media post serves, and what context it leaves out.

LANGUAGE NOTE:
The post may be written in English, Hebrew, or Arabic. Score based on semantic meaning and political intent regardless of the language. Do not penalize non-English posts. Key political vocabulary to recognize:
- Hebrew: ביביזם (Bibiism/blind Netanyahu loyalty), פלישה (invasion/encroachment), ריבונות (sovereignty), יהודה ושומרון (Judea and Samaria/West Bank), אכיפה (enforcement), מאחז (outpost), עסקת חטופים (hostage deal), מחאה (protest)
- Arabic: مقاومة (resistance), شهيد (martyr), الاحتلال (the occupation), النضال (the struggle), محور المقاومة (Axis of Resistance), التطبيع (normalization), الاستيطان (settlement)

CORE PHILOSOPHY:
The primary concern is not whether a post contains outright lies, but whether it tells only half the story to serve a specific agenda. A post can be factually accurate and still be pure propaganda if it selectively presents only the facts that serve one side. Identify: (1) whose hidden interest this post serves directly, (2) who indirectly benefits from the post being spread, and (3) what relevant context is conspicuously absent.

SOCIAL MEDIA POST TEXT:
"${postText}"

ENTITY DATABASE (score ALL of these — do not skip any):
Field key: N=narrative (public stance), I=interest (hidden strategic interest), M=modus operandi (known tactics), C=comments
${entitySummaries}

SCORING INSTRUCTIONS:
For EACH entity above, assess three dimensions:

1. interest_score (0-100) — MOST IMPORTANT (weight: 55%)
   "Would spreading this post advance this entity's HIDDEN strategic interest?"
   Consider TWO angles — apply whichever is stronger, or combine if both are present:
   a) CONTENT: Does the post's message, framing, or narrative directly serve this entity's interests?
   b) CONTEXT: Does the post attack, undermine, or discredit someone this entity considers a rival or opponent?
      ONLY apply context scoring if ALL three conditions are met:
      - A specific named or unmistakably identifiable target is being attacked
      - That attack is CENTRAL to the post (not incidental or passing)
      - The rival relationship between that target and this entity is documented in the entity list above
      If context scoring applies, weight it according to how explicit and central the attack is:
      - Very direct, central attack on a named rival → strong context signal, weight heavily
      - Implied or between-the-lines criticism → weaker signal, weight moderately
      If context is the primary driver of the score, explain this clearly in the "why" field.

2. mo_score (0-100) — IMPORTANT (weight: 35%)
   "Does the construction of this post match this entity's known manipulation playbook?"

3. narrative_score (0-100) — WEAK SIGNAL (weight: 10%)
   "Does the post's surface content echo this entity's official public statements?"

Compute: combined_score = (interest_score * 0.55) + (mo_score * 0.35) + (narrative_score * 0.10)
Round to nearest integer.

IMPORTANT: Return ALL entities where combined_score >= 60.
The frontend will apply the 85% threshold for display.

PRIMARY vs SECONDARY ALIGNMENT:
After scoring, classify each match (combined_score >= 60) as either:
- "primary": This entity is a DIRECT beneficiary — the post appears to have been written with this entity's agenda in mind, consciously or not.
- "secondary": This entity is an INDIRECT or COLLATERAL beneficiary — the post was not necessarily written for them, but its spread still serves their interests as a side effect.

CRITICAL RULE — CRITICISM IS NOT ALIGNMENT:
If a post ATTACKS, CRITICIZES, or DELEGITIMIZES an entity, that entity scores LOW on primary alignment — being criticized does not serve your interest. A post mocking Netanyahu does NOT align with Netanyahu. A post exposing Hamas atrocities does NOT align with Hamas. Only score an entity high if spreading the post HELPS them.

CRITICAL RULE — COMPLETE THE BENEFICIARY CHAIN:
When a post attacks Entity A, always ask: who benefits from Entity A being weakened or discredited? If Entity A's rival (Entity B) is documented in the entity list, Entity B scores HIGH — even if Entity B is never mentioned in the post. This is the most commonly missed signal.
Examples:
- Post attacks Bennett, Lapid, Golan → Netanyahu scores high (his rivals are being delegitimized)
- Post attacks Netanyahu → Israeli opposition scores high
- Post attacks PA/Abbas → Hamas scores high
- Post attacks Hamas → PA/Abbas and Israel score high
Apply this chain for EVERY named target in the post. Never stop at "target scores low" — always follow through to "therefore rival scores high."

CRITICAL RULE — PREFERENCE LISTS AND RANKINGS:
When a post ranks or compares entities ("I prefer X over Y", "X is 1000 times better than Y"), the entity being elevated scores HIGH, the entity being dismissed scores LOW. A post saying "Netanyahu 1 over 1,000,000,000 Bennett/Lapid/Golan" strongly serves Netanyahu's interest and attacks his rivals — do not be confused by the list format. Score the beneficiary of the glorification, not just the targets of criticism.

CRITICAL RULE — SARCASM AND IRONY DETECTION:
Assume literal intent UNLESS the post contains explicit irony markers:
- Quotation marks around praise that reads as mockery
- A punchline or final line that contradicts the surface meaning
- Exaggerated praise that is internally inconsistent ("the greatest leader in all of history" style)
- Hebrew irony markers: "כן בטח", "בטח שכן", "ברור", used sarcastically
If none of these are present, score the post at face value. Do NOT second-guess straightforward political preference posts. The risk of misidentifying genuine support as sarcasm is greater than missing actual sarcasm.

CRITICAL RULE — INTRA-COALITION CRITICISM:
Entities in the same political coalition can still have distinct and sometimes conflicting interests. A post criticizing Netanyahu from the RIGHT (e.g. settlers or Ben Gvir demanding harder enforcement) does NOT align with Netanyahu — it aligns with the settler/nationalist bloc specifically. A post criticizing Netanyahu from the LEFT aligns with the Israeli opposition, not with Iran or Hamas even if they also oppose Netanyahu. Score each entity's specific interest independently, not by coalition membership alone.

Maximum 3 primary matches, maximum 2 secondary matches. If a match qualifies for both, assign it to primary only.
The "alignment" field is MANDATORY on every match — always set it to either "primary" or "secondary", never omit it or leave it blank.

For each entity with combined_score >= 60, provide:
- "alignment": "primary" or "secondary"
- "why": 2-3 sentences — for primary: which hidden interest is directly served and which MO tactics are present; for secondary: how the post's spread indirectly benefits this entity
- "missing": 2-3 sentences on what relevant context this post conspicuously omits

For entities with combined_score < 60, still include them with scores but "why", "missing", and "alignment" can be empty strings.

Also assess (only needed once — include in first batch response):
- text_ai_score (1-10): probability the text was AI-generated
- text_ai_reason: one sentence of evidence

Respond ONLY with valid JSON, no preamble, no markdown:
{
  "text_ai_score": 5,
  "text_ai_reason": "...",
  "matches": [
    {
      "id": 2,
      "name": "Hamas",
      "narrative": 92,
      "interest": 95,
      "mo": 88,
      "pct": 91,
      "alignment": "primary",
      "why": "...",
      "missing": "..."
    }
  ]
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: getModel('scan'), max_tokens: 2000, temperature: 0, messages: [{ role: 'user', content: getPrompt('scan') || prompt }] })
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error('Claude API error: ' + (err.error?.message || response.status)); }
  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  const result = JSON.parse(clean);
  result._tokens = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };
  return result;
}

// ─────────────────────────────────────────────
// ACTOR RESEARCH
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// NEWS DOMAIN DETECTION
// ─────────────────────────────────────────────
const NEWS_DOMAINS = new Set([
  // Israeli outlets
  'ynet.co.il','ynetnews.com','haaretz.co.il','haaretz.com','israelhayom.co.il','israelhayom.com',
  'inn.co.il','arutzsheva.co.il','arutz7.co.il','mako.co.il','n12.co.il','kan.org.il',
  'walla.co.il','maariv.co.il','timesofisrael.com','jpost.com','jerusalempost.com',
  '972mag.com','plus972.com','calcalist.co.il','globes.co.il','themarker.com',
  'zman.co.il','ice.co.il','sport5.co.il','reshet.tv','channel14.co.il','galatz.co.il',
  // International
  'bbc.com','bbc.co.uk','reuters.com','apnews.com','nytimes.com','washingtonpost.com',
  'theguardian.com','aljazeera.com','aljazeera.net','cnn.com','foxnews.com','nbcnews.com',
  'abcnews.go.com','cbsnews.com','msnbc.com','politico.com','thehill.com','axios.com',
  'bloomberg.com','economist.com','ft.com','wsj.com','newsweek.com','time.com',
  'foreignpolicy.com','foreignaffairs.com','atlanticcouncil.org','brookings.edu',
  'le-monde.fr','lemonde.fr','lefigaro.fr','derspiegel.de','spiegel.de','sueddeutsche.de',
  'independent.co.uk','telegraph.co.uk','thetimes.co.uk','dailymail.co.uk','mirror.co.uk',
  'middleeasteye.net','arabicpost.net','asharqalawsat.com','alarabiya.net','almonitor.com',
  'i24news.tv','jewishinsider.com','tabletmag.com','mosaic.org','commentary.org',
  'debka.com','debkafile.com','memri.org','jihadwatch.org',
  'axios.com','vox.com','vice.com','buzzfeednews.com','huffpost.com',
]);

function isNewsDomain(url) {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    return NEWS_DOMAINS.has(domain);
  } catch(e) { return false; }
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch(e) { return url; }
}

// ─────────────────────────────────────────────
// STATIC PUBLICATION DATABASE
// ─────────────────────────────────────────────
const PUBLICATION_DB = {
  // ── ISRAELI ──
  'ynet.co.il': { name:'Ynet / Yedioth Ahronoth', type:'News website', country:'Israel', language:'Hebrew', founded:'1999 (Ynet); 1939 (Yedioth)', ownership:'Yedioth Communications (Arnon Mozes)', agenda:'Israel\'s most-read news site. Centrist-populist orientation, historically close to the Yedioth Ahronoth print newspaper which had a famously adversarial relationship with Netanyahu. Broadly mainstream, covers the full political spectrum but editorially leans center. High-traffic, tabloid-influenced style alongside serious news coverage.' },
  'ynetnews.com': { name:'Ynetnews (Ynet English)', type:'News website', country:'Israel', language:'English', founded:'1999', ownership:'Yedioth Communications', agenda:'English-language version of Ynet. Same editorial orientation — centrist Israeli mainstream. Primary destination for international readers seeking Israeli news from an Israeli source.' },
  'haaretz.co.il': { name:'Haaretz', type:'Newspaper', country:'Israel', language:'Hebrew', founded:'1919', ownership:'Schocken family; M. DuMont Schauberg (minority stake)', agenda:'Israel\'s oldest daily and its most internationally recognized left-liberal publication. Strongly advocates for two-state solution, rule of law, judicial independence, and civil liberties. Critical of settlement expansion, Netanyahu governments, and military excesses. Readership skews secular, Ashkenazi, educated, and politically left. Frequently targeted by the Israeli right as unpatriotic. Strong investigative journalism tradition.' },
  'haaretz.com': { name:'Haaretz English', type:'Newspaper', country:'Israel', language:'English', founded:'1919', ownership:'Schocken family', agenda:'English-language edition of Haaretz. Same editorial line — left-liberal Israeli perspective. Widely read internationally by diaspora Jews, foreign policy analysts, and journalists covering the conflict.' },
  'israelhayom.co.il': { name:'Israel Hayom', type:'Newspaper', country:'Israel', language:'Hebrew', founded:'2007', ownership:'Miriam Adelson (Sheldon Adelson estate)', agenda:'Free daily newspaper founded with explicit support for Benjamin Netanyahu. Editorially pro-Likud and pro-Netanyahu. Israel\'s most widely distributed print newspaper by circulation (free distribution model). Critics call it "Bibiton" (Netanyahu\'s paper). Strong on security narratives, right-wing framing of the conflict, and supportive coverage of settlement policy.' },
  'israelhayom.com': { name:'Israel Hayom English', type:'Newspaper', country:'Israel', language:'English', founded:'2007', ownership:'Miriam Adelson', agenda:'English version of Israel Hayom. Same pro-Netanyahu, right-wing orientation. Distributed internationally to support pro-Israel and pro-Likud narratives.' },
  'inn.co.il': { name:'Arutz Sheva / Israel National News', type:'News website', country:'Israel', language:'Hebrew/English', founded:'1988 (radio); 1995 (web)', ownership:'Non-profit associated with the settler movement', agenda:'Voice of the religious-Zionist settler movement. Strongly pro-settlement, pro-annexation, and ideologically aligned with Religious Zionism and Otzma Yehudit. Opposed to any territorial compromise, Palestinian state, or land withdrawals. Readership: religious-Zionist, settler community, and right-wing diaspora.' },
  'arutzsheva.co.il': { name:'Arutz Sheva', type:'News website', country:'Israel', language:'Hebrew', founded:'1988', ownership:'Settler movement non-profit', agenda:'Religious-Zionist and settler-oriented news. See inn.co.il.' },
  'mako.co.il': { name:'Mako / Channel 12', type:'TV & news website', country:'Israel', language:'Hebrew', founded:'2001', ownership:'Keshet Broadcasting', agenda:'Israel\'s most-watched commercial TV channel and associated news website. Centrist, ratings-driven. Known for hard-hitting news programs including "Uvda" (investigative) and "Meet the Press"-style political coverage. Has broadcast major investigative pieces critical of Netanyahu. Broadly mainstream.' },
  'n12.co.il': { name:'N12 / Channel 12 News', type:'TV news website', country:'Israel', language:'Hebrew', founded:'1993', ownership:'Keshet Broadcasting', agenda:'News arm of Channel 12. Centrist mainstream Israeli TV news. Known for serious political journalism.' },
  'kan.org.il': { name:'Kan / Israeli Public Broadcasting Corporation', type:'Public broadcaster', country:'Israel', language:'Hebrew', founded:'2017 (replacing IBA)', ownership:'Israeli government public corporation', agenda:'Israel\'s public broadcaster. Legally required to maintain editorial balance. Generally perceived as centrist-liberal, with strong news and cultural programming. The government has periodically threatened its funding. Respected for journalistic standards.' },
  'walla.co.il': { name:'Walla News', type:'News portal', country:'Israel', language:'Hebrew', founded:'1995', ownership:'Bezeq (telecom)', agenda:'Major Israeli news portal and ISP. Centrist commercial news, somewhat tabloid-influenced. Less politically distinctive than Haaretz or Israel Hayom.' },
  'maariv.co.il': { name:'Maariv', type:'Newspaper', country:'Israel', language:'Hebrew', founded:'1948', ownership:'NMC (various)', agenda:'Historic Israeli daily, now primarily online. Center-right orientation, formerly one of Israel\'s most important papers. Reduced influence in recent decades.' },
  'timesofisrael.com': { name:'The Times of Israel', type:'News website', country:'Israel', language:'English', founded:'2012', ownership:'David Horovitz (founder/editor); various investors', agenda:'English-language Israeli news site. Center-right editorially, generally supportive of Israel\'s security establishment but critical of extremism. Widely read by diaspora Jews, foreign diplomats, and international journalists. Gives significant voice to settler and right-wing perspectives alongside mainstream coverage.' },
  'jpost.com': { name:'The Jerusalem Post', type:'Newspaper', country:'Israel', language:'English', founded:'1932', ownership:'Miriam Adelson (majority)', agenda:'Israel\'s flagship English-language newspaper. Historically centrist but shifted right after acquisition by the Adelson family. Strong on security narratives, US-Israel relations, and pro-Israel advocacy internationally. Has a conservative-leaning op-ed section and is widely read by American Jewish conservatives and Republican politicians.' },
  '972mag.com': { name:'+972 Magazine', type:'Online magazine', country:'Israel/Palestine', language:'English', founded:'2010', ownership:'Non-profit cooperative', agenda:'Explicitly progressive, anti-occupation publication covering Israel-Palestine from a left-wing and Palestinian rights perspective. Run by Israeli and Palestinian journalists. Strongly advocates for Palestinian rights, documents military abuses and settler violence, and supports BDS-adjacent positions. Frequently cited by international human rights organizations and sharply criticized by Israeli government and right-wing groups.' },
  'calcalist.co.il': { name:'Calcalist', type:'Business newspaper', country:'Israel', language:'Hebrew', founded:'2008', ownership:'Yedioth Communications', agenda:'Israel\'s leading business and economics daily. Focuses on tech sector, startups, and economic policy. Generally non-partisan on security issues but has strong coverage of economic impacts of the war.' },
  'globes.co.il': { name:'Globes', type:'Business newspaper', country:'Israel', language:'Hebrew', founded:'1983', ownership:'Shimon Laor', agenda:'Israel\'s oldest business daily. Financial and economic focus, centrist. Has been a voice for the Israeli business community\'s concerns about the war\'s economic impact.' },
  'themarker.com': { name:'TheMarker', type:'Business newspaper', country:'Israel', language:'Hebrew', founded:'2001', ownership:'Haaretz Group', agenda:'Business supplement and website affiliated with Haaretz. Left-leaning on economic and social issues, critical of monopolies and inequality. Shares Haaretz\'s broadly liberal editorial stance.' },
  'channel14.co.il': { name:'Channel 14 / NOW 14', type:'TV channel', country:'Israel', language:'Hebrew', founded:'2020', ownership:'Right-wing media consortium', agenda:'Explicitly right-wing pro-Netanyahu channel. Often called "Bibi TV" by critics. Strong supporter of Netanyahu, Ben Gvir, and Smotrich. Attacks judicial independence, mainstream media, and the left. Significant influence within the Israeli right-wing base.' },
  // ── INTERNATIONAL ──
  'bbc.com': { name:'BBC', type:'Public broadcaster', country:'UK', language:'English', founded:'1922', ownership:'UK public charter', agenda:'British public broadcaster. Legally required to be impartial. Generally perceived as center-left by conservatives, center-right by progressives. Has faced sustained criticism from both pro-Israel and pro-Palestinian groups for its coverage. Strong international reporting, emphasis on humanitarian angles.' },
  'bbc.co.uk': { name:'BBC', type:'Public broadcaster', country:'UK', language:'English', founded:'1922', ownership:'UK public charter', agenda:'See bbc.com.' },
  'reuters.com': { name:'Reuters', type:'Wire service', country:'UK/Global', language:'English', founded:'1851', ownership:'Thomson Reuters', agenda:'Global wire service. Emphasizes factual, neutral reporting. No clear editorial line. Widely used as a primary source by other publications. Has been criticized by both sides of the conflict for specific word choices (e.g. reluctance to use "terrorist"). Generally the gold standard for factual reporting.' },
  'apnews.com': { name:'Associated Press (AP)', type:'Wire service', country:'USA', language:'English', founded:'1846', ownership:'Non-profit cooperative', agenda:'American wire service. Similar to Reuters — factual, neutral, wire-focused. Widely distributed, sets the baseline for much international coverage. Has been criticized for specific Gaza coverage decisions.' },
  'nytimes.com': { name:'The New York Times', type:'Newspaper', country:'USA', language:'English', founded:'1851', ownership:'New York Times Company (Sulzberger family)', agenda:'America\'s newspaper of record. Center-left editorially, with strong international coverage. Has published extensive Gaza civilian casualty reporting and has been criticized by both pro-Israel groups (for alleged bias against Israel) and progressive groups (for alleged softness on Israel). Internal tensions between editorial stance and opinion sections are notable. Influential globally.' },
  'washingtonpost.com': { name:'The Washington Post', type:'Newspaper', country:'USA', language:'English', founded:'1877', ownership:'Jeff Bezos', agenda:'Major US daily. Center-left editorial stance, strong on US politics and foreign policy. Has been critical of Netanyahu\'s government and supportive of a two-state solution while maintaining pro-Israel security baseline. Bezos ownership has not dramatically altered editorial line.' },
  'theguardian.com': { name:'The Guardian', type:'Newspaper', country:'UK', language:'English', founded:'1821', ownership:'Scott Trust (non-profit)', agenda:'British left-liberal newspaper. Strong supporter of Palestinian rights, two-state solution, and international humanitarian law. Among the most critical mainstream publications of Israeli military conduct. Publishes extensively on Gaza civilian casualties, settler violence, and occupation. Significant influence in European progressive circles.' },
  'aljazeera.com': { name:'Al Jazeera', type:'TV & news website', country:'Qatar', language:'English/Arabic', founded:'1996', ownership:'Qatari government (Al Jazeera Media Network)', agenda:'Qatari state-funded international broadcaster. Editorially gives significant voice to Palestinian perspectives, Hamas political figures, and Muslim Brotherhood-aligned viewpoints. Critical of Israel, Egypt, Saudi Arabia, and UAE. Banned in Israel since 2024. Strong reporting on Gaza but widely seen as having a clear editorial sympathy toward Palestinian resistance narratives. Flagship of Qatari soft power.' },
  'aljazeera.net': { name:'Al Jazeera Arabic', type:'TV & news website', country:'Qatar', language:'Arabic', founded:'1996', ownership:'Qatari government', agenda:'Arabic-language Al Jazeera. Similar editorial orientation to English edition but more overtly political in Arabic-language discourse. Highly influential across the Arab world.' },
  'cnn.com': { name:'CNN', type:'TV & news website', country:'USA', language:'English', founded:'1980', ownership:'Warner Bros. Discovery', agenda:'Major US cable news network. Center to center-left. Has extensive Gaza coverage with emphasis on civilian humanitarian crisis. Criticized by pro-Israel groups for civilian casualty focus and by progressives for alleged insufficient criticism of Israeli policy. Large international audience.' },
  'foxnews.com': { name:'Fox News', type:'TV & news website', country:'USA', language:'English', founded:'1996', ownership:'Fox Corporation (Rupert Murdoch)', agenda:'Dominant US right-wing cable news network. Strongly pro-Israel and pro-Netanyahu, frames Hamas as purely terrorist with no political dimension, supports strong US military support for Israel, and is critical of any pressure on Israel. Major influence on Republican political discourse on Israel.' },
  'wsj.com': { name:'The Wall Street Journal', type:'Newspaper', country:'USA', language:'English', founded:'1889', ownership:'News Corp (Rupert Murdoch)', agenda:'Leading US financial and business newspaper. Center-right news coverage, conservative opinion section. Generally pro-Israel security stance, critical of Iran, and skeptical of Palestinian Authority governance. Strong on economic and financial dimensions of the conflict.' },
  'ft.com': { name:'Financial Times', type:'Newspaper', country:'UK', language:'English', founded:'1888', ownership:'Nikkei Inc (Japanese)', agenda:'Global financial newspaper. Center-right economically, centrist on geopolitics. Strong on economic analysis of the conflict — arms sales, sanctions, investment. Generally balanced on the conflict itself.' },
  'economist.com': { name:'The Economist', type:'Magazine', country:'UK', language:'English', founded:'1843', ownership:'Economist Group (Agnelli family, staff)', agenda:'British liberal (classical liberal) weekly. Supports two-state solution, rules-based international order, and is critical of both Israeli settlement expansion and Palestinian terrorism. Editorially independent, globally influential among policymakers and business elites.' },
  'middleeasteye.net': { name:'Middle East Eye', type:'News website', country:'UK', language:'English', founded:'2014', ownership:'Jamal Khashoggi/various (Qatari-aligned)', agenda:'Online news site with strong sympathies toward the Muslim Brotherhood, Qatar, and Palestinian resistance movements. Frequently cited by pro-Palestinian activists. Critical of Israel, Egypt, UAE, and Saudi Arabia. Has been described by critics as a Qatari media influence project.' },
  'almonitor.com': { name:'Al-Monitor', type:'News website', country:'USA', language:'English', founded:'2012', ownership:'Jamal Daniel', agenda:'Middle East-focused news and analysis. Centrist, aiming for insider regional coverage. Has faced questions about funding transparency but is generally regarded as a useful source for policy analysis across the political spectrum.' },
  'i24news.tv': { name:'i24NEWS', type:'TV & news website', country:'Israel', language:'English/French/Arabic', founded:'2013', ownership:'Patrick Drahi (Altice)', agenda:'International news channel based in Israel. Aims for mainstream international audience. Generally pro-Israel in framing but attempts to cover multiple perspectives. Significant French-language audience.' },
  'foreignpolicy.com': { name:'Foreign Policy', type:'Magazine', country:'USA', language:'English', founded:'1970', ownership:'Graham Holdings', agenda:'US foreign policy magazine. Centrist-realist orientation, focuses on geopolitics and diplomacy. Has published significant critical analysis of both Israeli and Palestinian policy. Influential in DC foreign policy circles.' },
  'atlanticcouncil.org': { name:'Atlantic Council', type:'Think tank', country:'USA', language:'English', founded:'1961', ownership:'Non-profit (various corporate/government donors)', agenda:'Transatlantic foreign policy think tank. Generally supportive of NATO, liberal international order, and US-Israel relationship. Center to center-right on Israel-Palestine, with significant pro-Israel voices on staff.' },
  'tabletmag.com': { name:'Tablet Magazine', type:'Online magazine', country:'USA', language:'English', founded:'2009', ownership:'Nextbook (non-profit)', agenda:'American Jewish online magazine. Center-right to right on Israel, strong defender of Israel\'s military actions, critical of left-wing Jewish groups and BDS. Significant influence in American Jewish conservative discourse. Publishes serious cultural and political analysis.' },
  'memri.org': { name:'MEMRI (Middle East Media Research Institute)', type:'Research institute', country:'USA', language:'English', founded:'1998', ownership:'Non-profit (co-founded by former Israeli intelligence officer)', agenda:'Translates and distributes content from Arabic, Persian, and other Middle Eastern media. Widely used by pro-Israel advocates to highlight extremist content in Arab media. Critics argue it selectively translates content to portray Arabs/Muslims negatively. Has co-founders with Israeli intelligence backgrounds.' },
  'le-monde.fr': { name:'Le Monde', type:'Newspaper', country:'France', language:'French', founded:'1944', ownership:'Le Monde Group (various investors)', agenda:'France\'s newspaper of record. Center-left, internationalist, strong on human rights. Has published critical coverage of Israeli military conduct alongside analysis of Hamas and Palestinian governance. Influential in French and Francophone political discourse.' },
  'lemonde.fr': { name:'Le Monde', type:'Newspaper', country:'France', language:'French', founded:'1944', ownership:'Le Monde Group', agenda:'See le-monde.fr.' },
  'derspiegel.de': { name:'Der Spiegel', type:'Magazine', country:'Germany', language:'German', founded:'1947', ownership:'Spiegel-Verlag (staff/various)', agenda:'Germany\'s leading news magazine. Center-left, strong on investigative journalism. German political context shapes its coverage — Germany\'s historical responsibility creates a distinctive balance between strong support for Israel\'s right to exist and criticism of specific policies.' },
  'spiegel.de': { name:'Der Spiegel', type:'Magazine', country:'Germany', language:'German', founded:'1947', ownership:'Spiegel-Verlag', agenda:'See derspiegel.de.' },
};

async function researchPublicationWithClaude(domain) {
  // Check static database first
  if (PUBLICATION_DB[domain]) {
    return PUBLICATION_DB[domain];
  }
  // Dynamic fallback — Claude with web search
  const prompt = `Research the news publication at domain "${domain}" and provide a factual profile.

Provide:
1. name: Full publication name
2. type: Type (newspaper, TV channel, news website, magazine, wire service, etc.)
3. country: Country of origin
4. language: Primary language(s)
5. founded: Year founded
6. ownership: Owner or parent company
7. agenda: 2-3 sentences describing the publication's editorial orientation, political leanings, known biases, and overall agenda. Be factual and specific.

Respond ONLY with valid JSON:
{
  "name": "...",
  "type": "...",
  "country": "...",
  "language": "...",
  "founded": "...",
  "ownership": "...",
  "agenda": "..."
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5', max_tokens: 600, temperature: 0,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!response.ok) throw new Error('Claude API error: ' + response.status);
  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  try { const result = extractJSON(raw); result._tokens = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 }; return result; } catch(e) { return { name: domain, type: 'News website', agenda: 'Publication information not available.' }; }
}

async function researchActorWithClaude(handle, url, isNews) {
  const context = isNews
    ? `This person is a journalist or contributor at a news publication. URL context: ${url || ''}`
    : `This is a social media account. ${url ? `Profile URL context: ${url}` : ''}`;

  const prompt = `You are an open-source intelligence (OSINT) researcher. Research the following ${isNews ? 'journalist or public figure' : 'social media account'} and provide a factual profile.

${isNews ? `Name/byline: ${handle}` : `Account handle: @${handle}`}
${context}

Provide:
1. name: Full real name (if publicly known). If unknown, use the handle.
2. bio: Factual 2-paragraph summary — background, what they are known for, political or ideological stance, notable work or affiliations. If anonymous or low-profile, state that clearly.
3. location: Country or city (if publicly known). "Unknown" if not established.
4. handles: Array of known social media handles, websites, or other online presence. Format: "X: @handle", "Website: domain.com". Only verified or highly likely matches.

Be factual and neutral. Do not speculate beyond what is publicly known.

Respond ONLY with valid JSON:
{
  "name": "...",
  "bio": "...",
  "location": "...",
  "handles": ["X: @handle"]
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5', max_tokens: 800, temperature: 0,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error('Claude API error: ' + (err.error?.message || response.status)); }
  const data = await response.json();
  const raw = data.content.filter(c => c.type === 'text').map(c => c.text || '').join('').trim();
  const result = extractJSON(raw);
  // Strip citation markup that web_search tool injects (e.g. <cite index="1-2">text</cite>)
  if (result.bio) result.bio = result.bio.replace(/<cite[^>]*>(.*?)<\/cite>/gs, '$1').replace(/\[\d+\]/g, '').trim();
  if (result.name) result.name = result.name.replace(/<cite[^>]*>(.*?)<\/cite>/gs, '$1').trim();
  result._tokens = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };
  return result;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function extractJSON(text) {
  // Strip markdown fences
  let s = text.replace(/```json|```/g, '').trim();
  // Handle arrays starting with [
  const arrStart = s.indexOf('[');
  const objStart = s.indexOf('{');
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const end = s.lastIndexOf(']');
    if (end !== -1) s = s.slice(arrStart, end + 1);
  } else if (objStart !== -1) {
    const end = s.lastIndexOf('}');
    if (end !== -1) s = s.slice(objStart, end + 1);
  }
  return JSON.parse(s);
}
function stripHtml(html) { return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Who's Behind That? server v${SERVER_VERSION} running on port ${PORT}`);
    if (!ANTHROPIC_KEY) console.warn('WARNING: ANTHROPIC_API_KEY not set — scoring endpoints will fail');
    if (!db) console.warn('WARNING: DATABASE_URL not set — history endpoints will be unavailable');
  });
});
