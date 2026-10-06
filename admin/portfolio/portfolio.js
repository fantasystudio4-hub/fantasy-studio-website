/* Fantasy Studio admin — Portfolio page.
   Upload photos / films / reels to Firebase Storage, list them in Firestore
   portfolio/{id}, and approve or decline portfolioRequests/{uid}. Signs in
   through the same Firebase session as the main admin (same origin). */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ADMINS = ['fantasystudio4@gmail.com'];
const V = '10.12.2';

if(!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey){ /* config is loaded below */ }
await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '../../firebase-config.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }).catch(() => {});

const gate = $('#gate');
if(!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey){ gate.textContent = 'Firebase is not set up.'; throw new Error('no config'); }

const { initializeApp, getApps, getApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const { getAuth, onAuthStateChanged } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
const fsm = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
const stm = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-storage.js`);
const { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch } = fsm;
const { getStorage, ref: sref, uploadBytesResumable, getDownloadURL, deleteObject } = stm;

const app = getApps().length ? getApp() : initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app), db = getFirestore(app), storage = getStorage(app);

let started = false, REQS = [], ITEMS = [];
onAuthStateChanged(auth, user => {
  if(!user || !ADMINS.includes(String(user.email || '').toLowerCase())){
    gate.hidden = false; $('#app').hidden = true;
    gate.innerHTML = 'Sign in to the admin first, then come back here.<br><br><a class="btn" style="display:inline-block;text-decoration:none" href="../">Open admin</a>';
    return;
  }
  gate.hidden = true; $('#app').hidden = false;
  if(!started){ started = true; start(); }
});

function start(){
  onSnapshot(collection(db, 'portfolioRequests'), snap => {
    REQS = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    renderReqs();
  }, e => { $('#reqBox').innerHTML = `<p class="err">Could not load requests (${esc(e.code || e.message)}) — publish the updated firestore.rules first.</p>`; });
  onSnapshot(query(collection(db, 'portfolio'), orderBy('order')), snap => {
    ITEMS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLib();
  }, e => { $('#lib').innerHTML = `<p class="err">Could not load the library (${esc(e.code || e.message)}).</p>`; });
}

/* ---------- requests ---------- */
const ms = t => t && typeof t.toMillis === 'function' ? t.toMillis() : 0;
function ago(t){ const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return !t ? '' : m < 2 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }
function renderReqs(){
  const by = s => REQS.filter(r => (r.status || 'pending') === s).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const pend = by('pending'), ok = by('approved'), no = by('declined');
  $('#reqCount').textContent = pend.length ? pend.length + ' waiting' : ok.length + ' approved';
  if(!REQS.length){ $('#reqBox').innerHTML = '<p class="sub">No requests yet. When someone taps “Request portfolio access” it appears here.</p>'; return; }
  const row = (r, btns, tag) => `<div class="req"><div><b>${esc(r.name || 'No name')}</b><small>${esc(r.phoneFull || r.phone10 || '')} · ${esc(ago(ms(r.createdAt)))}</small></div>
    <div class="row">${tag ? `<span class="tag ${tag === 'Approved' ? 'ok' : ''}">${tag}</span>` : ''}${btns}</div></div>`;
  const wa = r => { const n = String(r.phoneFull || r.phone10 || '').replace(/\D/g, ''); return n ? `<a class="btn ghost sm" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener" href="https://wa.me/${n}">WhatsApp</a>` : ''; };
  $('#reqBox').innerHTML =
    pend.map(r => row(r, `${wa(r)}<button class="btn sm" data-a="approved" data-id="${esc(r.id)}">Approve</button><button class="btn ghost sm bad" data-a="declined" data-id="${esc(r.id)}">Decline</button>`, '')).join('')
    + ok.map(r => row(r, `${wa(r)}<button class="btn ghost sm bad" data-a="declined" data-id="${esc(r.id)}">Remove access</button>`, 'Approved')).join('')
    + no.map(r => row(r, `<button class="btn ghost sm" data-a="approved" data-id="${esc(r.id)}">Approve</button>`, 'Declined')).join('');
}
$('#reqBox').addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]'); if(!b) return;
  b.disabled = true;
  try{ await updateDoc(doc(db, 'portfolioRequests', b.dataset.id), { status: b.dataset.a, answeredAt: serverTimestamp() }); }
  catch(err){ b.disabled = false; alert('Could not save (' + (err.code || err.message) + ')'); }
});

