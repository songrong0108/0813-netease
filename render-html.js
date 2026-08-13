const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function latestDaily() {
  const files = fs.readdirSync(DATA_DIR).filter(f => /^daily-\d{8}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('先运行 daily.js 生成推荐');
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, files[files.length - 1]), 'utf8'));
}

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const GROUP_NAMES = { 华语: '华语', 欧美: '欧美', 日语: '日系', 韩语: '韩系' };

function renderTrack(m, i) {
  const vip = (m.fee !== 0 && m.fee !== 8) ? '<span class="vip">VIP</span>' : '';
  const songUrl = `https://music.163.com/#/song?id=${m.id}`;
  const img = m.picUrl ? `<img src="${esc(m.picUrl)}" alt="">` : `<img src="" alt="" onerror="this.style.opacity=0">`;
  return `<div class="track">
  ${img}
  <div class="body">
    <div class="t-head"><span class="t-no">${String(i + 1).padStart(2, '0')}</span><span class="t-title">${esc(m.name)}</span><span class="t-artist">${esc(m.artists.join(' / '))}</span>${vip}<span class="t-tag">${esc(m.style)}</span></div>
    <div class="t-score">⭐ 评分：${m.score}${m.year ? ' · ' + m.year : ''}</div>
    <div class="t-reason"><b>偏好关联：</b>${esc(m.relate)}<br><b>内容特质：</b>${esc(m.desc)}</div>
    <a class="t-link" href="${songUrl}" target="_blank">🔗 在网易云打开</a>
  </div>
</div>`;
}

function render() {
  const daily = latestDaily();
  const picks = daily.picks;
  const d = daily.date;
  const dateStr = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

  const groups = {};
  for (const m of picks) {
    const g = GROUP_NAMES[m.lang] || '其他';
    if (!groups[g]) groups[g] = [];
    groups[g].push(m);
  }

  let body = '';
  let no = 0;
  for (const [g, list] of Object.entries(groups)) {
    body += `<div class="cluster-title">${esc(g)} <small>· 探索新声</small></div>`;
    for (const m of list) body += renderTrack(m, no++);
  }

  const vipCount = picks.filter(m => m.fee !== 0 && m.fee !== 8).length;

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>每日探索歌单 ${dateStr}</title><style>
* { box-sizing:border-box; }
body { margin:0; font-family:-apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif; background:#f6f7fb; color:#1f2430; line-height:1.65; }
.wrap { max-width:820px; margin:0 auto; padding:26px 18px 60px; }
.hero { background:linear-gradient(135deg,#2b6cff,#7b5cff); color:#fff; border-radius:18px; padding:24px 26px; box-shadow:0 10px 30px rgba(43,108,255,.25); }
.hero h1 { margin:0 0 6px; font-size:23px; }
.hero p { margin:4px 0 0; opacity:.92; font-size:13.5px; }
.badge { display:inline-block; background:rgba(255,255,255,.2); border-radius:20px; padding:3px 11px; font-size:12px; margin-top:10px; }
.note { background:#eaf6ff; border-left:4px solid #2b6cff; border-radius:8px; padding:12px 14px; font-size:13px; color:#234; margin:18px 0; }
.cluster-title { font-size:15px; font-weight:700; color:#2b6cff; margin:22px 4px 8px; }
.cluster-title small { color:#9aa2b5; font-weight:400; font-size:12px; }
.track { background:#fff; border-radius:14px; padding:14px 16px; margin:10px 0; box-shadow:0 4px 16px rgba(20,30,60,.05); display:flex; gap:14px; align-items:flex-start; }
.track img { width:56px; height:56px; border-radius:10px; object-fit:cover; flex:0 0 auto; background:#eef; }
.track .body { flex:1; min-width:0; }
.t-head { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.t-no { color:#b9c0d4; font-weight:700; font-size:13px; }
.t-title { font-weight:700; font-size:15.5px; }
.t-artist { color:#5a6275; font-size:13.5px; }
.t-tag { margin-left:auto; font-size:11px; color:#2b6cff; background:#eef3ff; border-radius:12px; padding:2px 9px; }
.vip { font-size:10px; color:#e0552b; background:#fff0e8; border-radius:8px; padding:1px 6px; }
.t-score { color:#ff8a3d; font-weight:700; font-size:12.5px; margin:5px 0 4px; }
.t-reason { font-size:13px; color:#3a4256; }
.t-reason b { color:#2b6cff; font-weight:600; }
.t-link { display:inline-block; margin-top:7px; font-size:12.5px; color:#2b6cff; text-decoration:none; border:1px solid #cfe; border-radius:8px; padding:3px 10px; }
.t-link:hover { background:#eef3ff; }
.foot { text-align:center; color:#aab0c0; font-size:12px; margin-top:28px; }
</style></head>
<body><div class="wrap">
<div class="hero">
  <h1>🎧 每日探索歌单 · ${dateStr}</h1>
  <p>基于你的听歌口味生成 · 共 ${picks.length} 首（${vipCount} 首 VIP）</p>
  <span class="badge">探索模式：排除你已听过的歌曲 / 歌手 / 专辑</span>
</div>
<div class="note">
  <b>为什么是"探索"而非"回音壁"？</b><br>
  网易云默认推荐会推"你听过的歌手 / 专辑的其他歌"——把你困在已知里。这份歌单<b>刻意避开了你听过的所有歌手和专辑</b>，
  从 16 个同审美曲风池里挑出全新声音，并结合你<b>最近一个月</b>的偏好动态调整。每天轮换，不会重复。
</div>
${body}
<div class="foot">每日探索 · 自动生成 · ${dateStr}</div>
</div></body></html>`;
}

if (require.main === module) {
  const html = render();
  const d = latestDaily().date;
  const out = path.join(DATA_DIR, `daily-${d}.html`);
  fs.writeFileSync(out, html);
  console.log('已生成:', out);
}

module.exports = { render, latestDaily };
