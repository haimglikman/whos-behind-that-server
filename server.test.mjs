// WBT server tests — run with:  node --test tests/*.test.mjs
// Each run starts the real server against local stand-ins (see helpers.mjs).
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SERVER_VERSION, KEYS, needs, state, reset, start, stop, ctx, get, post, SMALL, LARGE, PIXEL_PNG, VISION_READ } from './helpers.mjs';

before(start);
after(stop);
beforeEach(reset);

const scan = (url, entities = SMALL) => post('/fetch-and-analyze', { url, entities });
const MECHANISM = 'The post documents opposition reversals, which erodes voter trust in the change bloc and so advances this entity\'s re-election.';

describe('Health and versions', () => {
  test('the server starts and reports its version', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'ok');
    assert.equal(r.data.version, SERVER_VERSION);
  });

  test('package.json carries the same version as server.js', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.version, SERVER_VERSION);
  });

  test('/system/info lists the models in use and never exposes a key', { skip: needs('2.3.0') }, async () => {
    const r = await get('/system/info');
    assert.equal(r.status, 200);
    assert.ok(r.data.models.length >= 2, 'expected at least a judge and a default model');
    const text = JSON.stringify(r.data);
    for (const key of Object.values(KEYS)) assert.ok(!text.includes(key), 'a secret key leaked into /system/info');
  });
});

describe('Access control', () => {
  test('operator data is refused without the admin key', async () => {
    assert.equal((await get('/history/list', { admin: false })).status, 401);
  });

  test('the blocked-sites list requires the admin key', { skip: needs('2.8.0') }, async () => {
    assert.equal((await get('/stats/blocked', { admin: false })).status, 401);
    const ok = await get('/stats/blocked');
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.data.sites));
  });
});

describe('Input validation', () => {
  test('a scan without a URL is rejected', async () => {
    assert.equal((await post('/fetch-and-analyze', { entities: SMALL })).status, 400);
  });
  test('a scan without entities is rejected', async () => {
    assert.equal((await post('/fetch-and-analyze', { url: ctx.mockBase + '/news/ok-article' })).status, 400);
  });
  test('a bare homepage is not treated as an article', async () => {
    const r = await scan('https://example.com/');
    assert.equal(r.status, 400);
    assert.match(r.data.error, /unsupported url/i);
  });
});

describe('News fetching', () => {
  test('a normal article is fetched and analyzed', async () => {
    const r = await scan(ctx.mockBase + '/news/ok-article');
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.platform, 'news');
    assert.match(r.data.post.text, /Normal article title/);
    assert.ok(Array.isArray(r.data.analysis.matches));
  });

  test('a bot-protected site is named as blocked, not as paywalled', { skip: needs('2.8.0'), timeout: 60000 }, async () => {
    const r = await scan(ctx.mockBase + '/news/blocked-article');
    assert.ok(r.status >= 400);
    assert.match(r.data.error, /blocks automated reading/i);
    assert.match(r.data.error, /cloudflare/i);
  });

  test('a blocked article is rescued through its AMP version', { skip: needs('2.8.0') }, async () => {
    const r = await scan(ctx.mockBase + '/news/amp-only-article');
    assert.equal(r.status, 200, r.data.error);
    assert.match(r.data.post.text, /AMP article title/);
  });

  test('Kan links are read through the app address', { skip: needs('2.8.0') }, async () => {
    const r = await scan('https://www.kan.org.il/content/kan-news/politics/item-1');
    assert.equal(r.status, 200, r.data.error);
    assert.match(r.data.post.text, /Kan article title/);
    assert.ok(state.site.includes('/content/kan-news/politics/item-1'), 'the app address was never requested');
  });
});

describe('Telegram', () => {
  test('a public channel post is read with its author, views and line breaks', { skip: needs('2.1.0') }, async () => {
    const r = await scan('https://t.me/s/testchannel/42');
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.platform, 'telegram');
    assert.equal(r.data.url, 'https://t.me/testchannel/42', 't.me/s/ links should be normalized');
    assert.equal(r.data.post.author, 'Test Channel');
    assert.equal(r.data.post.views, '12.3K');
    assert.match(r.data.post.text, /First line of the post\nSecond line/);
  });

  test('a private channel link gets a clear explanation', { skip: needs('2.1.0') }, async () => {
    const r = await scan('https://t.me/c/1234567/89');
    assert.ok(r.status >= 400);
    assert.match(r.data.error, /private/i);
  });
});