/* ---------- upload ---------- */
$('#pick').addEventListener('click', () => {
  const kind = document.querySelector('input[name=kind]:checked').value;
  const f = $('#file'); f.accept = kind === 'photo' ? 'image/*' : 'video/*'; f.click();
});
$('#file').addEventListener('change', () => { const fs = [...$('#file').files]; $('#file').value = ''; if(fs.length) uploadAll(fs); });

function loadImg(file){
  return new Promise((ok, no) => { const u = URL.createObjectURL(file), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => { URL.revokeObjectURL(u); no(new Error('not an image')); }; i.src = u; });
}
function toJpeg(src, w, h, max, q){
  const k = Math.min(1, max / Math.max(w, h)), cw = Math.round(w * k), ch = Math.round(h * k);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  c.getContext('2d').drawImage(src, 0, 0, cw, ch);
  return new Promise(ok => c.toBlob(b => ok({ blob: b, w: cw, h: ch }), 'image/jpeg', q));
}
function videoPoster(file){
  return new Promise(ok => {
    const v = document.createElement('video'), u = URL.createObjectURL(file);
    const done = r => { URL.revokeObjectURL(u); ok(r); };
    const t = setTimeout(() => done(null), 8000);
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = u;
    v.onloadeddata = () => { try{ v.currentTime = Math.min(1, (v.duration || 2) / 2); }catch(e){ clearTimeout(t); done(null); } };
    v.onseeked = async () => { clearTimeout(t); try{ const r = await toJpeg(v, v.videoWidth, v.videoHeight, 720, .8); done({ ...r, vw: v.videoWidth, vh: v.videoHeight, dur: v.duration }); }catch(e){ done(null); } };
    v.onerror = () => { clearTimeout(t); done(null); };
  });
}
function put(path, blob, type, onProg){
  return new Promise((ok, no) => {
    const task = uploadBytesResumable(sref(storage, path), blob, { contentType: type, cacheControl: 'public,max-age=31536000' });
    task.on('state_changed', s => onProg && onProg(s.bytesTransferred / s.totalBytes), no, async () => ok({ url: await getDownloadURL(task.snapshot.ref), path }));
  });
}
async function uploadAll(files){
  const kind = document.querySelector('input[name=kind]:checked').value;
  const title = $('#title').value.trim().slice(0, 80);
  $('#upErr').hidden = true;
  let n = 0;
  for(const file of files){
    const row = document.createElement('div'); row.className = 'upi';
    row.innerHTML = `<span>${esc(file.name)}</span><div class="bar"><i></i></div><small>Preparing…</small>`;
    $('#queue').appendChild(row);
    const bar = row.querySelector('i'), note = row.querySelector('small');
    try{
      const isImg = kind === 'photo';
      if(isImg !== file.type.startsWith('image/') || (!isImg && !file.type.startsWith('video/'))) throw new Error(isImg ? 'not a photo' : 'not a video');
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      let main, thumb = null, w = 0, h = 0;
      if(isImg){
        const img = await loadImg(file);
        const big = await toJpeg(img, img.naturalWidth, img.naturalHeight, 2000, .85);
        const sm = await toJpeg(img, img.naturalWidth, img.naturalHeight, 640, .8);
        main = { blob: big.blob, type: 'image/jpeg', ext: 'jpg' }; thumb = sm.blob; w = big.w; h = big.h;
      }else{
        const p = await videoPoster(file);
        if(p){ thumb = p.blob; w = p.vw; h = p.vh; }
        /* a heavy file stalls on a phone: ~8 Mbps (1080p, H.264) plays smoothly on mobile data */
        const mbps = p && p.dur > 1 ? file.size * 8 / p.dur / 1e6 : 0;
        if(mbps > 10 && !confirm(`This video is very heavy (about ${mbps.toFixed(0)} Mbps, ${(file.size / 1048576).toFixed(0)} MB for ${Math.round(p.dur)} s). On a phone it will pause to load.\n\nFor smooth playback export it as 1080p H.264 at about 6-8 Mbps (a 1-minute film is then ~50 MB).\n\nUpload it anyway?`)){ row.remove(); continue; }
        main = { blob: file, type: file.type, ext: (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4' };
      }
      note.textContent = 'Uploading…';
      const m = await put(`portfolio/${id}.${main.ext}`, main.blob, main.type, p => { bar.style.width = Math.round(p * 95) + '%'; note.textContent = 'Uploading… ' + Math.round(p * 100) + '%'; });
      let t = null;
      if(thumb) t = await put(`portfolio/${id}_t.jpg`, thumb, 'image/jpeg');
      await setDoc(doc(db, 'portfolio', id), {
        kind, title, url: m.url, path: m.path, thumb: t ? t.url : '', thumbPath: t ? t.path : '',
        w, h, order: -Date.now() - n++, createdAt: serverTimestamp(),
      });
      bar.style.width = '100%'; note.textContent = 'Done ✓';
      setTimeout(() => row.remove(), 2500);
    }catch(err){
      note.textContent = 'Failed — ' + (err.code === 'storage/unauthorized' ? 'Storage rules not published yet' : err.message || err.code);
      note.style.color = 'var(--err)';
    }
  }
}

/* ---------- library ---------- */
const KIND = { photo: '📷 Photo', video: '🎬 Film', reel: '📱 Reel' };
function renderLib(){
  $('#itCount').textContent = ITEMS.length + ' item' + (ITEMS.length === 1 ? '' : 's');
  if(!ITEMS.length){ $('#lib').innerHTML = '<p class="sub">Nothing uploaded yet.</p>'; return; }
  $('#lib').innerHTML = ITEMS.map((it, i) => `<div class="it">
    <div class="th" style="${it.thumb || it.kind === 'photo' ? `background-image:url('${esc(it.thumb || it.url)}')` : ''}"><span>${KIND[it.kind] || it.kind}</span></div>
    <div class="nm">${esc(it.title || '—')}</div>
    <div class="ac"><button data-m="up" data-id="${esc(it.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button data-m="dn" data-id="${esc(it.id)}" ${i === ITEMS.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="x" data-m="del" data-id="${esc(it.id)}" aria-label="Delete">🗑</button></div></div>`).join('');
}
$('#lib').addEventListener('click', async e => {
  const b = e.target.closest('button[data-m]'); if(!b) return;
  const i = ITEMS.findIndex(x => x.id === b.dataset.id); if(i < 0) return;
  const it = ITEMS[i];
  try{
    if(b.dataset.m === 'del'){
      if(!confirm('Delete this ' + (KIND[it.kind] || 'item') + ' for everyone?')) return;
      await deleteDoc(doc(db, 'portfolio', it.id));
      for(const p of [it.path, it.thumbPath]) if(p) { try{ await deleteObject(sref(storage, p)); }catch(err){} }
      return;
    }
    const j = b.dataset.m === 'up' ? i - 1 : i + 1, o = ITEMS[j]; if(!o) return;
    const bt = writeBatch(db);
    bt.update(doc(db, 'portfolio', it.id), { order: o.order });
    bt.update(doc(db, 'portfolio', o.id), { order: it.order });
    await bt.commit();
  }catch(err){ alert('Could not do that (' + (err.code || err.message) + ')'); }
});
