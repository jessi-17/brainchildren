// Preview for /js/cat.js: every coat and frame, big, plus a walk cycle.
import { cat, CAT_W, CAT_H, CAT_COATS } from '/js/cat.js';

const out = document.getElementById('out');
const errEl = document.getElementById('err');
addEventListener('error', (e) => {
  errEl.textContent += `error: ${e.message}\n`;
});

function big(src, s, cls = 'chk') {
  const c = document.createElement('canvas');
  c.width = src.width * s;
  c.height = src.height * s;
  c.className = cls;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// one seed per coat
const seeds = {};
for (let s = 0; Object.keys(seeds).length < CAT_COATS.length && s < 500; s++) {
  const k = cat(s).coat;
  if (!(k in seeds)) seeds[k] = s;
}

const walkers = [];
for (const coat of CAT_COATS) {
  const c = cat(seeds[coat]);
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2><b>${coat}</b> · seed ${seeds[coat]}</h2>`;
  const row = document.createElement('div');
  row.className = 'row';
  for (const [name, frame] of [['stand', c.stand], ['walk a', c.walk[0]], ['walk b', c.walk[1]], ['sit', c.sit], ['sleep', c.sleep]]) {
    const f = document.createElement('figure');
    f.append(big(frame, 6), name);
    row.append(f);
  }
  const anim = big(c.walk[0], 6);
  const f = document.createElement('figure');
  f.append(anim, 'walking');
  row.append(f);
  walkers.push({ anim, c });
  card.append(row);
  out.append(card);
}

// scale check next to a stand-in person on a little desk
{
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>at 3× beside a 20×28 stand-in (a cat asleep on a monitor)</h2>';
  const W = 120;
  const H = 44;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#d9cbff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e3a974';
  g.fillRect(0, 38, W, 6);
  // desk + monitor
  g.fillStyle = '#2b2a5e';
  g.fillRect(4, 25, 50, 5);
  g.fillRect(6, 11, 14, 11);
  g.fillStyle = '#c9b6ff';
  g.fillRect(7, 12, 12, 9);
  g.fillStyle = '#e3f4ff';
  g.fillRect(9, 13, 9, 7);
  g.fillStyle = '#2b2a5e';
  g.fillRect(12, 22, 2, 3);
  // person
  g.fillStyle = '#2b2a5e';
  g.fillRect(22, 14, 20, 28);
  g.fillStyle = '#ffb3d1';
  g.fillRect(23, 15, 18, 26);
  const cs = CAT_COATS.map((k) => cat(seeds[k]));
  g.drawImage(cs[1].sleep, 13 - 8, 11 - CAT_H);
  g.drawImage(cs[2].sit, 60, 38 - CAT_H);
  g.drawImage(cs[3].stand, 80, 38 - CAT_H);
  g.drawImage(cs[5].sleep, 100, 38 - CAT_H);
  card.append(big(c, 3, ''));
  out.append(card);
}

let t = 0;
setInterval(() => {
  t++;
  for (const w of walkers) {
    const g = w.anim.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, w.anim.width, w.anim.height);
    g.drawImage(w.c.walk[t & 1], 0, 0, w.anim.width, w.anim.height);
  }
}, 220);

console.log(`[cat] ${CAT_W}x${CAT_H}, coats: ${Object.entries(seeds).map(([k, v]) => `${k}=${v}`).join(' ')}`);
window.__catReady = true;
