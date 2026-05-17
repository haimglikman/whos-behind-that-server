// Who's Behind That? — Proxy Server
// Handles: post text fetching, Claude AI scoring, shared history (PostgreSQL)
// Deploy to Render.com (free tier)
//
// ─────────────────────────────────────────────
// CHANGELOG
// ─────────────────────────────────────────────
// v1.10.2 — Convergent interest threshold raised significantly: confidence
//            score required, explicit anti-examples added to prompt (Ben Gvir
//            + Iran flagged as illegitimate). Only shows if confidence >= 9/10.
//
// v1.10.1 — Removed Puppeteer. Added /convergent-interest endpoint.
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

const SERVER_VERSION = '1.10.2';

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
    await db.query('SELECT 1');
    console.log('PostgreSQL connection test passed.');
    await db.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        url TEXT NOT NULL,
        platform TEXT,
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
    // Add platform column to existing tables that don't have it
    await db.query(`ALTER TABLE scans ADD COLUMN IF NOT EXISTS platform TEXT;`);
    console.log('Database ready. Table scans exists or was created.');
  } catch (err) {
    console.error('DB init error:', err.message);
    db = null;
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
    if (postData.text.length < 200) return res.status(422).json({ error: `Fetched text is too short (${postData.text.length} chars) — OpenGraph likely returned only a title or preview. Please paste the full post text manually.` });
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
// ─────────────────────────────────────────────
app.post('/history/save', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const { id, ts, url, platform, postText, overallScore, overallLabel, topMatches, textAI, hasImage, appVersion, serverVersion, fullResult } = req.body;
  if (!id || !url) return res.status(400).json({ error: 'id and url are required' });
  try {
    await db.query(
      `INSERT INTO scans (id, ts, url, platform, post_text, overall_score, overall_label, top_matches, text_ai, has_image, app_version, server_version, comment, full_result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '', $13)
       ON CONFLICT (id) DO NOTHING`,
      [id, ts || new Date().toISOString(), url, platform || null, postText || '', overallScore || 0, overallLabel || '', topMatches || [], textAI || 5, hasImage || false, appVersion || '', serverVersion || '', fullResult ? JSON.stringify(fullResult) : null]
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
    const { platform, appVersion, serverVersion, entity, dateFrom, dateTo, minScore, maxScore, minTextAI, hasComment, alignmentType } = req.query;
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
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await db.query(
      `SELECT id, ts, url, platform, post_text, overall_score, overall_label, top_matches, text_ai, has_image, app_version, server_version, comment, full_result
       FROM scans ${whereClause} ORDER BY ts DESC LIMIT 500`,
      params
    );
    const rows = result.rows.map(r => ({
      id: r.id, ts: r.ts, url: r.url, platform: r.platform,
      postText: r.post_text, overallScore: r.overall_score,
      overallLabel: r.overall_label, topMatches: r.top_matches,
      textAI: r.text_ai, hasImage: r.has_image,
      appVersion: r.app_version, serverVersion: r.server_version,
      comment: r.comment || '', fullResult: r.full_result
    }));
    // Client-side alignment type filter (needs full_result)
    let filtered = rows;
    if (alignmentType === 'primary') filtered = rows.filter(r => r.fullResult?.matches?.some(m => !m.secondary));
    if (alignmentType === 'secondary') filtered = rows.filter(r => r.fullResult?.matches?.some(m => m.secondary));
    res.json({ success: true, scans: filtered });
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
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 600, temperature: 0, messages: [{ role: 'user', content: prompt }] })
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
// INSTAGRAM FETCHER — OpenGraph scraping
// Puppeteer removed (caused Render build failures).
// Falls back to manual text if fetch is too short.
// ─────────────────────────────────────────────
async function fetchFromInstagram(url) {
  return await scrapeOpenGraph(url, 'instagram');
}

// ─────────────────────────────────────────────
// FACEBOOK FETCHER — Claude web search
// ─────────────────────────────────────────────
async function fetchFromFacebook(url) {
  return await fetchWithClaudeWebSearch(url, 'Facebook');
}

// ─────────────────────────────────────────────
// OPEN GRAPH SCRAPER
// Fallback for Instagram and Facebook
// ─────────────────────────────────────────────
async function scrapeOpenGraph(url, platform) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`Could not access ${platform} post (HTTP ${response.status}). The post may be private or deleted.`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const text =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="twitter:description"]').attr('content') ||
    $('meta[property="og:title"]').attr('content') || '';
  if (!text) throw new Error(`Could not extract text from ${platform} post. It may require login to view.`);
  // Try to extract author handle from page
  const canonicalUrl = $('meta[property="og:url"]').attr('content') || url;
  const handleMatch = canonicalUrl.match(/instagram\.com\/([^\/\?p][^\/\?]+)/i);
  return { text, author: null, authorHandle: handleMatch ? handleMatch[1] : null, source: 'opengraph' };
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
2. A one-paragraph political context summary identifying: what is being argued, who is being addressed, what action is being demanded, and what political camp this language belongs to.

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
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 600, temperature: 0, messages: [{ role: 'user', content: prompt }] })
  });
  if (!response.ok) return null;
  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  try { return JSON.parse(clean); } catch(e) { return null; }
}

async function scoreWithClaude(postText, entities) {
  // Pre-translate non-English posts for better semantic matching
  let enrichedText = postText;
  if (isNonEnglish(postText)) {
    try {
      const translation = await translatePost(postText);
      if (translation) {
        enrichedText = `ORIGINAL TEXT:\n${postText}\n\nENGLISH TRANSLATION:\n${translation.translation}\n\nPOLITICAL CONTEXT:\n${translation.political_context}`;
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
    for (const match of (result.matches || [])) {
      if (!allMatches.find(m => m.id === match.id)) allMatches.push(match);
    }
  }
  allMatches.sort((a, b) => b.pct - a.pct);

  // Run coherence check on matches above 60%
  const candidates = allMatches.filter(m => m.pct >= 60);
  let finalMatches = allMatches;
  if (candidates.length > 1) {
    try {
      const coherent = await coherenceCheck(enrichedText, candidates, entities);
      const coherentIds = new Set(coherent.map(m => m.id));
      finalMatches = allMatches.map(m => {
        if (!coherentIds.has(m.id) && m.pct >= 60) {
          return Object.assign({}, m, { pct: Math.min(m.pct, 50), why: '', missing: '', alignment: '' });
        }
        const refined = coherent.find(c => c.id === m.id);
        return refined ? Object.assign({}, m, refined) : m;
      });
    } catch(e) {
      console.warn('Coherence check failed, using raw scores:', e.message);
    }
  }

  return { text_ai_score, text_ai_reason, matches: finalMatches };
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
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1500, temperature: 0, messages: [{ role: 'user', content: prompt }] })
  });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error('Coherence check API error: ' + (err.error?.message || response.status)); }
  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  const result = JSON.parse(clean);
  return result.matches || [];
}

async function scoreBatch(postText, entities) {
  const entitySummaries = entities.map(e =>
    `ID:${e.id} NAME:${e.name} TYPE:${e.type}\nNARRATIVE: ${(e.narrative||'').slice(0,300)}\nINTEREST: ${(e.interest||'').slice(0,300)}\nMO: ${(e.mo||'').slice(0,300)}`
  ).join('\n---\n');

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
