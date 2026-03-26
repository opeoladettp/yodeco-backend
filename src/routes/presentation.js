const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const fetch = require('node-fetch');
const { authenticate } = require('../middleware/auth');
const { Category, Award, Nominee } = require('../models');
const Vote = require('../models/Vote');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Recursively convert ObjectIds and Dates to plain strings/values */
function sanitize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj.toHexString === 'function') return obj.toHexString(); // ObjectId
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (k === '__v' || k === '__t') continue; // skip mongoose internals
      out[k] = sanitize(obj[k]);
    }
    return out;
  }
  return obj;
}

/** Download a URL and return a Buffer, or null on failure */
async function fetchImage(url) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) return null;
    const buf = await res.buffer();
    return buf;
  } catch {
    return null;
  }
}

/** Resolve nominee imageUrl to a full HTTP URL */
function resolveImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  // S3 object key — build the media download URL
  const base = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .replace('portal.', 'api.')   // portal.yodeco.ng → api.yodeco.ng
    .replace(':3000', ':5000');
  return `${base}/api/media/download/${imageUrl}`;
}

// ─── route ──────────────────────────────────────────────────────────────────

/**
 * GET /api/presentation/download
 * Streams a ZIP containing index.html, presentation.css, presentation.js
 * and an images/ folder with all nominee photos.
 * Requires System_Admin or Panelist role.
 */
router.get('/download', authenticate, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['System_Admin', 'Panelist'].includes(role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    // ── 1. Fetch data ──────────────────────────────────────────────────────
    const categories = await Category.find({ isActive: true }).sort({ createdAt: 1 }).lean();

    // nominees is a virtual on Award — must NOT use .lean() so virtuals are populated
    const awardsRaw = await Award.find({ isActive: true })
      .populate({ path: 'nominees', match: { isActive: true, approvalStatus: 'approved' }, select: 'name bio imageUrl' })
      .sort({ createdAt: 1 });
    const awards = awardsRaw.map(a => a.toObject({ virtuals: true }));

    const voteCounts = await Vote.aggregate([{ $group: { _id: '$nomineeId', count: { $sum: 1 } } }]);
    const voteMap = {};
    voteCounts.forEach(v => { voteMap[v._id.toString()] = v.count; });

    // ── 2. Build slide data + collect image URLs ───────────────────────────
    // imageMap: localPath → remoteUrl
    const imageMap = {};

    const data = categories.map(cat => {
      const catId = cat._id.toString();
      const catAwards = awards
        .filter(a => {
          const awardCatId = a.categoryId ? a.categoryId.toString() : '';
          return awardCatId === catId;
        })
        .map(award => {
          const nominees = (award.nominees || []).map(n => {
            const votes = voteMap[n._id.toString()] || 0;
            const remoteUrl = resolveImageUrl(n.imageUrl);
            let localPath = null;
            if (remoteUrl) {
              // derive a safe filename from the URL
              const filename = remoteUrl.split('/').pop().split('?')[0] || `${n._id}.jpg`;
              localPath = `images/${filename}`;
              imageMap[localPath] = remoteUrl;
            }
            return { id: String(n._id), name: n.name, bio: n.bio || '', localImage: localPath, votes };
          }).sort((a, b) => b.votes - a.votes);

          const winner = nominees[0] || null;
          return { id: String(award._id), title: award.title, criteria: award.criteria || '', nominees, winner };
        });

      return { id: String(cat._id), name: cat.name, description: cat.description || '', awards: catAwards };
    }).filter(c => c.awards.length > 0);

    // ── 3. Download all images concurrently ───────────────────────────────
    const imageEntries = Object.entries(imageMap); // [[localPath, remoteUrl], ...]
    const imageBuffers = await Promise.all(
      imageEntries.map(([, url]) => fetchImage(url))
    );

    // ── 4. Stream ZIP ──────────────────────────────────────────────────────
    console.log(`[Presentation] categories=${categories.length} awards=${awards.length} slides data=${data.length} images=${imageEntries.length}`);
    data.forEach(c => console.log(`  Category: ${c.name} → ${c.awards.length} awards`));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="yodeco-awards-presentation.zip"');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { console.error('Archive error:', err); });
    archive.pipe(res);

    // Add images
    imageEntries.forEach(([localPath], i) => {
      const buf = imageBuffers[i];
      if (buf) archive.append(buf, { name: localPath });
    });

    // Add presentation.js (data + logic)
    // JSON.parse(JSON.stringify(...)) strips all Mongoose ObjectIds/Dates to plain values
    const plainData = JSON.parse(JSON.stringify(data));
    archive.append(buildJS(plainData), { name: 'presentation.js' });

    // Add presentation.css
    archive.append(buildCSS(), { name: 'presentation.css' });

    // Add index.html
    archive.append(buildHTML(), { name: 'index.html' });

    await archive.finalize();

  } catch (err) {
    console.error('Presentation download error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to generate presentation' } });
    }
  }
});