describe('Facebook and Instagram', () => {
  test('an Instagram post is read from its embed page, with caption and account', { skip: needs('2.10.0') }, async () => {
    const r = await scan('https://www.instagram.com/p/IGTEST1/');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.post.text, /Caption line one[\s\S]*Caption line two/);
    assert.equal(r.data.post.author, 'test.account');
    assert.match(ctx.log, /\[META\] instagram embed p\/IGTEST1: HTTP 200.*layer=json/);
  });

  test('an Instagram login wall is recognized and logged, not read as the post', { skip: needs('2.10.0'), timeout: 60000 }, async () => {
    await scan('https://www.instagram.com/p/IGWALL/');
    assert.match(ctx.log, /\[META\] instagram embed p\/IGWALL: .*login wall/);
  });

  test('a Facebook post is read from the embed plugin, including text hidden in comments', { skip: needs('2.10.0') }, async () => {
    const r = await scan('https://www.facebook.com/testpage/posts/123456');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.post.text, /paragraph one about the election[\s\S]*Paragraph two/);
    assert.equal(r.data.post.author, 'Test Page');
    assert.ok(state.site.some(p => p.startsWith('/plugins/post.php?href=')), 'the plugin page was requested');
  });
});

describe('Screenshot analysis', () => {
  const upload = (body, o) => post('/analyze-image', Object.assign({ image: PIXEL_PNG, mediaType: 'image/png', entities: SMALL }, body), o);

  test('a screenshot is read by Claude, then screened and judged like any post', { skip: needs('2.10.0') }, async () => {
    const r = await upload({});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.platform, 'screenshot');
    assert.equal(r.data.post.fromImage, true);
    assert.equal(r.data.post.author, VISION_READ.author);
    assert.match(r.data.post.text, /Text read from the screenshot[\s\S]*cartoon of a ballot box/);
    assert.ok(r.data.models && r.data.models.vision, 'the vision model is reported');
    const read = state.claude.find(c => c.prompt.includes('uploaded this image'));
    assert.ok(read && read.prompt.includes('"type":"image"'), 'the image itself was sent to Claude');
    assert.ok(state.claude.some(c => c.tools && c.tools[0].name === 'record_alignment'), 'the judge ran');
  });

  test('bad uploads are refused with a clear reason', { skip: needs('2.10.0') }, async () => {
    assert.equal((await upload({ image: '' })).status, 400);
    assert.equal((await upload({ mediaType: 'application/pdf' })).status, 400);
    assert.equal((await upload({ entities: [] })).status, 400);
    assert.equal((await upload({ image: 'A'.repeat(1800001) })).status, 413);
  });

  test('an image with no readable post gets a 422 and is not judged', { skip: needs('2.10.0') }, async () => {
    state.vision = { readable: false, post_text: '', image_description: null };
    const before = state.claude.length;
    const r = await upload({});
    assert.equal(r.status, 422);
    assert.ok(!state.claude.slice(before).some(c => c.tools), 'nothing was judged');
  });

  test('uploads count toward the daily scan quota', { skip: needs('2.10.0') }, () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.match(src, /scan:\s*\{\s*paths:\s*\[[^\]]*'\/analyze-image'/);
  });
});

describe('Scoring', () => {
  test('the final score is computed by the server from the three sub-scores', async () => {
    const info = (await get('/system/info')).data;
    const [wi, wm, wn] = ((info.scoring && info.scoring.weights) || '55/35/10').split('/').map(Number);
    state.judge = c => c.map((e, i) => (i === 0
      ? { id: e.id, interest: 60, mo: 40, narrative: 20, alignment: 'secondary', why: 'Because.', missing: 'Context.', mechanism: '' }
      : { id: e.id, interest: 10, mo: 10, narrative: 10, alignment: 'none', why: '', missing: '' }));
    const r = await scan(ctx.mockBase + '/news/ok-article');
    assert.equal(r.status, 200, r.data.error);
    const top = r.data.analysis.matches[0];
    assert.equal(top.name, 'Likud');
    assert.equal(top.pct, Math.round((60 * wi + 40 * wm + 20 * wn) / (wi + wm + wn)));
    const pcts = r.data.analysis.matches.map(m => m.pct);
    assert.deepEqual(pcts, [...pcts].sort((a, b) => b - a), 'matches should be sorted by score');
  });

  test('hidden interest carries 65% of the score by default', { skip: needs('2.9.0') }, async () => {
    assert.equal((await get('/system/info')).data.scoring.weights, '65/20/15');
    state.judge = c => [{ id: c[0].id, interest: 80, mo: 40, narrative: 60, alignment: 'primary', why: 'Because.', missing: 'Context.', mechanism: MECHANISM }];
    const m = (await scan(ctx.mockBase + '/news/ok-article')).data.analysis.matches[0];
    assert.equal(m.interest, 80);
    assert.equal(m.pct, 69);   // 80×0.65 + 40×0.20 + 60×0.15
  });

  test('a high interest score without a mechanism is capped at 70', { skip: needs('2.9.0') }, async () => {
    state.judge = c => [{ id: c[0].id, interest: 95, mo: 15, narrative: 15, alignment: 'secondary', why: 'Because.', missing: 'Context.', mechanism: '' }];
    const m = (await scan(ctx.mockBase + '/news/ok-article')).data.analysis.matches[0];
    assert.equal(m.interest, 70);
    assert.equal(m.interestCapped, true);
  });

  test('the judge is given the adversarial-framing rule and must answer through the tool', { skip: needs('2.0.3') }, async () => {
    const before = state.claude.length;
    await scan(ctx.mockBase + '/news/ok-article');
    const judge = state.claude.slice(before).filter(c => c.tools && c.tools[0].name === 'record_alignment').pop();
    assert.ok(judge, 'no judge request was sent');
    assert.match(judge.prompt, /ADVERSARIAL FRAMING/);
    assert.match(judge.prompt, /SCORE CALIBRATION/);
  });

  test('the judge can add a beneficiary the post never mentions', { skip: needs('2.0.2') }, async () => {
    state.jevScore = (kind, name) => (name === 'Likud' && kind === 'm' ? 0.95 : 0.05);
    state.judge = (c, others) => c.map(e => ({ id: e.id, interest: 5, mo: 5, narrative: 5, alignment: 'none', why: '', missing: '' }))
      .concat([{ id: others[0].id, interest: 90, mo: 70, narrative: 70, alignment: 'primary', why: 'Hidden beneficiary.', missing: 'Context.', mechanism: MECHANISM }]);
    const r = await post('/analyze', { postText: 'A post about the government.', entities: LARGE });
    assert.equal(r.status, 200, r.data.error);
    const added = r.data.matches.find(m => m.alignment === 'primary');
    assert.ok(added, 'the unmentioned beneficiary was dropped');
    assert.ok(added.pct >= 80);
  });
});

