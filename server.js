// Who's Behind That? — Proxy Server
// Handles: post text fetching, Claude AI scoring, shared history (PostgreSQL)
// Deploy to Render.com (free tier)
//
// ─────────────────────────────────────────────
// CHANGELOG
// ─────────────────────────────────────────────
// v1.5.1 — Fixed PostgreSQL connection: better error handling and logging,
//           test query on startup, db=null if connection fails so server
//           still starts. Helps diagnose DATABASE_URL issues on Render.
//
// v1.5.0 — Shared history via PostgreSQL. New endpoints: /history/save,
//           /history/list, /history/comment. Scan IDs in format
//           WBT-{date}-{appVer}-{srvVer}-{random}. App + server version
//           logged per scan. Comments field per scan, server-synced.
//           Auto-creates scans table on first run.
//
// v1.4.1 — Fixed two scoring bugs: (1) "alignment" field now mandatory in
//           prompt — Claude was omitting it causing all matches to show as
//           primary. (2) Added explicit "criticism ≠ alignment" rule — a post
//           attacking Netanyahu no longer incorrectly scores as Netanyahu-aligned.
//
// v1.4.0 — Added primary/secondary alignment distinction. Primary = entity
//           the post was likely written to serve. Secondary = indirect
//           collateral beneficiary. Both require 85%+ threshold.
//           Max 3 primary, 2 secondary matches returned.
//
// v1.3.1 — Fixed Instagram actor research: extract authorHandle from oEmbed
//           author_url so the "research this actor" prompt appears after
//           analyzing Instagram posts (handle not present in post URLs).
//
// v1.3.0 — Batched scoring (10 entities per call), temperature: 0 for
//           deterministic output, internal threshold lowered to 60%.
//
// v1.2.2 — Added SERVER_VERSION constant and changelog comment block.
//
// v1.2.1 — Fixed missing app.listen() line causing Render deploy failure.
//
// v1.2.0 — Added /research-actor endpoint (Claude OSINT actor lookup).
//
// v1.1.1 — Updated scoring weights: interest 55%, MO 35%, narrative 10%.
//
// v1.1.0 — Scoring prompt rewritten to narrative alignment framing;
//           added "missing" context field per entity match.
//
// v1.0.0 — Initial server: fetching, Claude scoring engine, all endpoints.
// ─────────────────────────────────────────────