// ─── keep the old /data endpoint for backward compat ────────────────────────
router.get('/data', authenticate, async (req, res) => {
  const { role } = req.user;
  if (!['System_Admin', 'Panelist'].includes(role)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
  }
  res.json({ success: true, message: 'Use /api/presentation/download to get the full ZIP package.' });
});

module.exports = router;

// ─── file builders ──────────────────────────────────────────────────────────

function buildHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>YODECO Awards Presentation</title>
  <link rel="stylesheet" href="presentation.css"/>
</head>
<body>
  <div id="app">
    <div id="slide-container">
      <div id="slide"></div>
    </div>
    <div class="nav-controls">
      <button class="nav-btn" id="btn-prev" onclick="prevSlide()">&#8592;</button>
      <div class="slide-info">
        <span id="slide-counter">1 / 1</span>
        <div class="progress-wrap"><div id="progress-bar"></div></div>
      </div>
      <button class="nav-btn" id="btn-next" onclick="nextSlide()">&#8594;</button>
    </div>
    <button class="autoplay-btn" id="btn-autoplay" onclick="toggleAutoplay()">&#9654; Auto</button>
    <button class="fullscreen-btn" onclick="toggleFullscreen()">&#x26F6;</button>
  </div>
  <script src="presentation.js"></script>
</body>
</html>`;
}

function buildCSS() {
  return `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --green:#398213;--green-dark:#2d6b0f;--gold:#C19E33;--gold-dark:#a6852b;
  --bg:#0a0a0a;--surface:rgba(255,255,255,0.05);--border:rgba(255,255,255,0.1);
  --text:#fff;--text-muted:rgba(255,255,255,0.7);
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}
#app{height:100vh;display:flex;flex-direction:column;position:relative}
#slide-container{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
#slide-container::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 20% 50%,rgba(57,130,19,.15) 0%,transparent 60%),radial-gradient(ellipse at 80% 50%,rgba(193,158,51,.1) 0%,transparent 60%);pointer-events:none}
#slide{width:100%;height:100%;display:flex;align-items:center;justify-content:center;animation:slideIn .5s ease}
@keyframes slideIn{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}

/* ── slide inners ── */
.slide-inner{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem;text-align:center;position:relative}

