const { style_song, song_detail, playlist_detail, lyric } = require('NeteaseCloudMusicApi');
const fs = require('fs');
const path = require('path');

const PLAYLIST_ID = 122115618;
const DAILY_N = 15;
const RECENT_WINDOW = 60;
const POOL_FILE = path.join(__dirname, 'data', 'style-pool.json');

const STYLES = [
  { tagId: 1042, name: '梦幻流行' },
  { tagId: 10179, name: '仙音' },
  { tagId: 8220, name: '盯鞋摇滚' },
  { tagId: 11153, name: '另类流行' },
  { tagId: 1035, name: '独立流行' },
  { tagId: 10181, name: '悲核' },
  { tagId: 11190, name: '室内流行' },
  { tagId: 1502, name: '合成器流行' },
  { tagId: 1280, name: '另类R&B' },
  { tagId: 8138, name: '新灵魂乐' },
  { tagId: 7080, name: 'City Pop' },
  { tagId: 7092, name: '日系摇滚' },
  { tagId: 1147, name: '独立民谣' },
  { tagId: 1021, name: '当代民谣' },
  { tagId: 11192, name: '后朋克' },
  { tagId: 8205, name: '新迷幻' },
];

const STYLE_DESC = {
  '梦幻流行': '慵懒朦胧的吉他与人声，营造白日梦般的漂浮感',
  '仙音': '空灵缥缈的女声与氛围化编曲，如坠云雾',
  '盯鞋摇滚': '层层叠叠的吉他噪音墙，沉浸式的声场包裹',
  '另类流行': '不按常理出牌的结构与旋律，新鲜感十足',
  '独立流行': '独立质感的旋律与细腻编排，清新又不流俗',
  '悲核': '克制深沉的情绪底色，缓慢铺陈的伤感',
  '室内流行': '精致考究的弦乐与和声，温润而雅致',
  '合成器流行': '复古合成器音色与律动，抓耳又上头',
  '另类R&B': '丝滑的假声与电子节拍，夜晚氛围拉满',
  '新灵魂乐': '松弛的律动与深情唱腔，灵魂乐的新表达',
  'City Pop': '霓虹般复古的都市律动，温暖又浪漫',
  '日系摇滚': '日式旋律与摇滚编配，情绪与爆发力并存',
  '独立民谣': '质朴的吉他与叙事感歌词，安静而有力量',
  '当代民谣': '现代的民谣表达，真诚而贴近生活',
  '后朋克': '冷峻的贝斯线与人声，压抑中暗涌张力',
  '新迷幻': '迷幻的音色与循环结构，令人眩晕的旅程',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const hasCJK = s => /[\u4e00-\u9fff]/.test(s);
const hasKana = s => /[\u3040-\u30ff]/.test(s);
const hasHangul = s => /[\uac00-\ud7af]/.test(s);
const JP_STYLES = ['日系摇滚', 'City Pop'];
function detectLang(name, artists, style) {
  const s = `${name} ${artists.join(' ')}`;
  if (hasHangul(s)) return '韩语';
  if (hasKana(s)) return '日语';
  if (hasCJK(s)) {
    if (style && JP_STYLES.includes(style)) return '日语';
    return '华语';
  }
  return '欧美';
}

function yearOf(t) { return t ? new Date(t).getFullYear() : null; }

function seededRand(seedStr) {
  let seed = 0;
  for (const ch of String(seedStr)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xFFFFFFFF; };
}

function seededShuffle(arr, seedStr) {
  const rand = seededRand(seedStr);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function quotas(shares, total) {
  const raw = new Map();
  let assigned = 0;
  for (const [k, v] of shares) { raw.set(k, { floor: Math.floor(v * total), rem: v * total - Math.floor(v * total) }); assigned += raw.get(k).floor; }
  const order = [...raw.entries()].sort((a, b) => b[1].rem - a[1].rem);
  for (let i = 0; assigned < total; i++) { raw.get(order[i % order.length][0]).floor++; assigned++; }
  const out = {};
  for (const [k, v] of raw) out[k] = v.floor;
  return out;
}

async function getPlaylist(id) {
  const r = await playlist_detail({ id, n: 100000, s: 8 });
  const pl = r.body && r.body.playlist;
  if (!pl) throw new Error('playlist fetch failed');
  return pl;
}

async function getStylePool(refresh) {
  if (!refresh && fs.existsSync(POOL_FILE)) {
    return JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
  }
  const collected = [];
  const PAGE_SIZE = 200;
  const PAGES = 3;
  for (const s of STYLES) {
    for (let page = 0; page < PAGES; page++) {
      try {
        const r = await style_song({ tagId: s.tagId, size: PAGE_SIZE, cursor: page * PAGE_SIZE });
        const songs = (r.body && r.body.data && r.body.data.songs) || [];
        songs.forEach(song => collected.push({ style: s.name, song }));
        const more = r.body && r.body.data && r.body.data.page && r.body.data.page.more;
        if (!more) break;
      } catch (e) { console.error('style_song err:', s.name, e.message); break; }
      await sleep(250);
    }
  }
  const byId = new Map();
  for (const x of collected) if (!byId.has(x.song.id)) byId.set(x.song.id, x);
  const unique = [...byId.values()];

  const ids = unique.map(x => x.song.id);
  const detailMap = new Map();
  for (let i = 0; i < ids.length; i += 400) {
    try {
      const r = await song_detail({ ids: ids.slice(i, i + 400).join(',') });
      (r.body && r.body.songs || []).forEach(s => detailMap.set(s.id, s));
    } catch (e) { console.error('song_detail err:', e.message); }
    await sleep(250);
  }

  const pool = unique.map(x => {
    const d = detailMap.get(x.song.id) || {};
    const al = d.al || x.song.al || {};
    return {
      style: x.style,
      id: x.song.id,
      name: d.name || x.song.name,
      artists: (d.ar || x.song.ar || []).map(a => a.name),
      artistIds: (d.ar || x.song.ar || []).map(a => a.id),
      album: al.name,
      albumId: al.id,
      picUrl: al.picUrl || '',
      pop: d.pop != null ? d.pop : x.song.pop,
      fee: d.fee != null ? d.fee : x.song.fee,
      year: yearOf(d.publishTime) || yearOf(x.song.publishTime),
    };
  });
  fs.writeFileSync(POOL_FILE, JSON.stringify(pool, null, 2));
  return pool;
}

function scoreOf(pop, rand) {
  if (pop == null) return 88;
  if (pop >= 85) return 60;
  if (pop < 5) return 60;
  if (pop <= 30) return 92 + Math.floor(rand() * 6);
  if (pop <= 50) return 86 + Math.floor(rand() * 8);
  return 78 + Math.floor(rand() * 8);
}

function decorate(m, seedStr) {
  const rand = seededRand(seedStr + m.id);
  m.score = scoreOf(m.pop, rand);
  return m;
}

function pickLyric(lyricText) {
  if (!lyricText) return '';
  const meta = /^(作词|作曲|编曲|制作人|混音|母带|和声|合声|录音|吉他|贝斯|鼓|键盘|钢琴|弦乐|监制|统筹|发行|出品|OP|SP|混|录|吉|贝|鼓|词|曲|Program|Strings|Drums|Guitar|Bass)/i;
  const lines = lyricText.split('\n')
    .map(l => l.replace(/\[[^\]]*\]/g, '').trim())
    .filter(l => l && !meta.test(l) && !/[：:]/.test(l) && !/^[·,，。.!！?？、\s]*$/.test(l));
  const uniq = [];
  const seen = new Set();
  for (const l of lines) { if (!seen.has(l)) { seen.add(l); uniq.push(l); } }
  const cjk = uniq.filter(l => /[\u4e00-\u9fff]/.test(l) && l.length >= 6 && l.length <= 30);
  const pool = cjk.length ? cjk : uniq.filter(l => l.length >= 4 && l.length <= 40);
  if (!pool.length) return uniq[0] || '';
  return pool[Math.floor(pool.length * 0.4)];
}

async function attachLyrics(picks) {
  for (const m of picks) {
    try {
      const l = await lyric({ id: m.id });
      const lrc = l.body && l.body.lrc && l.body.lrc.lyric;
      m.lyric = pickLyric(lrc);
    } catch { m.lyric = ''; }
    await sleep(150);
  }
  return picks;
}

let _cache = null;

const NICHE_LEVELS = {
  light: { hotMin: 90, coldMax: 50, hot: 2, cold: 1, midCenter: 68, midSigma: 20 },
  medium: { hotMin: 85, coldMax: 35, hot: 2, cold: 2, midCenter: 55, midSigma: 16 },
  deep: { hotMin: 70, coldMax: 20, hot: 1, cold: 3, midCenter: 35, midSigma: 15 },
};

function gaussWeight(pop, center, sigma) {
  if (pop == null) return 0.3;
  const d = (pop - center) / sigma;
  return Math.exp(-0.5 * d * d);
}

function sampleByNiche(fresh, quota, seedStr, niche) {
  const level = NICHE_LEVELS[niche] || NICHE_LEVELS.medium;
  const hot = [], mid = [], cold = [];
  for (const m of fresh) {
    const p = m.pop == null ? 50 : m.pop;
    if (p >= level.hotMin) hot.push(m);
    else if (p <= level.coldMax) cold.push(m);
    else mid.push(m);
  }

  const picks = [];
  const usedArtists = new Set();
  const usedStyles = new Map();
  const canPick = m => {
    if (picks.includes(m)) return false;
    const akey = m.artistIds.join(',') || m.artists.join(',');
    if (usedArtists.has(akey)) return false;
    if ((usedStyles.get(m.style) || 0) >= 2) return false;
    return true;
  };
  const take = m => {
    usedArtists.add(m.artistIds.join(',') || m.artists.join(','));
    usedStyles.set(m.style, (usedStyles.get(m.style) || 0) + 1);
    picks.push(m);
  };
  const pickRandom = (list, n, tag) => {
    const arr = seededShuffle(list, seedStr + tag);
    for (const m of arr) {
      if (picks.length >= DAILY_N || n <= 0) break;
      if (canPick(m)) { take(m); n--; }
    }
  };

  pickRandom(hot, level.hot, 'hot');
  pickRandom(cold, level.cold, 'cold');

  const midByLang = new Map();
  for (const m of mid) {
    if (!midByLang.has(m.lang)) midByLang.set(m.lang, []);
    midByLang.get(m.lang).push(m);
  }
  for (const [l, arr] of midByLang) {
    const rand = seededRand(seedStr + 'mid' + l);
    arr.sort((a, b) => (gaussWeight(b.pop, level.midCenter, level.midSigma) + rand() * 0.25) - (gaussWeight(a.pop, level.midCenter, level.midSigma) + rand() * 0.25));
  }

  const tryPick = lang => {
    if (picks.length >= DAILY_N) return false;
    const arr = midByLang.get(lang) || [];
    for (const m of arr) {
      if (picks.length >= DAILY_N) return false;
      if (canPick(m)) { take(m); return true; }
    }
    return false;
  };

  for (const [lang, q] of Object.entries(quota)) for (let i = 0; i < q; i++) tryPick(lang);
  while (picks.length < DAILY_N) {
    let filled = false;
    for (const lang of Object.keys(midByLang)) { if (picks.length >= DAILY_N) break; if (tryPick(lang)) filled = true; }
    if (!filled) break;
  }
  return picks.slice(0, DAILY_N);
}

function select(pool, known, quota, seedStr, langAnchors, niche = 'medium') {
  const fresh = pool.filter(m => {
    if (known.songs.has(m.id)) return false;
    if (m.artistIds.some(a => known.artists.has(a))) return false;
    if (m.albumId && known.albums.has(m.albumId)) return false;
    return true;
  });

  for (const m of fresh) m.lang = detectLang(m.name, m.artists, m.style);

  const out = sampleByNiche(fresh, quota, seedStr, niche);
  for (const m of out) decorate(m, seedStr);
  return { picks: out, fresh };
}

function replace(picks, excludeId, seedStr) {
  if (!_cache || !_cache.fresh) return null;
  const victim = picks.find(p => p.id === excludeId);
  if (!victim) return null;
  const usedIds = new Set(picks.map(p => p.id));
  const usedArtists = new Set(picks.filter(p => p.id !== excludeId).map(p => p.artistIds.join(',') || p.artists.join(',')));
  const usedStyles = new Set(picks.filter(p => p.id !== excludeId).map(p => p.style));

  const candidates = _cache.fresh.filter(m => {
    if (m.lang !== victim.lang) return false;
    if (usedIds.has(m.id)) return false;
    if (usedArtists.has(m.artistIds.join(',') || m.artists.join(','))) return false;
    return true;
  });

  const sameStyle = candidates.filter(m => m.style === victim.style);
  const pool2 = sameStyle.length ? sameStyle : candidates;
  if (!pool2.length) return null;

  const rand = seededRand(seedStr || String(Date.now()));
  const pick = pool2[Math.floor(rand() * pool2.length)];
  decorate(pick, seedStr || String(Date.now()));
  return attachLyrics([pick]).then(() => pick);
}

async function regenerate(seedStr) {
  if (!_cache || !_cache.fresh) return null;
  const { fresh, quota, niche } = _cache;
  const out = sampleByNiche(fresh, quota, seedStr, niche);
  for (const m of out) decorate(m, seedStr);
  await attachLyrics(out);
  return out;
}

async function generate({ playlistId = PLAYLIST_ID, refresh = false, seed, randSeed, niche = 'medium' } = {}) {
  const today = seed || new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const pl = await getPlaylist(playlistId);
  const tracks = pl.tracks;

  const known = { songs: new Set(), artists: new Set(), albums: new Set() };
  for (const t of tracks) {
    known.songs.add(t.id);
    (t.ar || []).forEach(a => known.artists.add(a.id));
    if (t.al) known.albums.add(t.al.id);
  }

  const recent = tracks.slice(0, RECENT_WINDOW);
  const langCount = new Map();
  const langArtists = new Map();
  for (const t of recent) {
    const names = (t.ar || []).map(a => a.name);
    const l = detectLang(t.name, names);
    langCount.set(l, (langCount.get(l) || 0) + 1);
    if (!langArtists.has(l)) langArtists.set(l, new Map());
    const am = langArtists.get(l);
    names.forEach(n => am.set(n, (am.get(n) || 0) + 1));
  }
  const langAnchors = {};
  for (const [l, am] of langArtists) {
    langAnchors[l] = [...am.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  }

  const shares = new Map([...langCount.entries()].map(([k, v]) => [k, v / recent.length]));
  const quota = quotas(shares, DAILY_N);

  const pool = await getStylePool(refresh);
  const seedStr = randSeed || today;
  const { picks, fresh } = select(pool, known, quota, seedStr, langAnchors, niche);
  _cache = { fresh, known, quota, langAnchors, niche };
  await attachLyrics(picks);

  return { date: today, playlistName: pl.name, trackCount: tracks.length, quota, picks, langAnchors };
}

module.exports = { generate, detectLang, replace, regenerate };

if (require.main === module) {
  (async () => {
    const refresh = process.argv.includes('--refresh');
    const r = await generate({ refresh });
    console.log('\n========== 今日推荐', r.picks.length, '首 ==========');
    r.picks.forEach((m, i) => {
      const vip = (m.fee !== 0 && m.fee !== 8) ? ' [VIP]' : '';
      console.log(`${String(i + 1).padStart(2)}. [${m.lang}] ${m.name} | ${m.artists.join('/')} | ${m.year || '?'} | ${m.style} | ⭐${m.score}${vip}`);
    });
    fs.writeFileSync(path.join(__dirname, 'data', `daily-${r.date}.json`), JSON.stringify(r, null, 2));
    console.log('\n已保存 data/daily-' + r.date + '.json');
  })().catch(e => { console.error(e); process.exit(1); });
}
