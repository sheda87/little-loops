/* Little Loops: a crochet companion.
   Plain JavaScript, no frameworks and no build step. Everything is saved on the phone
   (in IndexedDB), so it works offline and nothing is sent anywhere.

   Sections of this file:
   1. Helpers            5. Counters
   2. Saving data        6. Learn (guides + abbreviations)
   3. Screen basics      7. Projects
   4. Pictures (icons)   8. Yarn, settings and backup, startup
*/
(() => {
  'use strict';

  /* ================================================================
     1. Helpers
     ================================================================ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const ymd = () => new Date().toISOString().slice(0, 10);
  const DAY = 24 * 60 * 60 * 1000;

  /* ================================================================
     2. Saving data
     Text and settings live in one "state" object. Photos are saved
     separately (one entry per photo) so saving stays fast.
     ================================================================ */
  const DB_NAME = 'little-loops';
  const STORE = 'kv';
  let dbPromise = null;
  let storageOK = true;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbRun(mode, fn) {
    dbPromise = dbPromise || openDB();
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const dbGet = (key) => dbRun('readonly', (s) => s.get(key));
  const dbSet = (key, value) => dbRun('readwrite', (s) => s.put(value, key));
  const dbDel = (key) => dbRun('readwrite', (s) => s.delete(key));

  const defaultState = () => ({
    version: 1,
    counters: [
      { id: uid(), name: 'Round', value: 0, goal: null },
      { id: uid(), name: 'Stitch', value: 0, goal: null },
    ],
    projects: [],
    yarn: [],
    lastBackup: null,
    snoozeBackupUntil: 0,
    firstDataAt: 0,
    hideInstallTip: false,
    keepAwake: false,
  });

  function normalize(s) {
    const d = defaultState();
    for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
    s.counters = Array.isArray(s.counters) ? s.counters : [];
    s.projects = Array.isArray(s.projects) ? s.projects : [];
    s.yarn = Array.isArray(s.yarn) ? s.yarn : [];
    s.projects.forEach((p) => {
      p.photos = Array.isArray(p.photos) ? p.photos : [];
      p.rounds = Array.isArray(p.rounds) ? p.rounds : [];
      p.status = p.status || 'idea';
    });
    return s;
  }

  let state = defaultState();
  let saveTimer = null;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  }
  async function flush() {
    clearTimeout(saveTimer);
    if (!storageOK) return;
    try {
      await dbSet('state', state);
    } catch (err) {
      console.error(err);
      toast("Couldn't save. Your phone may be out of space.");
    }
  }

  const photoCache = new Map();
  async function getPhoto(id) {
    if (photoCache.has(id)) return photoCache.get(id);
    try {
      const data = await dbGet('photo:' + id);
      if (data) photoCache.set(id, data);
      return data;
    } catch (err) {
      return null;
    }
  }
  async function putPhoto(id, dataUrl) {
    photoCache.set(id, dataUrl);
    if (storageOK) await dbSet('photo:' + id, dataUrl);
  }
  async function removePhoto(id) {
    photoCache.delete(id);
    try { if (storageOK) await dbDel('photo:' + id); } catch (err) { /* ignore */ }
  }
  function hydratePhotos(root) {
    $$('img[data-photo]', root).forEach(async (img) => {
      const url = await getPhoto(img.dataset.photo);
      if (url) img.src = url;
    });
  }

  /* Shrink a picked photo so it stays small on the phone. */
  async function fileToDataURL(file, maxSize = 1200, quality = 0.82) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('That picture could not be read.'));
        el.src = url;
      });
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', quality);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ================================================================
     3. Screen basics: tabs, sheets, toasts
     ================================================================ */
  let tab = 'count';
  let lastFocus = null;
  let sheetResolve = null;
  let sheetCtx = {};
  let toastTimer = null;

  function updateLock() {
    const locked = !$('#page').hidden || $('#sheet-root').classList.contains('open');
    document.body.classList.toggle('lock', locked);
  }

  function openSheet(html, label) {
    closeSheet(true);
    lastFocus = document.activeElement;
    const root = $('#sheet-root');
    root.innerHTML =
      '<div class="backdrop" data-act="close-sheet"></div>' +
      `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label || 'Options')}"><div class="grab"></div>${html}</div>`;
    root.classList.add('open');
    updateLock();
    hydratePhotos(root);
    const auto = $('[data-autofocus]', root);
    if (auto) auto.focus();
  }
  function closeSheet(silent) {
    const root = $('#sheet-root');
    root.classList.remove('open');
    root.innerHTML = '';
    if (sheetResolve) {
      const done = sheetResolve;
      sheetResolve = null;
      done(false);
    }
    updateLock();
    if (!silent && lastFocus && document.contains(lastFocus)) {
      try { lastFocus.focus(); } catch (err) { /* ignore */ }
    }
  }
  function confirmSheet(title, message, okLabel, danger = true) {
    return new Promise((resolve) => {
      openSheet(
        `<h2>${esc(title)}</h2><p>${esc(message)}</p>` +
        `<button class="btn block ${danger ? 'danger' : 'primary'}" data-act="sheet-ok">${esc(okLabel)}</button>` +
        '<button class="btn block" data-act="close-sheet">Cancel</button>',
        title
      );
      sheetResolve = resolve;
    });
  }

  function toast(message, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(message)}</span>` + (action ? `<button type="button" data-act="toast-action">${esc(action.label)}</button>` : '');
    el.classList.add('show');
    el._action = action ? action.fn : null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2800);
  }

  function setTab(next) {
    tab = next;
    render();
    window.scrollTo(0, 0);
  }

  const views = { count: renderCount, learn: renderLearn, projects: renderProjects, yarn: renderYarn };
  function render() {
    const view = $('#view');
    views[tab](view);
    hydratePhotos(view);
    $$('.tabs button').forEach((b) => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  /* ================================================================
     4. Pictures (small inline icons)
     ================================================================ */
  const BERRY =
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 58C16 48 8 36 8 26c0-8 6-13 12-13 5 0 9 2 12 6 3-4 7-6 12-6 6 0 12 5 12 13 0 10-8 22-24 32z" fill="#c23b4a"/>' +
    '<path d="M32 20c-5-1-9-5-10-11 5 0 9 3 10 7 1-4 5-7 10-7-1 6-5 10-10 11z" fill="#5b8266"/>' +
    '<g fill="#fbf6ea"><ellipse cx="22" cy="30" rx="1.6" ry="2.4"/><ellipse cx="32" cy="28" rx="1.6" ry="2.4"/><ellipse cx="42" cy="30" rx="1.6" ry="2.4"/><ellipse cx="27" cy="38" rx="1.6" ry="2.4"/><ellipse cx="37" cy="38" rx="1.6" ry="2.4"/><ellipse cx="32" cy="46" rx="1.6" ry="2.4"/></g></svg>';
  const BERRY_SMALL = BERRY.replace('<svg ', '<svg width="22" height="22" ');
  const PLUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';

  // Crochet chart symbols (US terms), drawn on a 48 x 48 grid.
  const SYM = {
    ch: '<ellipse cx="24" cy="24" rx="11" ry="6"/>',
    sl: '<circle cx="24" cy="24" r="4.5" fill="currentColor"/>',
    sc: '<path d="M24 11v26M11 24h26"/>',
    hdc: '<path d="M24 11v26M14 11h20"/>',
    dc: '<path d="M24 11v26M14 11h20M17 29l14-10"/>',
    inc: '<path d="M24 38L14 10M24 38l10-28M15 25l8-3M25 22l8 3"/>',
    dec: '<path d="M24 10l-10 28M24 10l10 28M15 23l8 3M25 26l8-3"/>',
    ring: '<circle cx="22" cy="22" r="10"/><circle cx="22" cy="22" r="4"/><path d="M30 30c4 4 7 7 13 6"/>',
    leaf: '<path d="M10 38C10 20 22 10 38 10c0 16-10 28-28 28zM10 38L26 22"/>',
  };
  const symSVG = (name) =>
    `<svg class="g-sym${SYM[name] && name !== 'leaf' ? '' : ' plain'}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SYM[name] || SYM.leaf}</svg>`;

  /* ================================================================
     5. Counters
     ================================================================ */
  function counterHTML(c) {
    const done = c.goal && c.value >= c.goal;
    return `<article class="card stitched counter${done ? ' done' : ''}" data-id="${c.id}">
      <div class="c-head">
        <input class="c-name" value="${esc(c.name)}" maxlength="30" aria-label="Counter name" data-field="counter-name">
        <button class="icon-btn" data-act="counter-more" aria-label="Options for ${esc(c.name)}">&#8943;</button>
      </div>
      <div class="c-body">
        <button class="c-minus" data-act="dec" aria-label="Subtract one from ${esc(c.name)}">&minus;</button>
        <div class="c-val" role="status" aria-live="polite"><span class="n">${c.value}</span>${c.goal ? `<span class="of">of ${c.goal}</span>` : ''}</div>
        <button class="c-plus" data-act="inc" aria-label="Add one to ${esc(c.name)}">+</button>
      </div>
      ${done ? `<p class="c-done">${BERRY_SMALL} Goal reached!</p>` : ''}
    </article>`;
  }

  function installTipHTML() {
    const isApple = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (!isApple || standalone || state.hideInstallTip) return '';
    return `<div class="tip pink"><p><strong>Add Little Loops to your home screen.</strong> Tap the Share button in Safari, then choose Add to Home Screen. It opens like a regular app.</p>
      <button class="btn small" data-act="hide-install-tip">Got it</button></div>`;
  }

  function renderCount(v) {
    const canWake = 'wakeLock' in navigator;
    v.innerHTML = `${installTipHTML()}
      <div class="row-head"><h2>Counters</h2></div>
      ${state.counters.length
        ? state.counters.map(counterHTML).join('')
        : `<div class="empty">${BERRY}<p>No counters yet. Add one to start counting rounds or stitches.</p></div>`}
      <button class="btn block" data-act="add-counter">Add a counter</button>
      ${canWake ? `<label class="toggle" style="margin-top:14px"><span>Keep screen on while counting</span><input type="checkbox" data-act="keep-awake" ${state.keepAwake ? 'checked' : ''}></label>` : ''}
      <p class="hint" style="margin-top:14px">For amigurumi, use one counter for rounds and one for the stitches in the current round. Tap the dots on a counter to set a goal.</p>`;
  }

  function findCounter(el) {
    const card = el.closest('.counter');
    return card ? state.counters.find((c) => c.id === card.dataset.id) : null;
  }
  function refreshCounter(card, c) {
    const wasDone = card.classList.contains('done');
    const isDone = !!(c.goal && c.value >= c.goal);
    if (wasDone !== isDone) {
      card.outerHTML = counterHTML(c);
    } else {
      $('.n', card).textContent = c.value;
    }
  }
  function bump(el, delta) {
    const c = findCounter(el);
    if (!c) return;
    const next = Math.max(0, c.value + delta);
    if (next === c.value) return;
    c.value = next;
    if (navigator.vibrate) navigator.vibrate(8);
    refreshCounter(el.closest('.counter'), c);
    save();
  }

  /* ================================================================
     6. Learn: how-to guides and abbreviations
     ================================================================ */
  const CATS = ['All', 'Basics', 'Stitches', 'Amigurumi', 'Finishing'];
  const GUIDES = [
    {
      id: 'hold', title: 'Holding the hook and yarn', cat: 'Basics', sym: 'leaf',
      steps: [
        'Hold the hook like a pencil or like a knife. Both are fine, so use whichever feels comfortable.',
        'With your other hand, weave the yarn around your pinky, under your middle fingers and over your index finger.',
        'Pinch the work between your thumb and middle finger. Your index finger controls how tight the yarn is.',
      ],
      tip: 'Amigurumi stitches should be snug. If you can see gaps, try holding the yarn a little tighter.',
    },
    {
      id: 'slipknot', title: 'Slip knot', cat: 'Basics', sym: 'leaf',
      steps: [
        'Leave a tail about 6 inches long and make a loop in the yarn.',
        'Reach through the loop and pull up a new loop from the working yarn (the strand that goes to the ball).',
        'Put that new loop on your hook and pull the tail gently to tighten it.',
      ],
      tip: 'The slip knot is the first loop on your hook. It does not count as a stitch.',
    },
    {
      id: 'chain', title: 'Chain (ch)', cat: 'Basics', sym: 'ch',
      steps: [
        'Yarn over: wrap the yarn over the hook from back to front.',
        'Pull the yarn through the loop on your hook. That makes one chain.',
        'Repeat for as many chains as your pattern asks for.',
      ],
      tip: 'Never count the loop that is on the hook. Keep chains loose enough to slide the hook into later.',
    },
    {
      id: 'slst', title: 'Slip stitch (sl st)', cat: 'Stitches', sym: 'sl',
      steps: [
        'Put the hook into the stitch.',
        'Yarn over and pull through both the stitch and the loop on your hook.',
      ],
      tip: 'It is a very short, flat stitch. It is used for joining, finishing and moving across stitches.',
    },
    {
      id: 'sc', title: 'Single crochet (sc)', cat: 'Stitches', sym: 'sc',
      steps: [
        'Put the hook into the next stitch, under both loops of the V.',
        'Yarn over and pull up a loop. You now have 2 loops on the hook.',
        'Yarn over and pull through both loops.',
      ],
      tip: 'Single crochet makes a dense, sturdy fabric, which is why it is the main stitch in amigurumi.',
    },
    {
      id: 'hdc', title: 'Half double crochet (hdc)', cat: 'Stitches', sym: 'hdc',
      steps: [
        'Yarn over, then put the hook into the next stitch.',
        'Yarn over and pull up a loop. You now have 3 loops on the hook.',
        'Yarn over and pull through all 3 loops.',
      ],
      tip: 'It is a little taller than a single crochet and works up faster.',
    },
    {
      id: 'dc', title: 'Double crochet (dc)', cat: 'Stitches', sym: 'dc',
      steps: [
        'Yarn over, then put the hook into the next stitch.',
        'Yarn over and pull up a loop. You now have 3 loops on the hook.',
        'Yarn over and pull through 2 loops. You now have 2 loops.',
        'Yarn over and pull through the last 2 loops.',
      ],
      tip: 'Double crochet makes tall, stretchy fabric. It is common in blankets and garments.',
    },
    {
      id: 'loops', title: 'Front loop and back loop only (FLO, BLO)', cat: 'Stitches', sym: 'leaf',
      steps: [
        'The top of every stitch looks like a sideways V. The loop closest to you is the front loop. The loop behind it is the back loop.',
        'Unless a pattern says otherwise, put your hook under both loops.',
        'When it says FLO or BLO, put your hook under only that one loop.',
      ],
      tip: 'Working in one loop leaves a visible ridge. In amigurumi it is often used to make an edge for a hat, arms or feet.',
    },
    {
      id: 'ring', title: 'Magic ring (MR)', cat: 'Amigurumi', sym: 'ring',
      steps: [
        'Wrap the yarn around two fingers to make a loop, with the tail hanging down.',
        'Put your hook under the first strand of the loop, catch the working yarn, and pull a loop through.',
        'Chain 1 to lock it. This chain does not count as a stitch.',
        'Work your first round of stitches (usually 6 sc) into the ring, covering both the ring and the tail.',
        'Pull the tail to close the ring tight.',
      ],
      tip: 'If the ring will not close, pull the other strand. Only one of them slides the ring shut. Prefer something simpler? Chain 2, then work 6 sc into the second chain from the hook.',
    },
    {
      id: 'spiral', title: 'Working in a spiral', cat: 'Amigurumi', sym: 'leaf',
      steps: [
        'Most amigurumi is worked in continuous rounds. You do not join with a slip stitch or turn the work.',
        'Because there is no seam to show where a round ends, put a stitch marker in the last stitch of each round.',
        'When you reach the marker, work that stitch, then move the marker up to the stitch you just made.',
        'Count your stitches at the end of every round.',
      ],
      tip: 'No stitch marker? A short piece of scrap yarn in a contrasting color works just as well.',
    },
    {
      id: 'inc', title: 'Increase (inc)', cat: 'Amigurumi', sym: 'inc',
      steps: [
        'Work 2 single crochets in the same stitch.',
        'That is one increase. Your round now has one more stitch than before.',
      ],
      tip: 'A pattern like (sc, inc) x 6 means do everything inside the brackets, then repeat it 6 times in total.',
    },
    {
      id: 'dec', title: 'Decrease (dec)', cat: 'Amigurumi', sym: 'dec',
      steps: [
        'Invisible decrease: put your hook through the front loop only of the next stitch, then through the front loop only of the stitch after it.',
        'Yarn over and pull through both front loops. You now have 2 loops on the hook.',
        'Yarn over and pull through both loops. Two stitches have become one.',
      ],
      tip: 'The invisible decrease leaves no little holes, so it is a favorite for stuffed toys. The standard decrease (sc2tog) works too: pull up a loop in each of the next 2 stitches, then yarn over and pull through all 3 loops.',
    },
    {
      id: 'hook', title: 'Choosing a hook size', cat: 'Amigurumi', sym: 'leaf',
      steps: [
        'Look at the hook size on the yarn label.',
        'For amigurumi, go down one or two hook sizes from that suggestion.',
        'Work a few rounds and check: you should not see stuffing through the stitches.',
      ],
      tip: 'A smaller hook makes tighter fabric. Tight fabric keeps stuffing from showing through.',
    },
    {
      id: 'color', title: 'Changing colors', cat: 'Amigurumi', sym: 'leaf',
      steps: [
        'Work the last stitch of the old color until 2 loops remain on the hook.',
        'Pull the new color through those 2 loops to finish the stitch.',
        'Continue with the new color. Leave tails about 4 inches long on both colors.',
        'Weave the tails in when the piece is done.',
      ],
      tip: 'Because amigurumi is worked in a spiral, stripes can step up slightly at the color change. That is normal.',
    },
    {
      id: 'stuffing', title: 'Stuffing', cat: 'Amigurumi', sym: 'leaf',
      steps: [
        'Stuff before the opening gets too small to fit your fingers through.',
        'Use small pieces of fiberfill and add them a little at a time.',
        'Push stuffing into the corners with the end of your hook or a chopstick.',
        'Stuff more firmly than you think you need to. Crochet stretches, and soft spots show.',
      ],
      tip: 'Firm stuffing also hides the gaps between stitches.',
    },
    {
      id: 'eyes', title: 'Safety eyes', cat: 'Finishing', sym: 'leaf',
      steps: [
        'Place the eyes before you stuff and close the piece, so you can reach the back.',
        'Push the post through the fabric between stitches, in the round your pattern says.',
        'Press the washer onto the post from the inside until it clicks.',
      ],
      tip: 'For a baby or a very young child, embroider the eyes with yarn or thread instead. Plastic eyes can come loose.',
    },
    {
      id: 'close', title: 'Closing the last round', cat: 'Finishing', sym: 'leaf',
      steps: [
        'Decrease until about 6 stitches are left, stuffing as you go.',
        'Cut the yarn, leaving a tail about 6 inches long, and pull it through the loop on your hook.',
        'Thread the tail onto a yarn needle and pass it through the front loop of each remaining stitch.',
        'Pull the tail tight to close the hole, then knot it and hide the end inside.',
      ],
      tip: 'Do a final pinch test before closing. Add a little more stuffing if the piece feels soft.',
    },
    {
      id: 'fasten', title: 'Fastening off and weaving in ends', cat: 'Finishing', sym: 'leaf',
      steps: [
        'Cut the yarn, leaving a tail about 6 inches long.',
        'Pull the tail all the way through the last loop to lock it.',
        'Thread the tail onto a yarn needle and weave it back and forth through several stitches.',
        'Trim the end close to the fabric.',
      ],
      tip: 'Weave in a different direction at the end so the tail cannot slip out.',
    },
    {
      id: 'attach', title: 'Attaching arms, legs and ears', cat: 'Finishing', sym: 'leaf',
      steps: [
        'Pin the piece in place with straight pins. Check it from the front and the side before sewing.',
        'Thread the long tail of the piece onto a yarn needle.',
        'Sew through the front loops of the last round of the piece, then through a stitch on the body. Repeat all the way around.',
        'Fasten off inside the body.',
      ],
      tip: 'Pins let you step back and check that both sides match before you commit.',
    },
    {
      id: 'pattern', title: 'Reading an amigurumi pattern', cat: 'Basics', sym: 'leaf',
      steps: [
        'R1, R2 and so on mean Round 1, Round 2.',
        'A number in brackets at the end, like (18), is how many stitches you should have after that round.',
        'Brackets with a multiplier, like (sc, inc) x 6, mean repeat that group 6 times.',
        'Check which stitch names the pattern uses. US and UK names are different (see the Abbreviations tab).',
      ],
      tip: 'Count after every round. Most mistakes are easy to fix if you catch them early.',
    },
    {
      id: 'fix', title: 'Fixing mistakes', cat: 'Basics', sym: 'leaf',
      steps: [
        'Slide the hook out so the last loop is free.',
        'Gently pull the yarn to unravel back to where the mistake is. Crocheters call this frogging.',
        'Put the loop back on the hook, with the yarn not twisted.',
        'Carry on from there.',
      ],
      tip: 'Counting stitches at the end of each round tells you right away if something went wrong.',
    },
  ];

  const ABBR = [
    ['ch', 'chain'], ['sl st', 'slip stitch'], ['sc', 'single crochet'], ['hdc', 'half double crochet'],
    ['dc', 'double crochet'], ['tr', 'treble crochet'], ['st / sts', 'stitch / stitches'],
    ['inc', 'increase: 2 sc in the same stitch'], ['dec', 'decrease: 2 stitches worked together as 1'],
    ['sc2tog', 'single crochet 2 together (a decrease)'], ['inv dec', 'invisible decrease (front loops only)'],
    ['MR', 'magic ring'], ['R / rnd', 'round'], ['rep', 'repeat'], ['yo', 'yarn over'],
    ['FLO', 'front loop only'], ['BLO', 'back loop only'], ['sk', 'skip'], ['beg', 'beginning'],
    ['FO', 'fasten off'], ['[ ] or ( )', 'work everything inside, as many times as the pattern says'],
    ['*', 'repeat from the star as many times as the pattern says'],
  ];
  const USUK = [
    ['US single crochet (sc)', 'UK double crochet (dc)'],
    ['US half double (hdc)', 'UK half treble (htr)'],
    ['US double crochet (dc)', 'UK treble (tr)'],
    ['US treble (tr)', 'UK double treble (dtr)'],
    ['US slip stitch (sl st)', 'UK slip stitch (ss)'],
  ];

  let learnMode = 'guides';
  let learnCat = 'All';
  let learnQuery = '';

  function renderLearn(v) {
    v.innerHTML = `<div class="seg" role="group" aria-label="Learn sections">
        <button data-act="learn-mode" data-mode="guides" aria-pressed="${learnMode === 'guides'}">How-to guides</button>
        <button data-act="learn-mode" data-mode="abbr" aria-pressed="${learnMode === 'abbr'}">Abbreviations</button>
      </div><div id="learn-body"></div>`;
    renderLearnBody();
  }
  function renderLearnBody() {
    const body = $('#learn-body');
    if (!body) return;
    if (learnMode === 'abbr') {
      body.innerHTML = `<table class="abbr"><caption class="hint" style="text-align:left;padding:0 4px 8px">Common abbreviations in patterns</caption>
        <thead><tr><th scope="col">Short</th><th scope="col">Means</th></tr></thead>
        <tbody>${ABBR.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</tbody></table>
        <h3 style="margin:18px 4px 8px">US and UK names</h3>
        <p class="hint" style="margin:0 4px 10px">The same stitch has different names in US and UK patterns. Check which one your pattern uses before you start.</p>
        <table class="abbr"><thead><tr><th scope="col">US name</th><th scope="col">UK name</th></tr></thead>
        <tbody>${USUK.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</tbody></table>`;
      return;
    }
    body.innerHTML = `<input class="search" type="search" id="guide-q" placeholder="Search, like magic ring" value="${esc(learnQuery)}" aria-label="Search guides">
      <div class="chips" role="group" aria-label="Guide categories">${CATS.map((c) => `<button class="chip" data-act="learn-cat" data-cat="${c}" aria-pressed="${learnCat === c}">${c}</button>`).join('')}</div>
      <div id="guide-list"></div>`;
    renderGuideList();
  }
  function renderGuideList() {
    const list = $('#guide-list');
    if (!list) return;
    const q = learnQuery.trim().toLowerCase();
    const items = GUIDES.filter((g) => {
      if (learnCat !== 'All' && g.cat !== learnCat) return false;
      if (!q) return true;
      return (g.title + ' ' + g.steps.join(' ') + ' ' + g.tip).toLowerCase().includes(q);
    });
    list.innerHTML = items.length
      ? items.map((g) => `<details class="guide" id="g-${g.id}"><summary>${symSVG(g.sym)}<span><span class="g-title">${esc(g.title)}</span><span class="g-cat">${esc(g.cat)}</span></span></summary>
          <div class="g-body"><ol>${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><p class="g-tip"><strong>Tip:</strong> ${esc(g.tip)}</p></div></details>`).join('')
      : '<div class="empty"><p>No guides match that search. Try a shorter word, like "ring" or "stitch".</p></div>';
  }

  /* ================================================================
     7. Projects
     ================================================================ */
  const STATUSES = [['idea', 'Idea'], ['making', 'In progress'], ['finished', 'Finished'], ['gifted', 'Gifted']];
  const statusLabel = (s) => (STATUSES.find((x) => x[0] === s) || STATUSES[0])[1];
  let projFilter = 'all';
  let curProj = null;

  function backupBannerHTML() {
    const hasData = state.projects.length || state.yarn.length;
    // Don't nag right away: wait a few days after she first saves something.
    if (!hasData || !state.firstDataAt || Date.now() - state.firstDataAt < 3 * DAY) return '';
    if (Date.now() < state.snoozeBackupUntil) return '';
    if (state.lastBackup && Date.now() - state.lastBackup < 30 * DAY) return '';
    return `<div class="tip"><p><strong>Save a backup.</strong> Your projects and photos live only on this phone. A backup file keeps them safe if the phone is lost or reset.</p>
      <div class="tip-actions"><button class="btn small primary" data-act="backup">Save backup</button><button class="btn small" data-act="snooze-backup">Later</button></div></div>`;
  }

  function renderProjects(v) {
    const list = state.projects.filter((p) => projFilter === 'all' || p.status === projFilter);
    v.innerHTML = `${backupBannerHTML()}
      <div class="row-head"><h2>My projects</h2><button class="btn primary small" data-act="new-project">New project</button></div>
      <div class="chips" role="group" aria-label="Filter by status">
        <button class="chip" data-act="proj-filter" data-f="all" aria-pressed="${projFilter === 'all'}">All</button>
        ${STATUSES.map((s) => `<button class="chip" data-act="proj-filter" data-f="${s[0]}" aria-pressed="${projFilter === s[0]}">${s[1]}</button>`).join('')}
      </div>
      ${list.length
        ? `<div class="grid">${list.map(projectCardHTML).join('')}</div>`
        : `<div class="empty">${BERRY}<p>${state.projects.length ? 'Nothing here with that status yet.' : 'No projects yet. Add your first make to start your library.'}</p>${state.projects.length ? '' : '<button class="btn primary" data-act="new-project">Add a project</button>'}</div>`}`;
  }
  function projectCardHTML(p) {
    const cover = p.photos[0]
      ? `<img data-photo="${p.photos[0]}" alt="${esc(p.name || 'Project')} cover photo">`
      : BERRY;
    return `<button class="pcard" data-act="open-project" data-id="${p.id}">
      <div class="cover">${cover}</div>
      <span class="pname">${esc(p.name || 'Untitled project')}</span>
      <span class="status ${p.status}">${statusLabel(p.status)}</span></button>`;
  }

  function newProject() {
    const p = { id: uid(), name: '', status: 'idea', yarn: '', hook: '', size: '', source: '', notes: '', photos: [], rounds: [], created: Date.now() };
    state.projects.unshift(p);
    if (!state.firstDataAt) state.firstDataAt = Date.now();
    save();
    openProject(p.id);
  }

  function photosHTML(p) {
    return p.photos.map((id, i) => `<button class="ph${i === 0 ? ' cover-ph' : ''}" data-act="view-photo" data-pid="${id}" aria-label="Open photo ${i + 1}"><img data-photo="${id}" alt="Photo ${i + 1} of ${esc(p.name || 'project')}"></button>`).join('') +
      `<button class="addph" data-act="add-photo">${PLUS_ICON}<span>Add photos</span></button>`;
  }
  function roundsHTML(p) {
    const done = p.rounds.filter((r) => r.done).length;
    const pct = p.rounds.length ? Math.round((done / p.rounds.length) * 100) : 0;
    return `<p class="hint">${p.rounds.length ? `${done} of ${p.rounds.length} done` : 'No rounds yet. Add them one at a time, or paste a whole pattern.'}</p>
      <div class="progress" role="progressbar" aria-label="Rounds finished" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <ul class="rounds">${p.rounds.map((r) => `<li class="${r.done ? 'done' : ''}" data-rid="${r.id}"><label><input type="checkbox" data-round="${r.id}" ${r.done ? 'checked' : ''}><span class="txt">${esc(r.text)}</span></label><button class="icon-btn" data-act="del-round" data-rid="${r.id}" aria-label="Remove ${esc(r.text)}">&times;</button></li>`).join('')}</ul>`;
  }

  function openProject(id) {
    const p = state.projects.find((x) => x.id === id);
    if (!p) return;
    curProj = id;
    const page = $('#page');
    page.innerHTML = `<div class="page-top">
        <button class="btn" data-act="close-page">Back</button>
        <button class="btn danger" data-act="delete-project">Delete</button>
      </div>
      <div class="page-inner">
        <input class="title-input" data-pf="name" value="${esc(p.name)}" placeholder="Name this project" maxlength="60" aria-label="Project name">
        <label class="field"><span>Status</span><select data-pf="status">${STATUSES.map((s) => `<option value="${s[0]}" ${p.status === s[0] ? 'selected' : ''}>${s[1]}</option>`).join('')}</select></label>
        <h3>Photos</h3>
        <div class="photos" id="photos">${photosHTML(p)}</div>
        <input type="file" id="photo-input" accept="image/*" multiple hidden>
        <h3>Pattern notes</h3>
        <label class="field"><span>Yarn</span><input type="text" data-pf="yarn" value="${esc(p.yarn)}" placeholder="Brand, color and weight"></label>
        <div class="two">
          <label class="field"><span>Hook size</span><input type="text" data-pf="hook" value="${esc(p.hook)}" placeholder="Like 2.5 mm"></label>
          <label class="field"><span>Finished size</span><input type="text" data-pf="size" value="${esc(p.size)}" placeholder="Like 6 inches tall"></label>
        </div>
        <label class="field"><span>Pattern source</span><input type="text" data-pf="source" value="${esc(p.source)}" placeholder="Designer name or link"></label>
        <label class="field"><span>Notes</span><textarea data-pf="notes" placeholder="Changes you made, things to remember">${esc(p.notes)}</textarea></label>
        <h3>Round checklist</h3>
        <div id="rounds">${roundsHTML(p)}</div>
        <form class="roundadd" data-form="add-round"><input type="text" name="text" placeholder="Like R5: (sc, inc) x 6 (18)" aria-label="New round" autocomplete="off"><button class="btn primary" type="submit">Add</button></form>
        <div class="btn-row"><button class="btn small" data-act="paste-rounds">Paste many rounds</button><button class="btn small" data-act="uncheck-rounds">Uncheck all</button></div>
      </div>`;
    page.hidden = false;
    page.scrollTop = 0;
    updateLock();
    hydratePhotos(page);
    const nameInput = $('.title-input', page);
    if (!p.name) nameInput.focus();
  }
  function closePage() {
    const page = $('#page');
    page.hidden = true;
    page.innerHTML = '';
    curProj = null;
    updateLock();
    flush();
    render();
  }
  const curProject = () => state.projects.find((p) => p.id === curProj);

  function refreshPhotos() {
    const p = curProject();
    const box = $('#photos');
    if (!p || !box) return;
    box.innerHTML = photosHTML(p);
    hydratePhotos(box);
  }
  function refreshRounds() {
    const p = curProject();
    const box = $('#rounds');
    if (!p || !box) return;
    box.innerHTML = roundsHTML(p);
  }

  async function addPhotos(files) {
    const p = curProject();
    if (!p || !files.length) return;
    let added = 0;
    for (const file of files) {
      try {
        const data = await fileToDataURL(file);
        const id = uid();
        await putPhoto(id, data);
        p.photos.push(id);
        added++;
      } catch (err) {
        console.error(err);
        toast(err && err.message ? err.message : "Couldn't add that photo.");
      }
    }
    if (added) {
      save();
      refreshPhotos();
      toast(added === 1 ? 'Photo added' : `${added} photos added`);
    }
  }

  function viewPhoto(pid) {
    const p = curProject();
    if (!p) return;
    const isCover = p.photos[0] === pid;
    sheetCtx = { pid };
    openSheet(`<img class="viewer" data-photo="${pid}" alt="Project photo">
      ${isCover ? '' : '<button class="btn block" data-act="make-cover">Make this the cover photo</button>'}
      <button class="btn block danger" data-act="delete-photo">Delete photo</button>
      <button class="btn block" data-act="close-sheet">Close</button>`, 'Photo');
  }

  /* ================================================================
     8. Yarn, settings and backup, startup
     ================================================================ */
  const WEIGHTS = ['Lace', 'Fingering', 'Sport', 'DK', 'Worsted', 'Bulky', 'Super bulky', 'Other'];

  function renderYarn(v) {
    const skeins = state.yarn.reduce((n, y) => n + (Number(y.qty) || 0), 0);
    v.innerHTML = `${backupBannerHTML()}
      <div class="row-head"><h2>Yarn stash</h2><button class="btn primary small" data-act="add-yarn">Add yarn</button></div>
      ${state.yarn.length
        ? `<p class="summary">${skeins} ${skeins === 1 ? 'skein' : 'skeins'} across ${state.yarn.length} ${state.yarn.length === 1 ? 'color' : 'colors'}</p>${state.yarn.map(yarnHTML).join('')}`
        : `<div class="empty">${BERRY}<p>Your stash is empty. Add the yarn you have so you know what you can use.</p><button class="btn primary" data-act="add-yarn">Add yarn</button></div>`}`;
  }
  function yarnHTML(y) {
    const sub = [y.brand, y.weight, y.colorName].filter(Boolean).join(', ');
    return `<article class="card stitched yarn" data-id="${y.id}">
      <button class="ymain" data-act="edit-yarn" aria-label="Edit ${esc(y.name || 'yarn')}">
        <span class="swatch" style="background:${esc(y.color || '#a9c1a5')}"></span>
        <span style="min-width:0"><span class="yname">${esc(y.name || 'Untitled yarn')}</span><span class="ysub">${esc(sub || 'No details yet')}</span></span>
      </button>
      <div class="qty"><button data-act="y-dec" aria-label="One less skein of ${esc(y.name || 'yarn')}">&minus;</button><b aria-live="polite">${Number(y.qty) || 0}</b><button data-act="y-inc" aria-label="One more skein of ${esc(y.name || 'yarn')}">+</button></div>
    </article>`;
  }
  function yarnSheet(id) {
    const y = id ? state.yarn.find((x) => x.id === id) : { name: '', brand: '', weight: 'Worsted', colorName: '', color: '#c23b4a', qty: 1, notes: '' };
    if (!y) return;
    sheetCtx = { yarnId: id || null };
    openSheet(`<h2>${id ? 'Edit yarn' : 'Add yarn'}</h2>
      <form data-form="yarn">
        <label class="field"><span>Name</span><input type="text" name="name" value="${esc(y.name)}" placeholder="Like Cotton Sprout" maxlength="60" ${id ? '' : 'data-autofocus'} required></label>
        <div class="two">
          <label class="field"><span>Brand</span><input type="text" name="brand" value="${esc(y.brand)}" maxlength="40"></label>
          <label class="field"><span>Weight</span><select name="weight">${WEIGHTS.map((w) => `<option ${y.weight === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
        </div>
        <div class="two">
          <label class="field"><span>Color name</span><input type="text" name="colorName" value="${esc(y.colorName)}" maxlength="40"></label>
          <label class="field"><span>Color swatch</span><input type="color" name="color" value="${esc(y.color || '#c23b4a')}"></label>
        </div>
        <label class="field"><span>Skeins</span><input type="number" name="qty" value="${Number(y.qty) || 0}" min="0" max="999" inputmode="numeric"></label>
        <label class="field"><span>Notes</span><input type="text" name="notes" value="${esc(y.notes)}" placeholder="Where you bought it, dye lot"></label>
        <button class="btn primary block" type="submit">Save yarn</button>
        ${id ? '<button class="btn danger block" type="button" data-act="delete-yarn">Delete yarn</button>' : ''}
        <button class="btn block" type="button" data-act="close-sheet">Cancel</button>
      </form>`, id ? 'Edit yarn' : 'Add yarn');
  }

  /* ----- settings and backup ----- */
  function settingsSheet() {
    const last = state.lastBackup ? `Last backup: ${fmtDate(state.lastBackup)}.` : 'You have not saved a backup yet.';
    openSheet(`<h2>Settings and backup</h2>
      <p>Everything in Little Loops is stored on this phone only. A backup file lets you move to a new phone or recover after a reset.</p>
      <p><strong>${esc(last)}</strong></p>
      <button class="btn primary block" data-act="backup">Save a backup</button>
      <button class="btn block" data-act="restore">Restore from a backup</button>
      <p style="margin-top:14px">When you save a backup, choose Save to Files or send it to yourself in email so it is stored outside this phone.</p>
      <button class="btn block" data-act="close-sheet">Done</button>`, 'Settings and backup');
  }

  async function buildBackup() {
    const photos = {};
    for (const p of state.projects) {
      for (const id of p.photos) {
        const data = await getPhoto(id);
        if (data) photos[id] = data;
      }
    }
    return { app: 'little-loops', version: 1, exported: new Date().toISOString(), state, photos };
  }
  function markBackup() {
    state.lastBackup = Date.now();
    save();
    toast('Backup saved');
    if (tab === 'projects' || tab === 'yarn') render();
  }
  async function saveBackup() {
    let json;
    try {
      json = JSON.stringify(await buildBackup());
    } catch (err) {
      console.error(err);
      toast("Couldn't make the backup file.");
      return;
    }
    const name = `little-loops-backup-${ymd()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Little Loops backup' });
        closeSheet(true);
        markBackup();
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // she closed the share sheet
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    closeSheet(true);
    markBackup();
  }

  async function restoreFromFile(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      toast("That file isn't a Little Loops backup.");
      return;
    }
    if (!data || data.app !== 'little-loops' || !data.state) {
      toast("That file isn't a Little Loops backup.");
      return;
    }
    const ok = await confirmSheet(
      'Replace everything?',
      `This backup has ${(data.state.projects || []).length} projects and ${(data.state.yarn || []).length} yarns. Restoring replaces what is in the app right now.`,
      'Restore backup'
    );
    if (!ok) return;
    try {
      for (const p of state.projects) for (const id of p.photos) await removePhoto(id);
      state = normalize(data.state);
      for (const [id, url] of Object.entries(data.photos || {})) await putPhoto(id, url);
      await flush();
      closeSheet(true);
      toast('Backup restored');
      render();
    } catch (err) {
      console.error(err);
      toast("Couldn't restore that backup.");
    }
  }

  /* ----- keep the screen awake (optional) ----- */
  let wakeLock = null;
  async function applyWake() {
    try {
      if (state.keepAwake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        if (!wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
      } else if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (err) { /* not supported or refused, that's fine */ }
  }

  /* ----- clicks ----- */
  const actions = {
    // counters
    inc: (el) => bump(el, 1),
    dec: (el) => bump(el, -1),
    'add-counter': () => {
      state.counters.push({ id: uid(), name: 'Counter ' + (state.counters.length + 1), value: 0, goal: null });
      save();
      render();
      const inputs = $$('.c-name');
      const last = inputs[inputs.length - 1];
      if (last) { last.scrollIntoView({ block: 'center' }); last.select(); last.focus(); }
    },
    'counter-more': (el) => {
      const c = findCounter(el);
      if (!c) return;
      sheetCtx = { counterId: c.id };
      openSheet(`<h2>${esc(c.name)}</h2>
        <form data-form="goal"><label class="field"><span>Goal (optional)</span><input type="number" name="goal" min="1" max="9999" inputmode="numeric" value="${c.goal || ''}" placeholder="Like 18 stitches"></label>
        <button class="btn primary block" type="submit">Save goal</button></form>
        <button class="btn block" data-act="reset-counter">Reset to 0</button>
        <button class="btn block danger" data-act="delete-counter">Delete counter</button>
        <button class="btn block" data-act="close-sheet">Close</button>`, 'Counter options');
    },
    'reset-counter': () => {
      const c = state.counters.find((x) => x.id === sheetCtx.counterId);
      if (!c) return;
      const prev = c.value;
      c.value = 0;
      save();
      closeSheet();
      render();
      toast(`${c.name} reset`, { label: 'Undo', fn: () => { c.value = prev; save(); render(); } });
    },
    'delete-counter': async () => {
      const c = state.counters.find((x) => x.id === sheetCtx.counterId);
      if (!c) return;
      const ok = await confirmSheet(`Delete ${c.name}?`, 'This counter and its number will be removed.', 'Delete counter');
      if (!ok) return;
      state.counters = state.counters.filter((x) => x.id !== c.id);
      save();
      render();
    },
    'keep-awake': (el) => { state.keepAwake = el.checked; save(); applyWake(); },
    'hide-install-tip': () => { state.hideInstallTip = true; save(); render(); },

    // learn
    'learn-mode': (el) => { learnMode = el.dataset.mode; renderLearn($('#view')); },
    'learn-cat': (el) => { learnCat = el.dataset.cat; renderLearnBody(); },

    // projects
    'proj-filter': (el) => { projFilter = el.dataset.f; render(); },
    'new-project': newProject,
    'open-project': (el) => openProject(el.dataset.id),
    'close-page': closePage,
    'delete-project': async () => {
      const p = curProject();
      if (!p) return;
      const ok = await confirmSheet(`Delete ${p.name || 'this project'}?`, 'Its photos, notes and checklist will be removed for good.', 'Delete project');
      if (!ok) return;
      for (const id of p.photos) await removePhoto(id);
      state.projects = state.projects.filter((x) => x.id !== p.id);
      save();
      closePage();
      toast('Project deleted');
    },
    'add-photo': () => $('#photo-input').click(),
    'view-photo': (el) => viewPhoto(el.dataset.pid),
    'make-cover': () => {
      const p = curProject();
      if (!p) return;
      p.photos = [sheetCtx.pid, ...p.photos.filter((id) => id !== sheetCtx.pid)];
      save();
      closeSheet();
      refreshPhotos();
    },
    'delete-photo': async () => {
      const p = curProject();
      const pid = sheetCtx.pid;
      if (!p || !pid) return;
      const ok = await confirmSheet('Delete this photo?', 'It will be removed from this project.', 'Delete photo');
      if (!ok) return;
      p.photos = p.photos.filter((id) => id !== pid);
      await removePhoto(pid);
      save();
      refreshPhotos();
    },
    'del-round': (el) => {
      const p = curProject();
      if (!p) return;
      p.rounds = p.rounds.filter((r) => r.id !== el.dataset.rid);
      save();
      refreshRounds();
    },
    'uncheck-rounds': () => {
      const p = curProject();
      if (!p) return;
      p.rounds.forEach((r) => { r.done = false; });
      save();
      refreshRounds();
    },
    'paste-rounds': () => {
      openSheet(`<h2>Paste rounds</h2><p>Put one round on each line. Each line becomes a checklist item.</p>
        <form data-form="paste-rounds"><textarea name="text" placeholder="R1: MR, 6 sc (6)&#10;R2: inc x 6 (12)&#10;R3: (sc, inc) x 6 (18)" data-autofocus></textarea>
        <button class="btn primary block" type="submit">Add to checklist</button></form>
        <button class="btn block" data-act="close-sheet">Cancel</button>`, 'Paste rounds');
    },

    // yarn
    'add-yarn': () => yarnSheet(null),
    'edit-yarn': (el) => yarnSheet(el.closest('.yarn').dataset.id),
    'y-inc': (el) => {
      const y = state.yarn.find((x) => x.id === el.closest('.yarn').dataset.id);
      if (!y) return;
      y.qty = (Number(y.qty) || 0) + 1;
      save();
      render();
    },
    'y-dec': (el) => {
      const y = state.yarn.find((x) => x.id === el.closest('.yarn').dataset.id);
      if (!y) return;
      y.qty = Math.max(0, (Number(y.qty) || 0) - 1);
      save();
      render();
    },
    'delete-yarn': async () => {
      const y = state.yarn.find((x) => x.id === sheetCtx.yarnId);
      if (!y) return;
      const ok = await confirmSheet(`Delete ${y.name || 'this yarn'}?`, 'It will be removed from your stash.', 'Delete yarn');
      if (!ok) return;
      state.yarn = state.yarn.filter((x) => x.id !== y.id);
      save();
      render();
    },

    // settings and backup
    settings: settingsSheet,
    backup: saveBackup,
    restore: () => $('#restore-input').click(),
    'snooze-backup': () => { state.snoozeBackupUntil = Date.now() + 7 * DAY; save(); render(); },

    // sheets and toast
    'close-sheet': () => closeSheet(),
    'sheet-ok': () => {
      if (sheetResolve) {
        const done = sheetResolve;
        sheetResolve = null;
        closeSheet(true);
        done(true);
      }
    },
    'toast-action': () => {
      const el = $('#toast');
      el.classList.remove('show');
      if (el._action) el._action();
    },
  };

  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.tabs button');
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, e);
  });

  /* ----- typing in fields ----- */
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.field === 'counter-name') {
      const c = findCounter(t);
      if (c) { c.name = t.value; save(); }
    } else if (t.dataset.pf) {
      const p = curProject();
      if (p) { p[t.dataset.pf] = t.value; save(); }
    } else if (t.dataset.round) {
      const p = curProject();
      const r = p && p.rounds.find((x) => x.id === t.dataset.round);
      if (r) { r.done = t.checked; save(); refreshRounds(); }
    } else if (t.id === 'guide-q') {
      learnQuery = t.value;
      renderGuideList();
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'photo-input') {
      addPhotos(Array.from(t.files));
      t.value = '';
    } else if (t.id === 'restore-input') {
      const file = t.files && t.files[0];
      t.value = '';
      if (file) restoreFromFile(file);
    } else if (t.dataset.pf === 'status') {
      const p = curProject();
      if (p) { p.status = t.value; save(); }
    }
  });

  /* ----- forms ----- */
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const data = new FormData(form);
    const kind = form.dataset.form;

    if (kind === 'goal') {
      const c = state.counters.find((x) => x.id === sheetCtx.counterId);
      if (!c) return;
      const n = parseInt(data.get('goal'), 10);
      c.goal = n > 0 ? n : null;
      save();
      closeSheet();
      render();
    } else if (kind === 'add-round') {
      const p = curProject();
      const text = String(data.get('text') || '').trim();
      if (!p || !text) return;
      p.rounds.push({ id: uid(), text, done: false });
      save();
      form.reset();
      refreshRounds();
      const input = $('input[name="text"]', form);
      if (input) input.focus();
    } else if (kind === 'paste-rounds') {
      const p = curProject();
      if (!p) return;
      const lines = String(data.get('text') || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      lines.forEach((text) => p.rounds.push({ id: uid(), text, done: false }));
      save();
      closeSheet();
      refreshRounds();
      if (lines.length) toast(lines.length === 1 ? '1 round added' : `${lines.length} rounds added`);
    } else if (kind === 'yarn') {
      const fields = {
        name: String(data.get('name') || '').trim(),
        brand: String(data.get('brand') || '').trim(),
        weight: String(data.get('weight') || ''),
        colorName: String(data.get('colorName') || '').trim(),
        color: String(data.get('color') || '#c23b4a'),
        qty: Math.max(0, parseInt(data.get('qty'), 10) || 0),
        notes: String(data.get('notes') || '').trim(),
      };
      if (sheetCtx.yarnId) {
        const y = state.yarn.find((x) => x.id === sheetCtx.yarnId);
        if (y) Object.assign(y, fields);
      } else {
        state.yarn.unshift({ id: uid(), ...fields });
        if (!state.firstDataAt) state.firstDataAt = Date.now();
      }
      save();
      closeSheet();
      render();
    }
  });

  /* ----- keyboard: Escape closes sheets, Enter leaves a counter name ----- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#sheet-root').classList.contains('open')) closeSheet();
      else if (!$('#page').hidden) closePage();
    } else if (e.key === 'Enter' && e.target.dataset && e.target.dataset.field === 'counter-name') {
      e.target.blur();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyWake();
    else flush();
  });
  window.addEventListener('pagehide', flush);

  /* ----- startup ----- */
  async function init() {
    try {
      const saved = await dbGet('state');
      if (saved && saved.version === 1) state = normalize(saved);
      else state = defaultState();
    } catch (err) {
      console.warn('Saving is not available here.', err);
      storageOK = false;
      state = defaultState();
      toast("Saving isn't available in this browser. Open Little Loops in Safari, not in a private tab.");
    }
    render();
    applyWake();

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline mode unavailable', err));
    }
  }
  init();
})();