/* category */
.slide-category{background:linear-gradient(135deg,rgba(57,130,19,.2) 0%,rgba(193,158,51,.1) 100%)}
.category-badge{background:var(--green);color:#fff;padding:.4rem 1.2rem;border-radius:20px;font-size:.85rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:1.5rem}
.category-name{font-size:clamp(2.5rem,6vw,5rem);font-weight:900;background:linear-gradient(135deg,#fff 0%,var(--gold) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.1;margin-bottom:1rem}
.category-desc{font-size:1.2rem;color:var(--text-muted);max-width:600px;line-height:1.6;margin-bottom:1.5rem}
.category-count{background:var(--surface);border:1px solid var(--border);padding:.5rem 1.5rem;border-radius:20px;font-size:1rem;color:var(--gold)}

/* award */
.slide-award{background:linear-gradient(135deg,rgba(193,158,51,.15) 0%,rgba(57,130,19,.1) 100%)}
.award-badge{background:var(--gold);color:#111;padding:.4rem 1.2rem;border-radius:20px;font-size:.85rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:1.5rem}
.award-title{font-size:clamp(2rem,5vw,4rem);font-weight:900;color:#fff;line-height:1.2;margin-bottom:1rem;max-width:800px}
.award-criteria{font-size:1.1rem;color:var(--text-muted);max-width:600px;line-height:1.6;margin-bottom:1.5rem}
.award-category-tag{background:var(--surface);border:1px solid var(--border);padding:.4rem 1.2rem;border-radius:20px;font-size:.9rem;color:var(--green)}

/* nominees */
.slide-nominees{justify-content:flex-start;padding-top:2rem}
.nominees-header{margin-bottom:2rem;text-align:center}
.nominees-badge{background:rgba(57,130,19,.3);border:1px solid var(--green);color:var(--green);padding:.3rem 1rem;border-radius:20px;font-size:.8rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;display:inline-block;margin-bottom:.75rem}
.nominees-award-title{font-size:clamp(1.2rem,3vw,2rem);font-weight:700;color:#fff}
.nominees-grid{display:grid;gap:1.5rem;width:100%;max-width:1100px}
.nominees-grid.n1{grid-template-columns:1fr;max-width:320px}
.nominees-grid.n2{grid-template-columns:repeat(2,1fr)}
.nominees-grid.n3{grid-template-columns:repeat(3,1fr)}
.nominees-grid.n4,.nominees-grid.n5,.nominees-grid.n6{grid-template-columns:repeat(4,1fr)}
.nominee-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:transform .2s}
.nominee-card:hover{transform:translateY(-4px)}
.nominee-img-wrap{aspect-ratio:1;overflow:hidden;background:rgba(57,130,19,.1)}
.nominee-img-wrap img{width:100%;height:100%;object-fit:cover}
.nominee-placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.3);font-size:3rem}
.nominee-info{padding:.75rem;text-align:center}
.nominee-name{font-size:clamp(.8rem,1.5vw,1rem);font-weight:700;color:#fff;line-height:1.3}
.nominee-votes{font-size:.8rem;color:var(--gold);margin-top:.25rem}
.page-label{font-size:.85rem;color:var(--gold);font-weight:400;margin-left:.5rem}

/* no-nominees */
.slide-no-nominees{background:linear-gradient(135deg,rgba(193,158,51,.1) 0%,rgba(57,130,19,.08) 100%)}
.no-nominees-msg{font-size:1.3rem;color:var(--text-muted);margin:1.5rem 0;padding:1rem 2rem;border:1px dashed var(--border);border-radius:12px}

/* winner */
.slide-winner{background:linear-gradient(135deg,rgba(193,158,51,.2) 0%,rgba(57,130,19,.15) 100%)}
.winner-glow{position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(193,158,51,.3) 0%,transparent 70%);pointer-events:none;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.1);opacity:1}}
.winner-badge{background:linear-gradient(135deg,var(--gold),var(--gold-dark));color:#111;padding:.5rem 1.5rem;border-radius:20px;font-size:.9rem;font-weight:800;letter-spacing:1px;margin-bottom:1.5rem;position:relative;z-index:1}
.winner-img-wrap{width:clamp(140px,20vw,220px);height:clamp(140px,20vw,220px);border-radius:50%;overflow:hidden;border:4px solid var(--gold);box-shadow:0 0 40px rgba(193,158,51,.5);margin-bottom:1.5rem;position:relative;z-index:1}
.winner-img-wrap img{width:100%;height:100%;object-fit:cover}
.winner-placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(193,158,51,.1);color:rgba(255,255,255,.4);font-size:4rem}
.winner-name{font-size:clamp(2rem,5vw,4rem);font-weight:900;background:linear-gradient(135deg,#fff 0%,var(--gold) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:.5rem;position:relative;z-index:1}
.winner-award{font-size:1.1rem;color:var(--text-muted);margin-bottom:.5rem;position:relative;z-index:1}
.winner-votes{font-size:1.2rem;color:var(--gold);font-weight:700;margin-bottom:1rem;position:relative;z-index:1}
.winner-stars{font-size:2rem;position:relative;z-index:1;animation:starPop .5s ease .3s both}
@keyframes starPop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}

/* nav */
.nav-controls{display:flex;align-items:center;justify-content:center;gap:1rem;padding:.75rem 1.5rem;background:rgba(0,0,0,.6);backdrop-filter:blur(10px);border-top:1px solid var(--border)}
.nav-btn{background:var(--surface);border:1px solid var(--border);color:#fff;width:44px;height:44px;border-radius:50%;font-size:1.2rem;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center}
.nav-btn:hover:not(:disabled){background:var(--green);border-color:var(--green)}
.nav-btn:disabled{opacity:.3;cursor:not-allowed}
.slide-info{display:flex;flex-direction:column;align-items:center;gap:.4rem;min-width:120px}
#slide-counter{font-size:.85rem;color:var(--text-muted)}
.progress-wrap{width:120px;height:4px;background:var(--surface);border-radius:2px;overflow:hidden}
#progress-bar{height:100%;background:linear-gradient(90deg,var(--green),var(--gold));border-radius:2px;transition:width .3s ease}
.autoplay-btn{position:fixed;bottom:70px;right:1rem;background:var(--surface);border:1px solid var(--border);color:#fff;padding:.5rem 1rem;border-radius:20px;cursor:pointer;font-size:.85rem;transition:all .2s}
.autoplay-btn:hover,.autoplay-btn.active{background:var(--green);border-color:var(--green)}
.fullscreen-btn{position:fixed;bottom:70px;right:8rem;background:var(--surface);border:1px solid var(--border);color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;transition:all .2s}
.fullscreen-btn:hover{background:var(--gold);border-color:var(--gold)}
@media(max-width:768px){
  .nominees-grid.n3,.nominees-grid.n4,.nominees-grid.n5,.nominees-grid.n6{grid-template-columns:repeat(2,1fr)}
  .slide-inner{padding:1.5rem}
}`;
}

function buildJS(data) {
  // Build flat slides array — nominees chunked into pages of 4
  const NOMINEES_PER_PAGE = 4;
  const slides = [];
  data.forEach(category => {
    slides.push({ type: 'category', category });
    category.awards.forEach(award => {
      slides.push({ type: 'award', category, award });
      if (award.nominees.length === 0) {
        slides.push({ type: 'no-nominees', category, award });
      } else {
        // chunk nominees into pages of 4
        for (var i = 0; i < award.nominees.length; i += NOMINEES_PER_PAGE) {
          var chunk = award.nominees.slice(i, i + NOMINEES_PER_PAGE);
          var page = Math.floor(i / NOMINEES_PER_PAGE) + 1;
          var totalPages = Math.ceil(award.nominees.length / NOMINEES_PER_PAGE);
          slides.push({ type: 'nominees', category, award, nominees: chunk, page: page, totalPages: totalPages });
        }
      }
      if (award.winner) {
        slides.push({ type: 'winner', category, award, winner: award.winner });
      }
    });
  });

  return `/* YODECO Awards Presentation — generated ${new Date().toISOString()} */
const SLIDES = ${JSON.stringify(slides, null, 2)};

let current = 0;
let autoTimer = null;

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function imgTag(localImage, alt, cls) {
  if (!localImage) return '<div class="' + cls + '">&#128100;</div>';
  return '<img src="' + localImage + '" alt="' + esc(alt) + '" onerror="this.remove()">';
}

function buildSlide(s) {
  if (s.type === 'category') {
    return '<div class="slide-inner slide-category">' +
      '<div class="category-badge">Category</div>' +
      '<h1 class="category-name">' + esc(s.category.name) + '</h1>' +
      (s.category.description ? '<p class="category-desc">' + esc(s.category.description) + '</p>' : '') +
      '<div class="category-count">' + s.category.awards.length + ' Award' + (s.category.awards.length !== 1 ? 's' : '') + '</div>' +
      '</div>';
  }
  if (s.type === 'award') {
    return '<div class="slide-inner slide-award">' +
      '<div class="award-badge">Award</div>' +
      '<h1 class="award-title">' + esc(s.award.title) + '</h1>' +
      (s.award.criteria ? '<p class="award-criteria">' + esc(s.award.criteria) + '</p>' : '') +
      '<div class="award-category-tag">' + esc(s.category.name) + '</div>' +
      '</div>';
  }
  if (s.type === 'no-nominees') {
    return '<div class="slide-inner slide-no-nominees">' +
      '<div class="award-badge">Award</div>' +
      '<h1 class="award-title">' + esc(s.award.title) + '</h1>' +
      '<div class="no-nominees-msg">&#128683; No nominations received for this award</div>' +
      '<div class="award-category-tag">' + esc(s.category.name) + '</div>' +
      '</div>';
  }
  if (s.type === 'nominees') {
    var pageLabel = s.totalPages > 1 ? ' <span class="page-label">(' + s.page + ' / ' + s.totalPages + ')</span>' : '';
    var n = s.nominees.length;
    var cards = s.nominees.map(function(nom) {
      return '<div class="nominee-card">' +
        '<div class="nominee-img-wrap">' + imgTag(nom.localImage, nom.name, 'nominee-placeholder') + '</div>' +
        '<div class="nominee-info">' +
          '<div class="nominee-name">' + esc(nom.name) + '</div>' +
          (nom.votes > 0 ? '<div class="nominee-votes">' + nom.votes.toLocaleString() + ' vote' + (nom.votes !== 1 ? 's' : '') + '</div>' : '') +
        '</div>' +
        '</div>';
    }).join('');
    return '<div class="slide-inner slide-nominees">' +
      '<div class="nominees-header">' +
        '<div class="nominees-badge">Nominees</div>' +
        '<h2 class="nominees-award-title">' + esc(s.award.title) + pageLabel + '</h2>' +
      '</div>' +
      '<div class="nominees-grid n' + n + '">' + cards + '</div>' +
      '</div>';
  }
  if (s.type === 'winner') {
    const w = s.winner;
    return '<div class="slide-inner slide-winner">' +
      '<div class="winner-glow"></div>' +
      '<div class="winner-badge">&#127942; Winner / Leading</div>' +
      '<div class="winner-img-wrap">' + imgTag(w.localImage, w.name, 'winner-placeholder') + '</div>' +
      '<h1 class="winner-name">' + esc(w.name) + '</h1>' +
      '<div class="winner-award">' + esc(s.award.title) + '</div>' +
      (w.votes > 0 ? '<div class="winner-votes">' + w.votes.toLocaleString() + ' votes</div>' : '') +
      '<div class="winner-stars">&#11088; &#11088; &#11088;</div>' +
      '</div>';
  }
  return '';
}

function render(idx) {
  const s = SLIDES[idx];
  const el = document.getElementById('slide');
  el.className = 'slide slide--' + s.type;
  el.innerHTML = buildSlide(s);
  document.getElementById('slide-counter').textContent = (idx + 1) + ' / ' + SLIDES.length;
  document.getElementById('progress-bar').style.width = ((idx + 1) / SLIDES.length * 100).toFixed(1) + '%';
  document.getElementById('btn-prev').disabled = idx === 0;
  document.getElementById('btn-next').disabled = idx === SLIDES.length - 1;
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = '';
}

function nextSlide() { if (current < SLIDES.length - 1) { current++; render(current); } }
function prevSlide() { if (current > 0) { current--; render(current); } }

function toggleAutoplay() {
  const btn = document.getElementById('btn-autoplay');
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
    btn.textContent = '\\u25B6 Auto';
    btn.classList.remove('active');
  } else {
    autoTimer = setInterval(function() {
      if (current < SLIDES.length - 1) { current++; render(current); }
      else { clearInterval(autoTimer); autoTimer = null; btn.textContent = '\\u25B6 Auto'; btn.classList.remove('active'); }
    }, 5000);
    btn.textContent = '\\u23F8 Auto';
    btn.classList.add('active');
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'ArrowRight' || e.key === ' ') nextSlide();
  if (e.key === 'ArrowLeft') prevSlide();
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});

if (SLIDES.length > 0) {
  render(0);
} else {
  document.getElementById('slide').innerHTML = '<div style="color:#fff;font-size:2rem;text-align:center;padding:3rem">No presentation data found.</div>';
  document.getElementById('slide-counter').textContent = '0 / 0';
}
`;
}
