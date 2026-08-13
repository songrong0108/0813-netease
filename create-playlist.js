const {
  login_qr_key, login_qr_create, login_qr_check,
  playlist_create, playlist_tracks, user_account, login_status,
} = require('NeteaseCloudMusicApi');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR = path.join(__dirname, 'data');
const COOKIE_FILE = path.join(DATA_DIR, 'cookie.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function latestDaily() {
  const files = fs.readdirSync(DATA_DIR).filter(f => /^daily-\d{8}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('先运行 daily.js 生成今日推荐');
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, files[files.length - 1]), 'utf8'));
}

async function loginWithQR() {
  const k = await login_qr_key();
  const unikey = (k.body.data && k.body.data.unikey) || k.body.unikey;
  const q = await login_qr_create({ key: unikey, qrimg: true });
  const qrimg = (q.body.data && q.body.data.qrimg) || q.body.qrimg;
  const qrurl = (q.body.data && q.body.data.qrurl) || q.body.qrurl;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>网易云扫码登录</title></head>
<body style="font-family:sans-serif;text-align:center;padding-top:40px">
<h2>打开网易云音乐 App 扫码登录</h2>
<img src="${qrimg}" style="width:280px;height:280px">
<p>扫码后在 App 里点击「确认登录」</p>
<p style="color:#999">或复制链接到浏览器打开: <a href="${qrurl}">${qrurl}</a></p>
</body></html>`;
  const qrFile = path.join(DATA_DIR, 'login-qr.html');
  fs.writeFileSync(qrFile, html);
  console.log('已生成二维码页面:', qrFile);
  console.log('正在用浏览器打开...');
  try { execSync(`start "" "${qrFile}"`); } catch (e) { console.log('（无法自动打开，请手动双击上面的文件）'); }
  console.log('请扫码后在 App 内确认登录...\n');

  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    const c = await login_qr_check({ key: unikey });
    const code = c.body && c.body.code;
    if (code === 803) {
      const cookie = c.body.cookie || (Array.isArray(c.cookie) ? c.cookie.join('; ') : c.cookie) || '';
      fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookie, unikey, time: Date.now() }, null, 2));
      console.log('登录成功！cookie 已保存到 data/cookie.json\n');
      return cookie;
    } else if (code === 800) {
      process.stdout.write('.');
    } else if (code === 801) {
      process.stdout.write(' 已扫码，等待确认...\n');
    } else if (code === 804 || code === 802) {
      console.log('（二维码状态:', code, '继续等待）');
    } else if (code === 805) {
      console.log('二维码已过期，请重新运行');
      throw new Error('QR expired');
    }
  }
  throw new Error('扫码超时');
}

async function getCookie() {
  if (fs.existsSync(COOKIE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    if (saved.cookie) {
      const st = await login_status({ cookie: saved.cookie });
      const ok = st.body && st.body.data && st.body.data.code === 200;
      if (ok) { console.log('使用已保存的登录态\n'); return saved.cookie; }
      console.log('登录态已失效，重新扫码...\n');
    }
  }
  return loginWithQR();
}

(async () => {
  const daily = latestDaily();
  const picks = daily.picks;
  const today = daily.date;
  const y = today.slice(0, 4), m = today.slice(4, 6), d = today.slice(6, 8);
  console.log(`今日推荐 ${picks.length} 首 (${y}-${m}-${d})\n`);

  const cookie = await getCookie();

  const acc = await user_account({ cookie });
  const profile = acc.body && acc.body.profile;
  const nickname = (profile && profile.nickname) || '我';
  console.log(`当前账号: ${nickname}\n`);

  const plName = `每日探索 ${m}-${d}`;
  console.log(`创建歌单「${plName}」...`);
  const cr = await playlist_create({ name: plName, privacy: 0, cookie });
  const pid = (cr.body && cr.body.id) || cr.body.playlistId;
  if (!pid) { console.error('创建失败:', JSON.stringify(cr.body).slice(0, 300)); return; }
  console.log('歌单 id:', pid);

  const ids = picks.map(p => p.id).join(',');
  console.log(`添加 ${picks.length} 首歌...`);
  const add = await playlist_tracks({ op: 'add', pid, tracks: ids, cookie });
  const trackIds = add.body && add.body.trackIds;
  console.log('添加结果:', trackIds ? `成功 (${JSON.parse(trackIds).length} 首)` : JSON.stringify(add.body).slice(0, 200));

  const link = `https://music.163.com/#/playlist?id=${pid}`;
  console.log('\n================ 完成 ================');
  console.log('歌单链接:', link);
  console.log('口令: 分享我的歌单《' + plName + '》 ' + link + ' (@网易云音乐)');
  console.log('======================================');
})();