const SERVER_VERSION = '1.5.1';

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import pg from 'pg';

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
    // Test the connection first
    await db.query('SELECT 1');
    console.log('PostgreSQL connection test passed.');
    await db.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        url TEXT NOT NULL,
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
    console.log('Database ready. Table scans exists or was created.');
  } catch (err) {
    console.error('DB init error:', err.message);
    db = null; // disable DB if it fails
  }
}

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
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
    if (!platform) return res.status(400).json({ error: 'Unsupported platform. Use X, Facebook, or Instagram URLs.' });
    let result;
    if (platform === 'x') result = await fetchFromX(url);
    else if (platform === 'facebook') result = await fetchFromFacebook(url);
    else if (platform === 'instagram') result = await fetchFromInstagram(url);
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
    if (!platform) return res.status(400).json({ error: 'Unsupported platform. Use X, Facebook, or Instagram URLs.' });
    let postData;
    if (platform === 'x') postData = await fetchFromX(url);
    else if (platform === 'facebook') postData = await fetchFromFacebook(url);
    else if (platform === 'instagram') postData = await fetchFromInstagram(url);
    if (!postData.text) return res.status(422).json({ error: 'Could not extract post text. The post may be private or the platform may be blocking access.' });
    const analysis = await scoreWithClaude(postData.text, entities);
    res.json({ success: true, platform, post: postData, analysis });
  } catch (err) {
    console.error('fetch-and-analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /research-actor
// ─────────────────────────────────────────────
app.post('/research-actor', async (req, res) => {
  const { handle, url } = req.body;
  if (!handle) return res.status(400).json({ error: 'handle is required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  try {
    const actor = await researchActorWithClaude(handle, url);
    res.json({ success: true, actor });
  } catch (err) {
    console.error('research-actor error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /history/save
// Saves a completed scan to the shared database
// Body: full scan entry object from frontend
// ─────────────────────────────────────────────
app.post('/history/save', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const { id, ts, url, postText, overallScore, overallLabel, topMatches, textAI, hasImage, appVersion, serverVersion, fullResult } = req.body;
  if (!id || !url) return res.status(400).json({ error: 'id and url are required' });
  try {
    await db.query(
      `INSERT INTO scans (id, ts, url, post_text, overall_score, overall_label, top_matches, text_ai, has_image, app_version, server_version, comment, full_result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '', $12)
       ON CONFLICT (id) DO NOTHING`,
      [id, ts || new Date().toISOString(), url, postText || '', overallScore || 0, overallLabel || '', topMatches || [], textAI || 5, hasImage || false, appVersion || '', serverVersion || '', fullResult ? JSON.stringify(fullResult) : null]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error('history/save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /history/list
// Returns all scans, newest first
// ─────────────────────────────────────────────
app.get('/history/list', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  try {
    const result = await db.query(
      `SELECT id, ts, url, post_text, overall_score, overall_label, top_matches, text_ai, has_image, app_version, server_version, comment, full_result
       FROM scans ORDER BY ts DESC LIMIT 500`
    );
    const rows = result.rows.map(r => ({
      id: r.id,
      ts: r.ts,
      url: r.url,
      postText: r.post_text,
      overallScore: r.overall_score,
      overallLabel: r.overall_label,
      topMatches: r.top_matches,
      textAI: r.text_ai,
      hasImage: r.has_image,
      appVersion: r.app_version,
      serverVersion: r.server_version,
      comment: r.comment || '',
      fullResult: r.full_result
    }));
    res.json({ success: true, scans: rows });
  } catch (err) {
    console.error('history/list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /history/comment
// Updates the comment on a scan
// Body: { id, comment }
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

// ─────────────────────────────────────────────
// PLATFORM DETECTION
// ─────────────────────────────────────────────
function detectPlatform(url) {
  if (/x\.com|twitter\.com/i.test(url)) return 'x';
  if (/facebook\.com|fb\.com/i.test(url)) return 'facebook';
  if (/instagram\.com/i.test(url)) return 'instagram';
  return null;
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
  return {
    text: rawText,
    author: data.author_name || null,
    authorHandle: data.author_url ? data.author_url.split('/').pop() : null,
    html: data.html,
    source: 'oembed'
  };
}

// ─────────────────────────────────────────────
// FACEBOOK FETCHER
// ─────────────────────────────────────────────
async function fetchFromFacebook(url) {
  const oembedUrl = `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(url)}`;
  const response = await fetch(oembedUrl, { headers: { 'User-Agent': 'WhoBehindThat/1.5' }, timeout: 10000 });
  if (!response.ok) return await scrapeOpenGraph(url, 'facebook');
  const data = await response.json();
  return { text: data.body_text || stripHtml(data.html || ''), author: data.author_name || null, html: data.html, source: 'oembed' };
}

// ─────────────────────────────────────────────
// INSTAGRAM FETCHER
// ─────────────────────────────────────────────
async function fetchFromInstagram(url) {
  const oembedUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&omitscript=true`;
  const response = await fetch(oembedUrl, { headers: { 'User-Agent': 'WhoBehindThat/1.5' }, timeout: 10000 });
  if (!response.ok) return await scrapeOpenGraph(url, 'instagram');
  const data = await response.json();
  const handleMatch = (data.author_url || '').match(/instagram\.com\/([^\/\?]+)/i);
  const authorHandle = handleMatch ? handleMatch[1] : (data.author_name || null);
  return { text: stripHtml(data.html || ''), author: data.author_name || null, authorHandle, html: data.html, source: 'oembed' };
}

// ─────────────────────────────────────────────
// OPEN GRAPH FALLBACK
// ─────────────────────────────────────────────
async function scrapeOpenGraph(url, platform) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    timeout: 12000
  });
  if (!response.ok) throw new Error(`Could not access ${platform} post (HTTP ${response.status}). The post may be private or deleted.`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const text = $('meta[property="og:description"]').attr('content') || $('meta[name="twitter:description"]').attr('content') || $('meta[property="og:title"]').attr('content') || '';
  if (!text) throw new Error(`Could not extract text from ${platform} post. It may require login to view.`);
  return { text, author: null, source: 'opengraph' };
}

// ─────────────────────────────────────────────
// CLAUDE SCORING ENGINE
// ─────────────────────────────────────────────
const BATCH_SIZE = 10;

async function scoreWithClaude(postText, entities) {
  const batches = [];
  for (let i = 0; i < entities.length; i += BATCH_SIZE) batches.push(entities.slice(i, i + BATCH_SIZE));
  const batchResults = await Promise.all(batches.map(batch => scoreBatch(postText, batch)));
  const allMatches = [];
  let text_ai_score = 5, text_ai_reason = '';
  for (const result of batchResults) {
    if (result.text_ai_score) text_ai_score = result.text_ai_score;
    if (result.text_ai_reason) text_ai_reason = result.text_ai_reason;
    for (const match of (result.matches || [])) {
      if (!allMatches.find(m => m.id === match.id)) allMatches.push(match);
    }
  }
  allMatches.sort((a, b) => b.pct - a.pct);
  return { text_ai_score, text_ai_reason, matches: allMatches };
}

async function scoreBatch(postText, entities) {
  const entitySummaries = entities.map(e =>
    `ID:${e.id} NAME:${e.name} TYPE:${e.type}\nNARRATIVE: ${(e.narrative||'').slice(0,300)}\nINTEREST: ${(e.interest||'').slice(0,300)}\nMO: ${(e.mo||'').slice(0,300)}`
  ).join('\n---\n');

  const prompt = `You are a senior analyst specializing in geopolitical influence operations, information warfare, and social media manipulation. Your task is to determine whose agenda a social media post serves, and what context it leaves out.

CORE PHILOSOPHY:
The primary concern is not whether a post contains outright lies, but whether it tells only half the story to serve a specific agenda. A post can be factually accurate and still be pure propaganda if it selectively presents only the facts that serve one side. Identify: (1) whose hidden interest this post serves directly, (2) who indirectly benefits from the post being spread, and (3) what relevant context is conspicuously absent.

SOCIAL MEDIA POST TEXT:
"${postText}"

ENTITY DATABASE (score ALL of these — do not skip any):
${entitySummaries}

SCORING INSTRUCTIONS:
For EACH entity above, assess three dimensions:

1. interest_score (0-100) — MOST IMPORTANT (weight: 55%)
   "Would spreading this post advance this entity's HIDDEN strategic interest?"
   Score independently of whether the entity publicly claims to support the cause.

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
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 2000, temperature: 0, messages: [{ role: 'user', content: prompt }] })
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error('Claude API error: ' + (err.error?.message || response.status)); }
  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────
// ACTOR RESEARCH
// ─────────────────────────────────────────────
async function researchActorWithClaude(handle, url) {
  const prompt = `You are an open-source intelligence (OSINT) researcher. Research the following social media account and provide a factual profile based on publicly available information.

Account handle: @${handle}
${url ? `Profile URL context: ${url}` : ''}

Provide the following:
1. name: The real name of the person or organization behind this account (if publicly known). If unknown, use the handle.
2. bio: A factual 2-paragraph summary of who this actor is — their background, what they are known for, their political or ideological stance, and any notable activities or affiliations. If this is an anonymous or low-profile account with no public information, state that clearly and briefly.
3. location: The country or city they are known to be based in (if publicly known). Write "Unknown" if not established.
4. handles: An array of known social media handles, websites, or other online presence associated with this actor. Include platform prefix e.g. "X: @handle", "Instagram: @handle", "Website: domain.com". Include only verified or highly likely matches.

Be factual and neutral. Do not speculate beyond what is publicly known. If this is a clearly anonymous account or a bot farm with no traceable identity, say so explicitly in the bio.

Respond ONLY with valid JSON, no preamble, no markdown:
{
  "name": "...",
  "bio": "...",
  "location": "...",
  "handles": ["X: @handle", "Website: example.com"]
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 800, temperature: 0, messages: [{ role: 'user', content: prompt }] })
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error('Claude API error: ' + (err.error?.message || response.status)); }
  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
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
