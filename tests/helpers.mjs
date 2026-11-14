// Test helpers: local stand-ins for every outside service, plus a real server process.
// Nothing here talks to Claude, Jev, Telegram or a real news site.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_VERSION = (fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').match(/const SERVER_VERSION = '([^']+)'/) || [])[1] || '0';
export const KEYS = { anthropic: 'test-anthropic-key', jev: 'test-jev-key', admin: 'test-admin-key' };

// Compare versions of up to four parts: atLeast('2.9.0')
export function atLeast(min) {
  const a = SERVER_VERSION.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < 4; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d > 0; }
  return true;
}
export const needs = v => (atLeast(v) ? false : `needs server ${v}+ (this is ${SERVER_VERSION})`);

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// ── What the stand-ins saw, and switches the tests can flip ──
export const state = {
  claude: [],            // every request sent to "Claude"
  jev: [],               // every request sent to "Jev"
  site: [],              // every page request
  rejections: { temperature: 0, forcedTool: 0 },
  judge: null,           // (candidates, others) => matches[]   (candidates/others: [{id, name}])
  jevScore: null,        // (kind, entityName) => 0..1          (kind: 'm' | 'a' | 'p')
  jevFail: false,
  vision: null          // the reading "Claude" returns for an uploaded image (null = a readable post)
};
export function reset() { state.judge = null; state.jevScore = null; state.jevFail = false; state.vision = null; }

const para = t => `<p>${t} This sentence pads the paragraph so the article extractor accepts it as real content.</p>`;
export const article = title => `<!DOCTYPE html><html><head><meta property="og:title" content="${title}"></head><body><article>${para('First paragraph.')}${para('Second paragraph.')}${para('Third paragraph.')}</article></body></html>`;
const CLOUDFLARE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-platform">Checking your browser</div></body></html>';
const TG_TEXT = 'First line of the post<br/>Second line of the post, long enough to analyze properly.';
const tgPage = `<!DOCTYPE html><html><head><meta property="og:title" content="Test Channel"><meta property="og:description" content="First line of the post Second line of the post, long enough to analyze properly."><meta property="og:image" content="https://cdn.example/img.jpg"></head><body></body></html>`;
const tgEmbed = `<!DOCTYPE html><html><body><div class="tgme_widget_message" data-post="testchannel/42"><a class="tgme_widget_message_owner_name"><span>Test Channel</span></a><div class="tgme_widget_message_text">${TG_TEXT}</div><span class="tgme_widget_message_views">12.3K</span><time datetime="2026-10-01T10:00:00+00:00">10:00</time></div></body></html>`;

// Instagram's embed page carries the post as escaped JSON; Facebook's plugin page hides its markup inside an HTML comment
const IG_CAPTION = 'Caption line one about the coalition\nCaption line two, long enough to analyze properly.';
const igEmbed = `<!DOCTYPE html><html><body><script>window.__x = {"contextJSON":${JSON.stringify(JSON.stringify({ context: { media: { owner: { username: 'test.account' }, display_url: 'https://cdn.example/ig.jpg', edge_media_to_caption: { edges: [{ node: { text: IG_CAPTION } }] } } } }))}};</script></body></html>`;
const igLogin = '<!DOCTYPE html><html><head><title>Login • Instagram</title></head><body></body></html>';
const fbPlugin = `<!DOCTYPE html><html><body><code><!-- <div><h5><a href="#">Test Page</a></h5><div data-testid="post_message"><p>Facebook post paragraph one about the election.</p><p>Paragraph two, long enough to analyze properly.</p></div></div> --></code></body></html>`;
export const VISION_READ = { readable: true, platform: 'Facebook', author: 'Screenshot Author', post_text: 'Text read from the screenshot, long enough to analyze.', image_description: 'A cartoon of a ballot box.', also_visible: null };
export const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function parseEntities(block) { return [...String(block || '').matchAll(/^\[([^\]]+)\] ([^\n(]+)/gm)].map(m => ({ id: m[1], name: m[2].trim() })); }

