// Who's Behind That? — Proxy Server
// Handles: post text fetching + Claude AI scoring
// Deploy to Render.com (free tier)
//
// ─────────────────────────────────────────────
// CHANGELOG
// ─────────────────────────────────────────────
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

const SERVER_VERSION = '1.3.1';

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Your Anthropic API key — set this in Render's environment variables
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ── CORS: allow your GitHub Pages domain + localhost for dev
const ALLOWED_ORIGINS = [
  /^https:\/\/.*\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser requests
    if (ALLOWED_ORIGINS.some(r => r.test(origin))) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json({ limit: '1mb' }));

// ── Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: "Who's Behind That? API", version: SERVER_VERSION });
});

// ─────────────────────────────────────────────
// POST /fetch-post
// Body: { url: "https://x.com/..." }
// Returns: { text, platform, author, timestamp }
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
// Body: { url, postText, entities }
// Returns: full Claude analysis result
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
// Body: { url, entities }
// One-shot: fetches post text then scores it
// ─────────────────────────────────────────────
app.post('/fetch-and-analyze', async (req, res) => {
  const { url, entities } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!entities || !entities.length) return res.status(400).json({ error: 'entities array is required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  try {
    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Unsupported platform. Use X, Facebook, or Instagram URLs.' });

    // Step 1: fetch post
    let postData;
    if (platform === 'x') postData = await fetchFromX(url);
    else if (platform === 'facebook') postData = await fetchFromFacebook(url);
    else if (platform === 'instagram') postData = await fetchFromInstagram(url);

    if (!postData.text) return res.status(422).json({ error: 'Could not extract post text. The post may be private or the platform may be blocking access.' });

    // Step 2: score with Claude
    const analysis = await scoreWithClaude(postData.text, entities);

    res.json({
      success: true,
      platform,
      post: postData,
      analysis
    });
  } catch (err) {
    console.error('fetch-and-analyze error:', err.message);
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
// X / TWITTER FETCHER
// Uses oEmbed API (free, no auth needed for public tweets)
// ─────────────────────────────────────────────
async function fetchFromX(url) {
  // Try oEmbed first — works for public posts, no API key needed
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;

  const response = await fetch(oembedUrl, {
    headers: { 'User-Agent': 'WhoBehindThat/1.3' },
    timeout: 10000
  });

  if (!response.ok) throw new Error(`X oEmbed API returned ${response.status}. The post may be private, deleted, or from a protected account.`);

  const data = await response.json();

  // oEmbed returns HTML — extract plain text from it
  const $ = cheerio.load(data.html || '');
  // Remove the trailing "— Author (@handle) Date" line
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
// Uses oEmbed (works for public posts)
// ─────────────────────────────────────────────
async function fetchFromFacebook(url) {
  const oembedUrl = `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(url)}`;

  const response = await fetch(oembedUrl, {
    headers: { 'User-Agent': 'WhoBehindThat/1.3' },
    timeout: 10000
  });

  if (!response.ok) {
    // Facebook oEmbed is less reliable — fall back to meta scrape
    return await scrapeOpenGraph(url, 'facebook');
  }

  const data = await response.json();
  return {
    text: data.body_text || stripHtml(data.html || ''),
    author: data.author_name || null,
    html: data.html,
    source: 'oembed'
  };
}

// ─────────────────────────────────────────────
// INSTAGRAM FETCHER
// Uses oEmbed (works for public posts)
// ─────────────────────────────────────────────
async function fetchFromInstagram(url) {
  const oembedUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&omitscript=true`;

  const response = await fetch(oembedUrl, {
    headers: { 'User-Agent': 'WhoBehindThat/1.3' },
    timeout: 10000
  });

  if (!response.ok) {
    return await scrapeOpenGraph(url, 'instagram');
  }

  const data = await response.json();
  // Extract handle from author_url e.g. https://www.instagram.com/username/
  const handleMatch = (data.author_url || '').match(/instagram\.com\/([^\/\?]+)/i);
  const authorHandle = handleMatch ? handleMatch[1] : (data.author_name || null);
  return {
    text: stripHtml(data.html || ''),
    author: data.author_name || null,
    authorHandle: authorHandle,
    html: data.html,
    source: 'oembed'
  };
}

// ─────────────────────────────────────────────
// OPEN GRAPH FALLBACK SCRAPER
// Grabs og:description / og:title from page meta
// Less detailed but works when oEmbed fails
// ─────────────────────────────────────────────
async function scrapeOpenGraph(url, platform) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'text/html',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 12000
  });

  if (!response.ok) throw new Error(`Could not access ${platform} post (HTTP ${response.status}). The post may be private or deleted.`);

  const html = await response.text();
  const $ = cheerio.load(html);

  const ogDescription = $('meta[property="og:description"]').attr('content') || '';
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const twitterDesc = $('meta[name="twitter:description"]').attr('content') || '';

  const text = ogDescription || twitterDesc || ogTitle;
  if (!text) throw new Error(`Could not extract text from ${platform} post. It may require login to view.`);

  return { text, author: null, source: 'opengraph' };
}

// ─────────────────────────────────────────────
// CLAUDE SCORING ENGINE
// Scores entities in batches of 10 for consistency.
// temperature: 0 for deterministic output.
// Returns all entities >= 60% so frontend can show
// reasoning even for moderate matches.
// ─────────────────────────────────────────────
const BATCH_SIZE = 10;

async function scoreWithClaude(postText, entities) {
  // Split entities into batches of BATCH_SIZE
  const batches = [];
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    batches.push(entities.slice(i, i + BATCH_SIZE));
  }

  // Score each batch in parallel
  const batchResults = await Promise.all(batches.map(batch => scoreBatch(postText, batch)));

  // Flatten and merge all matches, deduplicate by id
  const allMatches = [];
  let text_ai_score = 5;
  let text_ai_reason = '';

  for (const result of batchResults) {
    if (result.text_ai_score) text_ai_score = result.text_ai_score;
    if (result.text_ai_reason) text_ai_reason = result.text_ai_reason;
    for (const match of (result.matches || [])) {
      if (!allMatches.find(m => m.id === match.id)) {
        allMatches.push(match);
      }
    }
  }

  // Sort by combined score descending
  allMatches.sort((a, b) => b.pct - a.pct);

  return { text_ai_score, text_ai_reason, matches: allMatches };
}

async function scoreBatch(postText, entities) {
  const entitySummaries = entities.map(e =>
    `ID:${e.id} NAME:${e.name} TYPE:${e.type}\nNARRATIVE: ${(e.narrative||'').slice(0,300)}\nINTEREST: ${(e.interest||'').slice(0,300)}\nMO: ${(e.mo||'').slice(0,300)}`
  ).join('\n---\n');

  const prompt = `You are a senior analyst specializing in geopolitical influence operations, information warfare, and social media manipulation. Your task is to determine whose agenda a social media post serves, and what context it leaves out.

CORE PHILOSOPHY:
The primary concern is not whether a post contains outright lies, but whether it tells only half the story to serve a specific agenda. A post can be factually accurate and still be pure propaganda if it selectively presents only the facts that serve one side. Identify: (1) whose hidden interest this post serves, (2) how it was constructed to serve that interest, and (3) what relevant context is conspicuously absent.

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

IMPORTANT: Return ALL entities where combined_score >= 60 (not just 85+).
The frontend will apply the 85% threshold for display — but return everything >= 60 so reasoning is available.

For each entity with combined_score >= 60, provide:
- "why": 2-3 sentences citing specific phrases or patterns, which hidden interest is served, which MO tactics are present
- "missing": 2-3 sentences on what relevant context this post conspicuously omits

For entities with combined_score < 60, still include them with scores but "why" and "missing" can be empty strings.

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
      "why": "...",
      "missing": "..."
    }
  ]
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error('Claude API error: ' + (err.error?.message || response.status));
  }

  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────
// POST /research-actor
// Body: { handle, url }
// Returns: { actor: { name, bio, location, handles } }
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
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error('Claude API error: ' + (err.error?.message || response.status));
  }

  const data = await response.json();
  const raw = data.content.map(c => c.text || '').join('').trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}


app.listen(PORT, () => {
  console.log(`Who's Behind That? server running on port ${PORT}`);
  if (!ANTHROPIC_KEY) console.warn('WARNING: ANTHROPIC_API_KEY not set — /analyze endpoints will fail');
});