describe('Screening (Jev)', () => {
  test('a Hebrew post is translated, screened in English, and only the shortlist is judged in full', { skip: needs('2.0.2') }, async () => {
    state.jevScore = (kind, name) => (name === 'Likud' && kind === 'm' ? 0.95 : name === 'Shas' && kind === 'a' ? 0.8 : 0.05);
    let seen = null;
    state.judge = (c, others) => { seen = { c, others }; return c.map(e => ({ id: e.id, interest: 5, mo: 5, narrative: 5, alignment: 'none', why: '', missing: '' })); };
    const jevBefore = state.jev.length;
    const r = await post('/analyze', { postText: 'זהו פוסט בעברית על הממשלה ועל מפלגות הקואליציה והאופוזיציה', entities: LARGE });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.triage.used, true);
    const jev = state.jev[jevBefore];
    assert.equal(jev.auth, 'Bearer ' + KEYS.jev);
    assert.equal(jev.state.post, 'ENGLISH TRANSLATION OF THE POST', 'Jev should screen the English translation');
    const names = seen.c.map(e => e.name);
    assert.ok(names.includes('Likud') && names.includes('Shas'), 'entities Jev flagged must reach the judge');
    assert.ok(seen.c.length < LARGE.length, 'the judge should not receive every entity in full');
    assert.equal(seen.c.length + seen.others.length, LARGE.length, 'every entity must appear as a candidate or by name');
  });

  test('if Jev is down, every entity goes to the judge and the scan still succeeds', { skip: needs('2.0.0') }, async () => {
    state.jevFail = true;
    let count = 0;
    state.judge = c => { count = c.length; return c.map(e => ({ id: e.id, interest: 5, mo: 5, narrative: 5, alignment: 'none', why: '', missing: '' })); };
    const r = await post('/analyze', { postText: 'A post about the government.', entities: LARGE });
    assert.equal(r.status, 200, r.data.error);
    assert.equal(r.data.triage.used, false);
    assert.equal(count, LARGE.length);
  });
});

describe('Resilience', () => {
  test('models that reject temperature or forced tool calls are handled automatically', { skip: needs('2.0.1') }, async () => {
    const r = await scan(ctx.mockBase + '/news/ok-article');
    assert.equal(r.status, 200, r.data.error);
    assert.ok(state.rejections.temperature >= 1, 'the stand-in never rejected temperature — the check did not run');
    assert.ok(state.rejections.forcedTool >= 1, 'the stand-in never rejected a forced tool call — the check did not run');
  });
});

describe('Cluster detection', () => {
  test('two posts confirmed as connected form one cluster', { skip: needs('2.0.0') }, async () => {
    const posts = [
      { scanId: 'A', ts: '2026-10-01T10:00:00Z', url: 'https://x.com/a/status/1', postText: 'The deal is a surrender.', topMatches: ['Likud'], overallScore: 88 },
      { scanId: 'B', ts: '2026-10-01T11:00:00Z', url: 'https://x.com/b/status/2', postText: 'This deal is total surrender.', topMatches: ['Likud'], overallScore: 85 }
    ];
    const r = await post('/investigate/detect', { posts });
    assert.equal(r.status, 200, r.data.error);
    assert.deepEqual(r.data.clusters.map(c => [...c].sort()), [['A', 'B']]);
  });
});