function handle(req, res, body) {
  const u = new URL(req.url, 'http://local');
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const html = (code, text, headers = {}) => { res.writeHead(code, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, headers)); res.end(text); };

  // ── "Claude" ──
  if (u.pathname === '/v1/messages') {
    const j = JSON.parse(body);
    const prompt = typeof j.messages[0].content === 'string' ? j.messages[0].content : JSON.stringify(j.messages[0].content);
    state.claude.push({ model: j.model, prompt, tools: j.tools || null, toolChoice: j.tool_choice || null, hasTemperature: 'temperature' in j });
    // Like the real Opus 5.5 / Sonnet 5: no sampling parameters, and Opus can't be forced to call a tool
    if (/opus|sonnet-5/.test(j.model) && 'temperature' in j) { state.rejections.temperature++; return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'temperature is not supported for this model' } }); }
    if (/opus/.test(j.model) && j.tool_choice && ['tool', 'any'].includes(j.tool_choice.type)) { state.rejections.forcedTool++; return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }); }
    const usage = { input_tokens: 100, output_tokens: 50 };
    if (j.tools && j.tools[0].name === 'record_alignment') {
      const candidates = parseEntities((prompt.split('CANDIDATE ENTITIES')[1] || '').split('OTHER ENTITIES')[0]);
      const others = parseEntities((prompt.split('OTHER ENTITIES')[1] || '').split('IMPORTANT:')[0]);
      const matches = state.judge ? state.judge(candidates, others)
        : candidates.map(c => ({ id: c.id, narrative: 5, interest: 5, mo: 5, alignment: 'none', why: '', missing: '' }));
      return json(200, { content: [{ type: 'tool_use', id: 't1', name: 'record_alignment', input: { text_ai_score: 2, text_ai_reason: 'Reads as human.', matches } }], stop_reason: 'tool_use', usage });
    }
    if (prompt.includes('uploaded this image for narrative analysis')) return json(200, { content: [{ type: 'text', text: JSON.stringify(state.vision || VISION_READ) }], usage });
    if (prompt.includes('full English translation')) return json(200, { content: [{ type: 'text', text: JSON.stringify({ translation: 'ENGLISH TRANSLATION OF THE POST', political_context: 'Test context.' }) }], usage });
    if (prompt.includes('PAIR 1:')) { const n = (prompt.match(/PAIR \d+:/g) || []).length; return json(200, { content: [{ type: 'text', text: JSON.stringify(Array.from({ length: n }, (_, i) => ({ pair: i + 1, connected: true, connectionType: 'narrative reinforcement', strength: 'strong', reasoning: 'Same claim.' }))) }], usage }); }
    return json(200, { content: [{ type: 'text', text: '{}' }], usage });
  }

  // ── "Jev" ──
  if (u.pathname === '/v1/systemone') {
    const j = JSON.parse(body);
    state.jev.push({ model: j.model, state: j.state, questions: j.questions, auth: req.headers.authorization });
    if (state.jevFail) return json(500, { detail: 'simulated outage' });
    const answers = {};
    for (const [k, q] of Object.entries(j.questions)) {
      const name = q.instructions && q.instructions.entity && q.instructions.entity.name;
      answers[k] = { type: 'noul', noul: state.jevScore ? state.jevScore(k[0], name) : 0.05 };
    }
    return json(200, { model: j.model, answers, usage: { input_tokens: Object.keys(j.questions).length * 60, output_tokens: 5 } });
  }

  // ── News sites, Kan's app address, Telegram ──
  state.site.push(u.pathname + u.search);
  const amp = u.searchParams.get('amp') === '1' || u.pathname.endsWith('/amp');
  if (u.pathname === '/news/ok-article') return html(200, article('Normal article title'));
  if (u.pathname.startsWith('/news/blocked-article')) return html(403, CLOUDFLARE, { server: 'cloudflare' });
  if (u.pathname.startsWith('/news/amp-only-article')) return amp ? html(200, article('AMP article title')) : html(403, CLOUDFLARE, { server: 'cloudflare' });
  if (u.pathname === '/content/kan-news/politics/item-1') return html(200, article('Kan article title'));
  if (u.pathname === '/p/IGTEST1/embed/captioned/') return html(200, igEmbed);
  if (u.pathname === '/p/IGWALL/embed/captioned/') return html(200, igLogin);
  if (u.pathname === '/plugins/post.php') return html(200, fbPlugin);
  if (u.pathname === '/testchannel/42') return html(200, u.searchParams.get('embed') === '1' ? tgEmbed : tgPage);
  return html(404, 'not found');
}

let mock, child;
export const ctx = { base: '', mockBase: '', log: '' };

export async function start() {
  mock = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { handle(req, res, b); } catch (e) { res.writeHead(500); res.end(String(e)); } }); });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  ctx.mockBase = `http://127.0.0.1:${mock.address().port}`;
  const port = await freePort();
  ctx.base = `http://127.0.0.1:${port}`;
  // A clean environment: no database, no real keys, every outside service pointed at the stand-ins
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME || '', NODE_ENV: 'test', PORT: String(port),
    ANTHROPIC_API_KEY: KEYS.anthropic, ANTHROPIC_API_URL: ctx.mockBase + '/v1/messages',
    TYPESAFE_API_KEY: KEYS.jev, TYPESAFE_API_URL: ctx.mockBase + '/v1/systemone',
    TELEGRAM_BASE_URL: ctx.mockBase, ALT_ROUTE_KAN_BASE: ctx.mockBase,
    META_IG_BASE: ctx.mockBase, META_FB_BASE: ctx.mockBase, ADMIN_KEY: KEYS.admin
  };
  child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => (ctx.log += d));
  child.stderr.on('data', d => (ctx.log += d));
  let exited = null;
  child.once('exit', code => (exited = code));
  for (let i = 0; i < 150; i++) {
    if (exited !== null) throw new Error(`The server exited during startup (code ${exited}).\n--- server output ---\n${ctx.log}`);
    try { const r = await fetch(ctx.base + '/'); if (r.ok) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`The server did not answer within 15 seconds.\n--- server output ---\n${ctx.log}`);
}

export async function stop() {
  if (child) child.kill();
  if (mock) await new Promise(r => mock.close(r));
}

// ── Request helpers ──
export async function call(method, pathname, body, { admin = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers['X-Admin-Key'] = KEYS.admin;   // admin requests skip the daily scan quotas
  const r = await fetch(ctx.base + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  return { status: r.status, data: data || {} };
}
export const get = (p, o) => call('GET', p, null, o);
export const post = (p, b, o) => call('POST', p, b, o);
export const entity = (id, name) => ({ id, name, type: 'party', narrative: `${name} narrative`, interest: `${name} interest`, mo: `${name} style` });
export const SMALL = [entity(1, 'Likud'), entity(2, 'Shas'), entity(3, 'Hamas')];
export const LARGE = ['Likud', 'Shas', 'Hamas', 'Yesh Atid', 'Democrats', 'Iran', 'Turkey', 'Hezbollah'].map((n, i) => entity(i + 1, n));
