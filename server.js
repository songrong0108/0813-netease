const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const {
  login_qr_key, login_qr_create, login_qr_check,
  playlist_create, playlist_tracks, user_account, user_playlist,
} = require('NeteaseCloudMusicApi');
const { generate, replace, regenerate } = require('./daily');

const PORT = Number(process.env.PORT) || 8721;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

const sessions = new Map();
let currentKey = '';

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function sessionCookie(req) {
  const sid = parseCookies(req.headers.cookie).sid;
  return sid ? (sessions.get(sid) || '') : '';
}
function setSessionCookie(res, cookie) {
  const sid = crypto.randomUUID();
  sessions.set(sid, cookie);
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  return sid;
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0');
}

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
let config = { llmEnabled: false, baseUrl: '', apiKey: '', model: 'deepseek-chat' };
if (fs.existsSync(CONFIG_FILE)) {
  try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch {}
}

async function llmSummary(song, cfg) {
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: '你是资深音乐编辑。为下面这首歌写一句中文梗概，20-40字，点出情绪/主题/风格亮点，有吸引力、有信息量，不要空话套话，不要用「这首歌」开头。' },
        { role: 'user', content: `歌名：${song.name}\n歌手：${song.artists.join('/')}\n曲风：${song.style}\n发行年份：${song.year || '未知'}\n歌词片段：${song.lyric || '无'}` },
      ],
      temperature: 0.9,
      max_tokens: 120,
    }),
  });
  const data = await res.text();
  let parsed;
  try { parsed = JSON.parse(data); } catch {
    throw new Error('接口返回了网页(HTML)而非 API JSON，说明 baseUrl 不是有效的 LLM API 地址。请填 OpenAI 兼容地址，如 https://api.deepseek.com');
  }
  if (parsed.error) throw new Error(parsed.error.message || 'LLM 调用失败');
  return ((parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || '').trim();
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function serveFile(res, filePath, type) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/' || p === '/index.html') {
      return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
    }

    if (p === '/api/qr') {
      const k = await login_qr_key();
      const unikey = (k.body.data && k.body.data.unikey) || k.body.unikey;
      currentKey = unikey;
      const q = await login_qr_create({ key: unikey, qrimg: true });
      return json(res, 200, { unikey, qrimg: (q.body.data && q.body.data.qrimg) || q.body.qrimg });
    }

    if (p === '/api/qr-check') {
      const key = url.searchParams.get('key') || currentKey;
      const c = await login_qr_check({ key });
      const code = c.body && c.body.code;
      if (code === 803) {
        const cookie = c.body.cookie || (Array.isArray(c.cookie) ? c.cookie.join('; ') : '') || '';
        setSessionCookie(res, cookie);
      }
      return json(res, 200, { code });
    }

    if (p === '/api/account') {
      const cookie = sessionCookie(req);
      if (!cookie) return json(res, 200, { loggedIn: false });
      const acc = await user_account({ cookie });
      const profile = acc.body && acc.body.profile;
      return json(res, 200, { loggedIn: !!profile, nickname: profile && profile.nickname, userId: profile && profile.userId });
    }

    if (p === '/api/logout') {
      const sid = parseCookies(req.headers.cookie).sid;
      if (sid) sessions.delete(sid);
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/my-playlist') {
      const cookie = sessionCookie(req);
      if (!cookie) return json(res, 200, { playlists: [], mineId: null });
      const acc = await user_account({ cookie });
      const uid = acc.body && acc.body.profile && acc.body.profile.userId;
      if (!uid) return json(res, 200, { playlists: [], mineId: null });
      const r = await user_playlist({ uid, cookie });
      const list = (r.body && r.body.playlist) || [];
      const mine = list.find(x => x.specialType === 5) || list.find(x => (x.name || '').includes('我喜欢的音乐'));
      return json(res, 200, {
        playlists: list.map(x => ({ id: x.id, name: x.name, specialType: x.specialType })),
        mineId: mine ? mine.id : null,
      });
    }

    if (p === '/api/generate') {
      const body = await readBody(req);
      const playlistId = body.playlistId;
      if (!playlistId) return json(res, 400, { error: '缺少 playlistId' });
      const r = await generate({ playlistId });
      if (config.llmEnabled && config.apiKey) {
        let failCount = 0;
        let firstErr = '';
        for (const m of r.picks) {
          try { m.summary = await llmSummary(m, config); } catch (e) { m.summary = ''; failCount++; firstErr = firstErr || e.message; }
        }
        if (failCount > 0) r.llmWarning = `LLM 生成失败 ${failCount}/${r.picks.length} 首（已回退歌词）：${firstErr}`;
      }
      return json(res, 200, { date: r.date, playlistName: r.playlistName, trackCount: r.trackCount, quota: r.quota, picks: r.picks, llmWarning: r.llmWarning });
    }

    if (p === '/api/config') {
      if (req.method === 'GET') {
        return json(res, 200, { llmEnabled: config.llmEnabled, baseUrl: config.baseUrl, model: config.model, hasKey: !!config.apiKey });
      }
      const body = await readBody(req);
      if (body.baseUrl !== undefined) config.baseUrl = body.baseUrl;
      if (body.model !== undefined) config.model = body.model;
      if (body.apiKey !== undefined && body.apiKey !== '') config.apiKey = body.apiKey;
      if (body.llmEnabled !== undefined) config.llmEnabled = !!body.llmEnabled;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      return json(res, 200, { llmEnabled: config.llmEnabled, baseUrl: config.baseUrl, model: config.model, hasKey: !!config.apiKey });
    }

    if (p === '/api/create') {
      const body = await readBody(req);
      const cookie = sessionCookie(req);
      if (!cookie) return json(res, 401, { error: '未登录' });
      const picks = body.picks || [];
      if (!picks.length) return json(res, 400, { error: '没有歌曲' });
      const name = body.name || '每日探索';
      const cr = await playlist_create({ name, privacy: 0, cookie });
      const pid = (cr.body && cr.body.id);
      if (!pid) return json(res, 500, { error: '创建失败', detail: cr.body });
      const ids = picks.map(x => x.id).join(',');
      const add = await playlist_tracks({ op: 'add', pid, tracks: ids, cookie });
      return json(res, 200, { pid, name, link: `https://music.163.com/#/playlist?id=${pid}`, added: !!add.body });
    }

    if (p === '/api/regenerate') {
      const seedStr = String(Date.now());
      const picks = await regenerate(seedStr);
      return json(res, 200, { picks: picks || [] });
    }

    if (p === '/api/replace') {
      const body = await readBody(req);
      const song = await replace(body.picks || [], body.excludeId, String(Date.now()));
      return json(res, 200, { song });
    }

    if (p === '/api/llm-test') {
      const body = await readBody(req);
      const cfg = {
        baseUrl: (body.baseUrl !== undefined && body.baseUrl !== '' ? body.baseUrl : config.baseUrl) || '',
        apiKey: (body.apiKey !== undefined && body.apiKey !== '' ? body.apiKey : config.apiKey) || '',
        model: (body.model !== undefined && body.model !== '' ? body.model : config.model) || '',
      };
      if (!cfg.baseUrl || !cfg.apiKey) return json(res, 200, { ok: false, error: '请先填写 LLM 接口地址和 API Key' });
      try {
        const base = cfg.baseUrl.replace(/\/+$/, '');
        const r = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: '请只回复两个字：成功' }], max_tokens: 20 }),
        });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch {
          return json(res, 200, { ok: false, error: '返回的是网页(HTML)而非 API JSON —— baseUrl 不是有效的 LLM API 地址。请填 OpenAI 兼容地址，如 https://api.deepseek.com' });
        }
        if (data.error) return json(res, 200, { ok: false, error: `${data.error.code || ''} ${data.error.message || '接口返回错误'}`.trim() });
        const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        return json(res, 200, { ok: true, reply: (reply || '').trim(), model: cfg.model });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      }
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

http.createServer(handle).listen(PORT, () => {
  console.log('每日探索歌单已启动，端口', PORT);
  if (process.platform === 'win32') {
    try { execSync(`start "" "http://localhost:${PORT}"`); } catch {}
  }
});
