const { style_song, song_detail } = require('NeteaseCloudMusicApi');
const fs = require('fs');
const path = require('path');

const pl = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'playlist.json'), 'utf8'));
const knownSongs = new Set();
const knownArtists = new Set();
const knownAlbums = new Set();
for (const t of pl.tracks) {
  knownSongs.add(t.id);
  (t.ar || []).forEach(a => knownArtists.add(a.id));
  if (t.al) knownAlbums.add(t.al.id);
}

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

function yearOf(publishTime) {
  return publishTime ? new Date(publishTime).getFullYear() : null;
}

(async () => {
  const collected = [];
  for (const s of STYLES) {
    try {
      const r = await style_song({ tagId: s.tagId, size: 200 });
      const songs = (r.body && r.body.data && r.body.data.songs) || [];
      songs.forEach(song => collected.push({ style: s.name, song }));
      process.stdout.write(`  ${s.name}: ${songs.length} 首\n`);
    } catch (e) {
      console.error(`  [ERR] ${s.name}:`, e.message);
    }
    await sleep(250);
  }
  console.log('捞取总数:', collected.length);

  const byId = new Map();
  for (const x of collected) {
    if (!byId.has(x.song.id)) byId.set(x.song.id, x);
  }
  const unique = [...byId.values()];
  console.log('去重后:', unique.length);

  const ids = unique.map(x => x.song.id);
  const detailMap = new Map();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400).join(',');
    try {
      const r = await song_detail({ ids: chunk });
      (r.body && r.body.songs || []).forEach(s => detailMap.set(s.id, s));
    } catch (e) { console.error('song_detail err:', e.message); }
    await sleep(250);
  }
  console.log('补充详情:', detailMap.size);

  const merged = unique.map(x => {
    const d = detailMap.get(x.song.id) || {};
    return {
      style: x.style,
      id: x.song.id,
      name: d.name || x.song.name,
      artists: (d.ar || x.song.ar || []).map(a => a.name),
      artistIds: (d.ar || x.song.ar || []).map(a => a.id),
      album: (d.al || x.song.al || {}).name,
      albumId: (d.al || x.song.al || {}).id,
      pop: d.pop != null ? d.pop : x.song.pop,
      fee: d.fee != null ? d.fee : x.song.fee,
      year: yearOf(d.publishTime) || yearOf(x.song.publishTime),
    };
  });

  const fresh = merged.filter(m => {
    if (knownSongs.has(m.id)) return false;
    if (m.artistIds.some(a => knownArtists.has(a))) return false;
    if (m.albumId && knownAlbums.has(m.albumId)) return false;
    return true;
  });
  console.log('过滤已听歌曲/歌手/专辑后:', fresh.length);

  const byArtist = new Map();
  const limited = [];
  for (const m of fresh) {
    const key = m.artistIds.join(',') || m.artists.join(',');
    const c = byArtist.get(key) || 0;
    if (c >= 2) continue;
    byArtist.set(key, c + 1);
    limited.push(m);
  }
  console.log('歌手限量(≤2首)后:', limited.length);

  const freeFirst = (a, b) => {
    const fa = (a.fee === 0 || a.fee === 8) ? 0 : 1;
    const fb = (b.fee === 0 || b.fee === 8) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return (b.pop || 0) - (a.pop || 0);
  };
  limited.sort(freeFirst);

  const byStyle = new Map();
  for (const m of limited) {
    if (!byStyle.has(m.style)) byStyle.set(m.style, []);
    byStyle.get(m.style).push(m);
  }

  const PICK = 10;
  const finalList = [];
  console.log('\n===== 精选结果 (每曲风', PICK, '首) =====');
  for (const [style, list] of byStyle) {
    const picked = list.slice(0, PICK);
    finalList.push(...picked);
    console.log(`\n【${style}】`);
    picked.forEach((m, i) => {
      const free = (m.fee === 0 || m.fee === 8) ? '免费' : 'VIP';
      console.log(`  ${i + 1}. ${m.name} | ${m.artists.join('/')} | ${m.year || '?'} | ${free}`);
    });
  }

  console.log('\n========== 合计', finalList.length, '首 ==========');
  const freeCount = finalList.filter(m => m.fee === 0 || m.fee === 8).length;
  console.log(`免费 ${freeCount} 首 / VIP ${finalList.length - freeCount} 首`);

  fs.writeFileSync(path.join(__dirname, 'data', 'explore-v2.json'), JSON.stringify(finalList, null, 2));
  console.log('已保存 data/explore-v2.json');
})();
