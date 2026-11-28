/* ביקור סניף · JEM'S · 2.0 · שלב 3: ספריית מנות ובדיקת מנות */
(function () {
  'use strict';
  var J = window.JEMS, A = window.JEMS_AUDIT, I = A._i;
  var sb = J.sb, S = J.state, esc = J.esc, toast = J.toast;
  var fmt1 = I.fmt1, r1 = I.r1, $ = function (id) { return document.getElementById(id); };

  // the 8 criteria of 1.6.1. Settings in the cloud win; this is only a fallback.
  var DEFAULT_CRIT = [
    { id: 'taste', label: 'טעם' }, { id: 'temp', label: 'טמפרטורת הגשה' },
    { id: 'ware', label: 'כלי הגשה: נקי, שלם, מתאים' }, { id: 'look', label: 'פלייטינג ונראות' },
    { id: 'size', label: 'גודל מנה ומשקל' }, { id: 'recipe', label: 'התאמה למתכון' },
    { id: 'rim', label: 'ניקיון שולי הצלחת' }, { id: 'time', label: 'זמן הגעה בתקן' }
  ];
  function tset() { return S.tasting || {}; }
  function crit() { return (tset().criteria && tset().criteria.length) ? tset().criteria : DEFAULT_CRIT; }
  function col5(row) { return (row && row.dept_snap && row.dept_snap.colors) || tset().colors || { green: 4, yellow: 3 }; }
  function critOf(row) { return (row && row.dept_snap && row.dept_snap.criteria) || crit(); }
  function tone5(s, c) { if (s == null) return 'none'; c = c || col5(); return s >= c.green ? 'green' : s >= c.yellow ? 'yellow' : 'red'; }
  function emo5(s, c) { return { green: '🟢', yellow: '🟡', red: '🔴', none: '⚪' }[tone5(s, c)]; }
  function main() { return $('main'); }
  function money(v) { return v == null || v === '' ? '' : '₪' + Number(v).toLocaleString('he-IL'); }

  // ---------- score ----------
  // dish = average of its ratings, tasting = average of the dishes. Separate from the branch score (overall stays null).
  function compute(row) {
    var cr = critOf(row), dishes = (row.data && row.data.dishes) || [];
    var out = {}, vals = [], answered = 0, crIds = cr.map(function (c) { return c.id; });
    dishes.forEach(function (x) {
      var r = x.r || {}, v = crIds.map(function (k) { return r[k]; }).filter(function (n) { return typeof n === 'number'; });
      var s = v.length ? r1(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null;
      out[x.id] = { score: s, answered: v.length, total: cr.length };
      answered += v.length; if (s != null) vals.push(s);
    });
    var total = dishes.length * cr.length;
    var coverage = total ? Math.round(answered / total * 1000) / 10 : 0;
    return {
      overall: null, score5: vals.length ? r1(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null,
      dishes: out, answered: answered, total: total, coverage: coverage, not_representative: total > 0 && coverage < I.minCov()
    };
  }
  function save(row) {
    var res = compute(row);
    row.coverage = res.coverage;
    row.result = { overall: null, score5: res.score5, dishes: res.dishes, answered: res.answered, total: res.total, coverage: res.coverage };
    I.store(I.cloudRow(row));
  }

  // ---------- library (cloud, with a phone copy for no-signal) ----------
  var LIB = null;
  function libKey() { return I.key('dishlib'); }
  function loadLib(force) {
    if (LIB && !force) return Promise.resolve(LIB);
    if (!navigator.onLine) { LIB = I.lsGet(libKey(), []); return Promise.resolve(LIB); }
    return sb.from('dishes').select('*').order('sort').order('name').then(function (r) {
      if (r.error) { LIB = LIB || I.lsGet(libKey(), []); return LIB; }
      LIB = r.data || []; I.lsSet(libKey(), LIB); return LIB;
    }, function () { LIB = I.lsGet(libKey(), []); return LIB; });
  }
  function inBranch(d, bid) { return !d.branch_ids || !d.branch_ids.length || d.branch_ids.indexOf(bid) >= 0; }
  function hasAdv(a) { a = a || {}; return !!((a.ingredients && a.ingredients.length) || a.temp_min != null || a.temp_max != null || a.size || a.presentation || a.ref_photo); }
  function sortDishes(list) {
    return list.slice().sort(function (a, b) {
      if (!!b.fixed !== !!a.fixed) return b.fixed ? 1 : -1;
      var c = String(a.category || '').localeCompare(String(b.category || ''), 'he'); if (c) return c;
      return (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name), 'he');
    });
  }

  // ---------- start ----------
  function summaryLine(b) {
    var n = LIB ? LIB.filter(function (d) { return !d.hidden && inBranch(d, b.id); }).length : null;
    return crit().length + ' קריטריונים לכל מנה · דירוג 1 עד 5' + (n != null ? ' · ' + n + ' מנות בספרייה' : '');
  }
  function start(bid, shift, mgr) {
    var row = {
      id: I.uuid(), branch_id: bid, created_by: I.uid(), type: 'tasting', status: 'draft',
      started_at: new Date().toISOString(), not_representative: false, partial_reason: null, finished_at: null,
      // snapshot of the criteria and colors at this moment. Later settings changes never touch it.
      dept_snap: { kind: 'tasting', version: tset().version || 1, criteria: I.clone(crit()), colors: I.clone(col5()) },
      data: { shift: shift, manager: mgr, auditor: J.displayName(), dishes: [], summary: '' }
    };
    save(row);
    J.closeSheet(); J.go('audit', row.id);
  }

  // ---------- the form ----------
  var TF = null; // { row, open: dish id }
  function form(m, row) {
    TF = { row: row, open: null };
    var ds = row.data.dishes || (row.data.dishes = []);
    var firstOpen = ds.find(function (x) { var c = compute(row).dishes[x.id]; return !c || c.answered < c.total; });
    TF.open = row.data.last_dish && ds.some(function (x) { return x.id === row.data.last_dish; }) ? row.data.last_dish : firstOpen ? firstOpen.id : null;
    document.body.classList.add('in-tasting');
    loadLib().then(function () { if (TF && TF.row === row) renderForm(); });
    renderForm();
  }
  function saveState() { return I.pendingCount() ? (navigator.onLine ? 'שולח…' : '📱 נשמר בטלפון') : '☁️ נשמר'; }
  function renderForm() {
    var m = main(); if (!m || !TF) return;
    var row = TF.row, b = I.branch(row.branch_id), res = compute(row), ds = row.data.dishes;
    var pct = res.total ? Math.round(res.answered / res.total * 100) : 0;
    m.innerHTML =
      '<div class="fhead"><button class="icon-btn" id="tBack" aria-label="חזרה לבית">→</button>' +
      '<div class="ft"><b>בדיקת מנות · ' + esc(b ? b.name : '') + '</b><small><span id="saveState">' + saveState() + '</span> · <span id="tCount">' + ds.length + ' מנות</span></small></div>' +
      '<button class="btn btn-sm" id="tFinish">סיום</button></div>' +
      '<div class="prog" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
      '<div class="tscore"><span>ציון מנות</span><b class="t-' + tone5(res.score5, col5(row)) + '" id="tScore">' + fmt1(res.score5) + '</b><small>מתוך 5</small></div>' +
      (ds.length ? '<div class="dishes">' + ds.map(function (x, i) { return dishHtml(x, i, res); }).join('') + '</div>' : quickStart(row)) +
      '<button class="btn btn-line addish" id="tAdd">＋ הוסף מנה</button>' +
      '<label class="field"><span>📝 סיכום בשורה אחת</span><input class="input" id="tSum" value="' + esc(row.data.summary || '') + '" placeholder="לא חובה"></label>' +
      '<button class="btn btn-primary" id="tEnd">💾 סיום הבדיקה</button>';
    $('tBack').onclick = function () { J.go('home'); };
    $('tFinish').onclick = $('tEnd').onclick = openFinish;
    $('tAdd').onclick = openPicker;
    $('tSum').onchange = function () { row.data.summary = this.value.trim(); save(row); };
    bindForm(m);
    I.loadThumbs(m);
    if (TF.scrollTo) { var el = $('dish-' + TF.scrollTo); TF.scrollTo = null; if (el) el.scrollIntoView({ block: 'start' }); }
  }
  // empty form: fixed dishes of this branch as one-tap chips
  function quickStart(row) {
    var fx = sortDishes((LIB || []).filter(function (d) { return !d.hidden && d.fixed && inBranch(d, row.branch_id); }));
    return '<div class="empty"><div class="ico">🍽️</div><b>עוד אין מנות בבדיקה</b><p>' + (fx.length ? 'המנות הקבועות של הסניף. לחיצה מוסיפה.' : 'הוסף מנה מהספרייה, או כתוב שם חופשי.') + '</p></div>' +
      (fx.length ? '<div class="chips center-chips">' + fx.map(function (d) { return '<button class="chip" data-quick="' + d.id + '">⭐ ' + esc(d.name) + '</button>'; }).join('') + '</div>' : '');
  }
  function dishHtml(x, i, res) {
    var c = res.dishes[x.id] || { answered: 0, total: critOf(TF.row).length }, open = TF.open === x.id;
    var cl = col5(TF.row);
    var head = '<button class="dish-h" data-toggle="' + x.id + '" aria-expanded="' + open + '">' +
      '<span class="n">' + (i + 1) + '</span><span class="t"><b>' + esc(x.name) + '</b><small>' + esc([x.category, c.answered === c.total ? '✓ דורגה' : c.answered + '/' + c.total].filter(Boolean).join(' · ')) + '</small></span>' +
      '<span class="score-chip t-' + tone5(c.score, cl) + '">' + fmt1(c.score) + '</span><span class="chev">' + (open ? '▴' : '▾') + '</span></button>';
    if (!open) return '<section class="dish" id="dish-' + x.id + '">' + head + '</section>';
    var r = x.r || {};
    return '<section class="dish open" id="dish-' + x.id + '">' + head +
      '<div class="dish-b">' + advHtml(x) +
      critOf(TF.row).map(function (cr) {
        var v = r[cr.id];
        return '<div class="crow"><div class="cl">' + esc(cr.label) + '</div><div class="r5" role="group" aria-label="' + esc(cr.label) + '">' +
          [1, 2, 3, 4, 5].map(function (n) { return '<button class="' + (v === n ? 'on v-' + tone5(n, cl) : '') + '" data-rate="' + x.id + '" data-c="' + cr.id + '" data-v="' + n + '" aria-pressed="' + (v === n) + '">' + n + '</button>'; }).join('') +
          '</div></div>';
      }).join('') +
      '<label class="field"><span>הערה</span><input class="input" data-note="' + x.id + '" value="' + esc(x.note || '') + '" placeholder="מה לשפר או לשמר"></label>' +
      '<div class="iact"><label class="cam" id="cam-' + x.id + '" aria-label="צילום המנה">📷' + ((x.photos || []).length ? '<i>' + x.photos.length + '</i>' : '') +
      '<input type="file" accept="image/*" data-photo="' + x.id + '" hidden></label>' +
      '<div class="thumbs">' + (x.photos || []).map(function (p) { return '<img class="thumb" data-path="' + esc(p) + '" data-dish="' + x.id + '" alt="תמונת המנה">'; }).join('') + '</div>' +
      '<button class="link danger-t" data-del="' + x.id + '">הסר מנה</button></div>' +
      '</div></section>';
  }
  // advanced detail: ingredient checklist, temperature vs required, reference photo next to the photo taken
  function advHtml(x) {
    var a = x.adv || {}; if (!hasAdv(a)) return '';
    var h = '<div class="adv">';
    if (a.ingredients && a.ingredients.length) {
      var ig = x.ingr || {};
      h += '<div class="lbl">מרכיבים · לחיצה: ✓ יש, עוד לחיצה: ✗ חסר</div><div class="chips">' + a.ingredients.map(function (n, k) {
        var v = ig[n]; return '<button class="chip ing' + (v ? ' ' + v : '') + '" data-ing="' + x.id + '" data-k="' + k + '">' + (v === 'ok' ? '✓ ' : v === 'miss' ? '✗ ' : '') + esc(n) + '</button>';
      }).join('') + '</div>';
    }
    if (a.temp_min != null || a.temp_max != null) {
      var st = tempState(x);
      h += '<div class="lbl">טמפרטורה בהגשה</div><div class="temp"><input class="input tin" inputmode="decimal" data-tv="' + x.id + '" value="' + esc(x.temp_v == null ? '' : x.temp_v) + '" placeholder="°" aria-label="טמפרטורה שנמדדה">' +
        '<span class="lim">' + (a.temp_min != null ? 'נדרש מעל ' + a.temp_min + '°' : 'נדרש עד ' + a.temp_max + '°') + '</span>' +
        (st ? '<span class="pill ' + (st === 'ok' ? 'pill-ok' : 'pill-bad') + '">' + (st === 'ok' ? '✓ תקין' : '✗ חריגה') + '</span>' : '') + '</div>';
    }
    if (a.size) h += '<div class="advline">⚖️ משקל או גודל: <b>' + esc(a.size) + '</b></div>';
    if (a.presentation) h += '<div class="advline">🎨 הגשה: <b>' + esc(a.presentation) + '</b></div>';
    if (a.ref_photo) {
      var last = (x.photos || [])[x.photos ? x.photos.length - 1 : 0];
      h += '<div class="refpair"><figure><img class="thumb big" data-path="' + esc(a.ref_photo) + '" alt="תמונת ייחוס"><figcaption>ייחוס</figcaption></figure>' +
        '<figure>' + (last ? '<img class="thumb big" data-path="' + esc(last) + '" data-dish="' + x.id + '" alt="מה שהוגש">' : '<label class="thumb big ph" aria-label="צלם את המנה">📷<input type="file" accept="image/*" data-photo="' + x.id + '" hidden></label>') + '<figcaption>מה שהוגש</figcaption></figure></div>';
    }
    return h + '</div>';
  }
  function tempState(x) {
    var a = x.adv || {}; if (x.temp_v == null || x.temp_v === '' || isNaN(x.temp_v)) return null;
    var v = Number(x.temp_v);
    if (a.temp_min != null && v < Number(a.temp_min)) return 'bad';
    if (a.temp_max != null && v > Number(a.temp_max)) return 'bad';
    return 'ok';
  }
  function dish(id) { return TF.row.data.dishes.find(function (x) { return x.id === id; }); }
  function refresh() {
    // light refresh: header numbers and the open dish head, without redrawing the inputs
    var row = TF.row, res = compute(row), cl = col5(row);
    var pct = res.total ? Math.round(res.answered / res.total * 100) : 0;
    var p = document.querySelector('.prog i'); if (p) p.style.width = pct + '%';
    var sc = $('tScore'); if (sc) { sc.textContent = fmt1(res.score5); sc.className = 't-' + tone5(res.score5, cl); }
    var ss = $('saveState'); if (ss) ss.textContent = saveState();
    row.data.dishes.forEach(function (x) {
      var hd = document.querySelector('[data-toggle="' + x.id + '"]'); if (!hd) return;
      var c = res.dishes[x.id];
      hd.querySelector('.score-chip').className = 'score-chip t-' + tone5(c.score, cl); hd.querySelector('.score-chip').textContent = fmt1(c.score);
      hd.querySelector('small').textContent = [x.category, c.answered === c.total ? '✓ דורגה' : c.answered + '/' + c.total].filter(Boolean).join(' · ');
    });
  }
  function bindForm(root) {
    var row = TF.row;
    root.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.onclick = function () { var id = b.dataset.toggle; TF.open = TF.open === id ? null : id; row.data.last_dish = TF.open; TF.scrollTo = TF.open; renderForm(); };
    });
    root.querySelectorAll('[data-quick]').forEach(function (b) {
      b.onclick = function () { var d = (LIB || []).find(function (x) { return x.id === b.dataset.quick; }); if (d) addDish(d, null); };
    });
    root.querySelectorAll('[data-rate]').forEach(function (b) {
      b.onclick = function () {
        var x = dish(b.dataset.rate), r = x.r || (x.r = {}), v = Number(b.dataset.v), c = b.dataset.c;
        r[c] = r[c] === v ? null : v; if (r[c] == null) delete r[c];
        save(row);
        var grp = b.parentNode, cl = col5(row);
        grp.querySelectorAll('button').forEach(function (o) { var on = Number(o.dataset.v) === r[c]; o.className = on ? 'on v-' + tone5(Number(o.dataset.v), cl) : ''; o.setAttribute('aria-pressed', on); });
        refresh();
      };
    });
    root.querySelectorAll('[data-note]').forEach(function (inp) { inp.onchange = function () { dish(inp.dataset.note).note = inp.value.trim(); save(row); }; });
    root.querySelectorAll('[data-ing]').forEach(function (b) {
      b.onclick = function () {
        var x = dish(b.dataset.ing), n = x.adv.ingredients[Number(b.dataset.k)], ig = x.ingr || (x.ingr = {});
        ig[n] = !ig[n] ? 'ok' : ig[n] === 'ok' ? 'miss' : null; if (!ig[n]) delete ig[n];
        save(row); renderForm();
      };
    });
    root.querySelectorAll('[data-tv]').forEach(function (inp) {
      inp.oninput = function () { inp.value = inp.value.replace(/[^\d.\-]/g, ''); };
      inp.onchange = function () {
        var x = dish(inp.dataset.tv), v = inp.value.trim();
        if (v === '' || isNaN(Number(v))) delete x.temp_v; else x.temp_v = Number(v);
        save(row); renderForm();
        if (tempState(x) === 'bad') toast('חריגה מהטמפרטורה הנדרשת: ' + v + '°');
      };
    });
    root.querySelectorAll('[data-photo]').forEach(function (inp) {
      inp.onchange = function () { if (inp.files && inp.files[0]) addPhoto(dish(inp.dataset.photo), inp.files[0]); inp.value = ''; };
    });
    root.querySelectorAll('img.thumb').forEach(function (t) { t.onclick = function () { viewPhoto(t.dataset.path, t.dataset.dish || null); }; });
    root.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var x = dish(b.dataset.del);
        J.sheet('<h3>להסיר את ' + esc(x.name) + '?</h3><p class="muted">הדירוגים, ההערה והתמונות של המנה יימחקו מהבדיקה.</p><div class="stack"><button class="btn btn-danger" id="yDel">🗑️ הסר מנה</button><button class="btn btn-ghost" id="nDel">ביטול</button></div>');
        $('nDel').onclick = J.closeSheet;
        $('yDel').onclick = function () {
          row.data.dishes = row.data.dishes.filter(function (d) { return d.id !== x.id; });
          (x.photos || []).forEach(dropPhoto);
          if (TF.open === x.id) TF.open = null;
          save(row); J.closeSheet(); renderForm(); toast('המנה הוסרה');
        };
      };
    });
  }

  // ---------- add a dish: library search or a free name ----------
  function openPicker() {
    var bid = TF.row.branch_id;
    J.sheet('<h3>＋ הוסף מנה</h3>' +
      '<label class="field"><span>חיפוש בספרייה או שם חופשי</span><input class="input" id="pkQ" placeholder="למשל: המבורגר" autocomplete="off"></label>' +
      '<div id="pkList" class="pick"><div class="loading"><span class="spin"></span></div></div>');
    var q = $('pkQ');
    function draw() {
      var t = q.value.trim(), tl = t.toLowerCase();
      var list = sortDishes((LIB || []).filter(function (d) { return !d.hidden && inBranch(d, bid) && (!tl || (d.name + ' ' + (d.category || '')).toLowerCase().indexOf(tl) >= 0); }));
      var exact = list.some(function (d) { return d.name.trim() === t; });
      var html = (t && !exact ? '<button class="item tap free" id="pkFree"><div class="t"><b>＋ "' + esc(t) + '"</b><small>שם חופשי, לא מהספרייה</small></div></button>' : '');
      var cat = null;
      list.forEach(function (d) {
        var c = d.fixed ? '⭐ בדיקה קבועה' : (d.category || 'בלי קטגוריה');
        if (c !== cat) { html += '<div class="lbl pkcat">' + esc(c) + '</div>'; cat = c; }
        html += '<button class="item tap" data-pk="' + d.id + '"><div class="t"><b>' + esc(d.name) + '</b><small>' + esc([d.fixed ? d.category : '', money((d.prices || {})[bid]), hasAdv(d.advanced) ? 'עם פירוט' : ''].filter(Boolean).join(' · ')) + '</small></div><span class="go">＋</span></button>';
      });
      if (!list.length && !t) html = J.emptyBox('📚', 'הספרייה ריקה לסניף הזה', 'כתוב שם חופשי למעלה. מנהל-על מוסיף מנות במסך "ספריית מנות".', '', '');
      $('pkList').innerHTML = '<div class="list">' + html + '</div>';
      var f = $('pkFree'); if (f) f.onclick = function () { addDish(null, t); };
      document.querySelectorAll('[data-pk]').forEach(function (b) { b.onclick = function () { addDish(LIB.find(function (d) { return d.id === b.dataset.pk; }), null); }; });
    }
    q.oninput = draw;
    q.onkeydown = function (e) { if (e.key === 'Enter') { var f = $('pkFree') || document.querySelector('[data-pk]'); if (f) f.click(); } };
    loadLib().then(draw);
    setTimeout(function () { q.focus(); }, 60);
  }
  function addDish(d, freeName) {
    var row = TF.row, bid = row.branch_id;
    // a snapshot of the dish as it is now: name, category, price and detail. Library edits later don't change it.
    var x = d ? { id: I.uuid(), dish_id: d.id, name: d.name, category: d.category || '', price: (d.prices || {})[bid] != null ? Number(d.prices[bid]) : null, adv: hasAdv(d.advanced) ? I.clone(d.advanced) : null, r: {}, note: '', photos: [] }
      : { id: I.uuid(), dish_id: null, name: freeName, category: '', price: null, adv: null, r: {}, note: '', photos: [] };
    row.data.dishes.push(x);
    TF.open = x.id; row.data.last_dish = x.id; TF.scrollTo = x.id;
    save(row); J.closeSheet(); renderForm();
  }

  // ---------- photos ----------
  function addPhoto(x, file) {
    var row = TF.row, id = x.id;
    var cam = $('cam-' + id); if (cam) cam.classList.add('busy');
    I.compress(file).then(function (blob) {
      var path = row.branch_id + '/' + row.id + '/dish-' + id + '-' + Date.now() + '.jpg';
      var attach = function () { (x.photos = x.photos || []).push(path); save(row); if (TF && TF.row === row) renderForm(); toast('📷 התמונה נשמרה'); };
      return I.idbPut(path, blob).then(function () { var q = I.photoq(); q.push(path); I.setPhotoq(q); attach(); }, function () {
        if (!navigator.onLine) throw new Error('nostore');
        return sb.storage.from('photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' }).then(function (r) { if (r.error) throw r.error; attach(); });
      });
    }).catch(function (e) {
      if (cam) cam.classList.remove('busy');
      var m = (e && e.message) || '';
      toast(m === 'big' ? 'התמונה גדולה מדי. נסה שוב.' : m === 'nostore' ? 'אין מקום בטלפון ואין קליטה. נסה שוב כשיש קליטה.' : 'התמונה לא נשמרה. נסה שוב.');
    });
  }
  function dropPhoto(p) { I.setPhotoq(I.photoq().filter(function (x) { return x !== p; })); I.idbDel(p); }
  function viewPhoto(path, dishId) {
    I.photoUrl(path).then(function (u) {
      J.sheet('<div class="photo-full">' + (u ? '<img src="' + esc(u) + '" alt="תמונה">' : '<p class="muted">התמונה לא זמינה כרגע.</p>') + '</div>' +
        (dishId && TF ? '<button class="btn btn-ghost" id="phDel">🗑️ הסר תמונה</button>' : ''));
      var d = $('phDel'); if (d) d.onclick = function () {
        var x = dish(dishId); x.photos = (x.photos || []).filter(function (p) { return p !== path; });
        dropPhoto(path); save(TF.row); J.closeSheet(); renderForm();
      };
    });
  }

  // ---------- finish ----------
  function openFinish() {
    var row = TF.row, res = compute(row), ds = row.data.dishes;
    if (!ds.length) { toast('הוסף לפחות מנה אחת'); return; }
    var missing = res.total - res.answered, cl = col5(row);
    var empty = ds.filter(function (x) { return !res.dishes[x.id].answered; }).length;
    J.sheet('<h3>סיום בדיקת המנות</h3>' +
      '<div class="bigscore t-' + tone5(res.score5, cl) + '"><b>' + fmt1(res.score5) + '</b><span>מתוך 5 · נבדק ' + Math.round(res.coverage) + '%</span></div>' +
      (missing ? '<div class="notice">' + missing + ' דירוגים חסרים' + (empty ? ' · ' + empty + ' מנות בלי דירוג בכלל, ולא ייכנסו לציון' : '') + '.</div>' : '<div class="notice ok">כל המנות דורגו 👏</div>') +
      '<label class="field"><span>📝 סיכום בשורה אחת</span><input class="input" id="fSum" value="' + esc(row.data.summary || '') + '" placeholder="לא חובה"></label>' +
      '<div class="stack"><button class="btn btn-primary" id="fDone">💾 סיים ושמור</button>' +
      '<button class="btn btn-line" id="fPart">⏹️ סגור בלי להשלים</button>' +
      '<button class="btn btn-ghost" id="fCont">המשך לבדוק</button></div>');
    function keep() { row.data.summary = $('fSum').value.trim(); }
    $('fCont').onclick = function () { keep(); save(row); J.closeSheet(); var s = $('tSum'); if (s) s.value = row.data.summary; };
    $('fDone').onclick = function () {
      keep();
      if (res.score5 == null) { toast('עוד לא דורג אף קריטריון'); return; }
      if (missing) { partial(row, true); return; }
      finish(row, 'done', null);
    };
    $('fPart').onclick = function () { keep(); partial(row, false); };
  }
  function partial(row, fromDone) {
    var res = compute(row);
    J.sheet('<h3>⏹️ סגירה חלקית</h3>' +
      (fromDone ? '<p class="muted">נשארו ' + (res.total - res.answered) + ' דירוגים חסרים, אז הבדיקה תישמר כחלקית.</p>' : '') +
      (res.not_representative ? '<div class="notice">נבדק ' + Math.round(res.coverage) + '%, פחות מ-' + I.minCov() + '%. הבדיקה תסומן "לא מייצגת" ולא תיכנס לממוצעים.</div>' : '') +
      '<div class="lbl">למה סוגרים?</div><div class="chips" id="rsn">' + I.REASONS.map(function (r) { return '<button class="chip" data-r="' + r + '">' + r + '</button>'; }).join('') + '</div>' +
      '<div class="stack"><button class="btn btn-ghost" id="pBack">חזרה לבדיקה</button></div>');
    document.querySelectorAll('#rsn .chip').forEach(function (c) { c.onclick = function () { finish(row, 'partial', c.dataset.r); }; });
    $('pBack').onclick = J.closeSheet;
  }
  function finish(row, status, reason) {
    var res = compute(row);
    row.status = status; row.partial_reason = reason;
    row.not_representative = res.not_representative;
    row.finished_at = new Date().toISOString();
    save(row);
    J.closeSheet(); TF = null; document.body.classList.remove('in-tasting');
    toast(status === 'done' ? 'בדיקת המנות נשמרה' : 'נשמרה כבדיקה חלקית');
    J.go('report', row.id);
  }

  // ---------- list pill ----------
  function pill(a) {
    var s = a.result && a.result.score5;
    return '<span class="pills">' + (a.status === 'partial' ? '<span class="pill pill-warn">חלקית</span>' : '') +
      (a.not_representative ? '<span class="pill">לא מייצגת</span>' : '') +
      '<span class="score-chip t-' + tone5(s, col5(a)) + '">' + fmt1(s) + '<small class="of5">/5</small></span></span>';
  }

  // ---------- saved tasting: view only ----------
  function prevTasting(a) {
    if (!navigator.onLine) return Promise.resolve(null);
    return sb.from('audits').select('id,started_at,result').eq('type', 'tasting').eq('branch_id', a.branch_id).neq('status', 'draft').neq('id', a.id)
      .lt('started_at', a.started_at).order('started_at', { ascending: false }).limit(5).then(function (r) {
        return ((r.data || []).filter(function (x) { return x.result && x.result.score5 != null; })[0]) || null;
      }, function () { return null; });
  }
  function fmtDelta(d) { return d == null ? '' : (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(1); }
  function arrow(d) { return d == null ? '' : d > 0 ? '↑' : d < 0 ? '↓' : '→'; }
  function report(m, a) {
    TF = null; document.body.classList.remove('in-tasting');
    var res = a.result || compute(a), d = a.data || {}, cl = col5(a), cr = critOf(a), s = res.score5;
    var photos = [];
    (d.dishes || []).forEach(function (x) { (x.photos || []).forEach(function (p) { photos.push({ p: p, label: x.name }); }); });
    m.innerHTML = '<div class="fhead"><button class="icon-btn" id="rBack" aria-label="חזרה">→</button><div class="ft"><b>בדיקת מנות · ' + esc(J.branchName(a.branch_id)) + '</b><small>' + I.dmy(a.started_at) + ' · ' + I.hm(a.started_at) + (d.shift ? ' · ' + esc(d.shift) : '') + '</small></div></div>' +
      '<div class="bigscore t-' + tone5(s, cl) + '"><b>' + fmt1(s) + '</b><span>מתוך 5 · נבדק ' + Math.round(res.coverage || 0) + '%</span></div>' +
      '<div class="tags">' + (a.status === 'partial' ? '<span class="pill pill-warn">⏹️ חלקית' + (a.partial_reason ? ' · ' + esc(a.partial_reason) : '') + '</span>' : '<span class="pill pill-ok">הושלמה</span>') +
      (a.not_representative ? '<span class="pill">לא מייצגת · לא נכנסת לממוצעים</span>' : '') + '<span class="pill" id="rPrev" hidden></span></div>' +
      '<div class="kv card"><div>מבקר: <b>' + esc(d.auditor || '') + '</b></div>' + (d.manager ? '<div>מנהל משמרת: <b>' + esc(d.manager) + '</b></div>' : '') +
      (d.summary ? '<div>📝 <b>' + esc(d.summary) + '</b></div>' : '') + '</div>' +
      '<div class="stack"><button class="btn btn-primary" id="waCopy">💬 העתק סיכום לוואטסאפ</button><a class="btn btn-line" id="waOpen" target="_blank" rel="noopener">פתח בוואטסאפ</a></div>' +
      '<h3 class="sec">מנות (' + (d.dishes || []).length + ')</h3><div class="list">' + (d.dishes || []).map(function (x) {
        var c = (res.dishes || {})[x.id] || {}, r = x.r || {};
        var miss = Object.keys(x.ingr || {}).filter(function (k) { return x.ingr[k] === 'miss'; });
        var ts = tempState(x), a2 = x.adv || {};
        return '<div class="item col"><div class="rowx"><div class="t"><b>' + esc(x.name) + '</b><small>' + esc([x.category, x.price != null ? money(x.price) : '', (c.answered || 0) + '/' + (c.total || cr.length) + ' דורגו'].filter(Boolean).join(' · ')) + '</small></div>' +
          '<span class="score-chip t-' + tone5(c.score, cl) + '">' + fmt1(c.score) + '</span></div>' +
          '<div class="cgrid">' + cr.map(function (k) { var v = r[k.id]; return '<span class="cg' + (typeof v === 'number' && v <= 3 ? ' weak' : '') + '">' + esc(k.label) + ' <b>' + (typeof v === 'number' ? v : '–') + '</b></span>'; }).join('') + '</div>' +
          (ts ? '<p class="small ' + (ts === 'bad' ? 'bad-t' : 'muted') + '">🌡️ ' + x.temp_v + '° · ' + (a2.temp_min != null ? 'נדרש מעל ' + a2.temp_min + '°' : 'נדרש עד ' + a2.temp_max + '°') + (ts === 'bad' ? ' · חריגה' : ' · תקין') + '</p>' : '') +
          (miss.length ? '<p class="small bad-t">חסר במנה: ' + esc(miss.join(', ')) + '</p>' : '') +
          (x.note ? '<p class="muted small">📝 ' + esc(x.note) + '</p>' : '') + '</div>';
      }).join('') + '</div>' +
      (photos.length ? '<h3 class="sec">תמונות (' + photos.length + ')</h3><div class="pgrid">' + photos.map(function (x) { return '<figure><img class="thumb" data-path="' + esc(x.p) + '" alt="' + esc(x.label) + '"><figcaption>' + esc(x.label) + '</figcaption></figure>'; }).join('') + '</div>' : '') +
      '<p class="muted small center">ציון מנות נפרד מציון הסניף ולא נכנס אליו. צפייה בלבד, עריכה ומחיקה בשלב 5.</p>';
    $('rBack').onclick = function () { J.go('home'); };
    var set = function (prev) {
      var text = waText(a, prev);
      $('waOpen').href = 'https://wa.me/?text=' + encodeURIComponent(text);
      $('waCopy').onclick = function () { I.copy(text); };
      if (prev && s != null) { var dl = r1(s - prev.result.score5), el = $('rPrev'); if (el) { el.hidden = false; el.textContent = 'מול בדיקה קודמת ' + fmtDelta(dl) + ' ' + arrow(dl); } }
    };
    set(null);
    prevTasting(a).then(function (p) { if ($('waCopy')) set(p); });
    I.loadThumbs(m);
    m.querySelectorAll('.thumb').forEach(function (t) { t.onclick = function () { viewPhoto(t.dataset.path, null); }; });
  }
  // WhatsApp text, in the 1.6.1 wording
  function waText(a, prev) {
    var res = a.result || compute(a), d = a.data || {}, cl = col5(a), cr = critOf(a), s = res.score5;
    var L = [
      "🍽️ *ג'מס · בדיקת מנות*",
      '📍 ' + J.branchName(a.branch_id),
      '🗓️ ' + I.dmy(a.started_at) + (d.shift ? ' · ' + d.shift : ''),
      '👤 מבקר: ' + (d.auditor || '') + (d.manager ? ' · מנהל משמרת: ' + d.manager : ''),
      '',
      '*ציון מנות: ' + fmt1(s) + '/5* ' + emo5(s, cl) + (res.coverage != null && res.coverage < 100 ? ' · נבדק ' + Math.round(res.coverage) + '%' : '')
    ];
    if (a.status === 'partial') L.push('⏹️ נסגרה חלקית' + (a.partial_reason ? ': ' + a.partial_reason : ''));
    if (prev && s != null) { var dl = r1(s - prev.result.score5); L.push('מול בדיקה קודמת ' + fmtDelta(dl) + ' ' + arrow(dl)); }
    (d.dishes || []).forEach(function (x) {
      var c = (res.dishes || {})[x.id] || {};
      L.push('', emo5(c.score, cl) + ' *' + x.name + '* ' + fmt1(c.score));
      var weak = cr.filter(function (k) { return typeof (x.r || {})[k.id] === 'number' && x.r[k.id] <= 3; }).map(function (k) { return k.label + ' ' + x.r[k.id]; });
      if (weak.length) L.push('לשיפור: ' + weak.join(' · '));
      if (tempState(x) === 'bad') { var a2 = x.adv || {}; L.push('🌡️ ' + x.temp_v + '° · ' + (a2.temp_min != null ? 'נדרש מעל ' + a2.temp_min + '°' : 'נדרש עד ' + a2.temp_max + '°')); }
      var miss = Object.keys(x.ingr || {}).filter(function (k) { return x.ingr[k] === 'miss'; });
      if (miss.length) L.push('חסר: ' + miss.join(', '));
      if (x.note) L.push('📝 ' + x.note);
    });
    if (d.summary) L.push('', '📝 ' + d.summary);
    var ph = []; (d.dishes || []).forEach(function (x) { (x.photos || []).forEach(function () { ph.push(x.name); }); });
    if (ph.length) { L.push('', '*תמונות (' + ph.length + ')*'); ph.forEach(function (w, i) { L.push((i + 1) + '. ' + w); }); }
    L.push('', '_דירוג 1 עד 5 · 🟢 ' + cl.green + ' ומעלה · 🟡 ' + cl.yellow + ' עד ' + fmt1(cl.green - 0.1) + ' · 🔴 מתחת ל-' + cl.yellow + '_');
    return L.join('\n');
  }

  // ---------- library screen ----------
  var LV = { q: '', br: '', hidden: false };
  function viewLib(m) {
    TF = null; document.body.classList.remove('in-tasting');
    var admin = J.isAdmin();
    m.innerHTML = '<div class="fhead"><button class="icon-btn" id="lBack" aria-label="חזרה">→</button><div class="ft"><b>🍽️ ספריית מנות</b><small>' + (admin ? 'לחיצה על מנה לעריכה' : 'צפייה בלבד') + '</small></div>' +
      (admin ? '<button class="btn btn-sm" id="lNew">＋ מנה</button>' : '') + '</div>' +
      '<label class="field"><span class="sr">חיפוש</span><input class="input" id="lQ" value="' + esc(LV.q) + '" placeholder="🔎 חיפוש מנה או קטגוריה" autocomplete="off"></label>' +
      '<div class="chips" id="lBr"><button class="chip' + (!LV.br ? ' on' : '') + '" data-b="">כל הסניפים</button>' + S.branches.map(function (b) { return '<button class="chip' + (LV.br === b.id ? ' on' : '') + '" data-b="' + b.id + '">' + esc(b.name) + '</button>'; }).join('') +
      (admin ? '<button class="chip' + (LV.hidden ? ' on' : '') + '" id="lHid">🙈 מוסתרות</button>' : '') + '</div>' +
      '<div id="lList"><div class="loading"><span class="spin"></span></div></div>';
    $('lBack').onclick = function () { J.go(admin ? 'settings' : 'me'); };
    var nw = $('lNew'); if (nw) nw.onclick = function () { editDish(null); };
    $('lQ').oninput = function () { LV.q = this.value; drawLib(); };
    m.querySelectorAll('#lBr [data-b]').forEach(function (b) { b.onclick = function () { LV.br = b.dataset.b; viewLib(m); }; });
    var hd = $('lHid'); if (hd) hd.onclick = function () { LV.hidden = !LV.hidden; viewLib(m); };
    loadLib(true).then(drawLib);
  }
  function drawLib() {
    var el = $('lList'); if (!el) return;
    var tl = LV.q.trim().toLowerCase();
    var list = sortDishes((LIB || []).filter(function (d) {
      return (LV.hidden ? d.hidden : !d.hidden) && (!LV.br || inBranch(d, LV.br)) && (!tl || (d.name + ' ' + (d.category || '')).toLowerCase().indexOf(tl) >= 0);
    }));
    if (!list.length) {
      el.innerHTML = (LIB || []).length ? J.emptyBox('🔎', 'לא נמצאו מנות', 'נסה חיפוש אחר, או בחר "כל הסניפים".', '', '')
        : J.emptyBox('📚', 'הספרייה ריקה', J.isAdmin() ? 'הוסף מנה ראשונה בכפתור ＋ מנה למעלה.' : 'מנהל-על מוסיף את המנות.', '', '');
      return;
    }
    var html = '', cat = null;
    list.forEach(function (d) {
      var c = d.fixed ? '⭐ בדיקה קבועה' : (d.category || 'בלי קטגוריה');
      if (c !== cat) { html += '<h3 class="sec">' + esc(c) + '</h3>'; cat = c; }
      var brs = (d.branch_ids && d.branch_ids.length ? d.branch_ids.map(J.branchName).filter(Boolean) : ['כל הסניפים']);
      var pr = Object.keys(d.prices || {}).filter(function (k) { return d.prices[k] != null && d.prices[k] !== ''; }).map(function (k) { return J.branchName(k) + ' ' + money(d.prices[k]); });
      html += '<button class="item tap" data-ed="' + d.id + '"' + (J.isAdmin() ? '' : ' disabled') + '><div class="t"><b>' + esc(d.name) + '</b><small>' +
        esc([d.fixed ? d.category : '', brs.join(', '), pr.join(' · ') || 'בלי מחיר'].filter(Boolean).join(' · ')) + '</small></div>' +
        (hasAdv(d.advanced) ? '<span class="pill">פירוט</span>' : '') + (d.hidden ? '<span class="pill">מוסתרת</span>' : '') + '</button>';
    });
    el.innerHTML = '<div class="list">' + html + '</div>';
    el.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { if (J.isAdmin()) editDish(LIB.find(function (x) { return x.id === b.dataset.ed; })); }; });
  }
  function editDish(d) {
    var isNew = !d;
    d = d ? I.clone(d) : { id: I.uuid(), name: '', category: '', branch_ids: LV.br ? [LV.br] : [], prices: {}, advanced: {}, hidden: false, fixed: false, sort: 0 };
    d.advanced = d.advanced || {}; d.prices = d.prices || {}; d.branch_ids = d.branch_ids || [];
    var a = d.advanced, refBlob = null;
    var cats = []; (LIB || []).forEach(function (x) { if (x.category && cats.indexOf(x.category) < 0) cats.push(x.category); });
    var tKind = a.temp_max != null ? 'cold' : 'hot', tVal = a.temp_min != null ? a.temp_min : a.temp_max != null ? a.temp_max : '';
    function draw() {
      J.sheet('<h3>' + (isNew ? '＋ מנה חדשה' : '✏️ עריכת מנה') + '</h3>' +
        '<label class="field"><span>שם המנה</span><input class="input" id="eName" value="' + esc(d.name) + '" placeholder="למשל: ג\'מסבורגר"></label>' +
        '<label class="field"><span>קטגוריה</span><input class="input" id="eCat" list="eCats" value="' + esc(d.category || '') + '" placeholder="למשל: עיקריות"><datalist id="eCats">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></label>' +
        '<div class="lbl">באילו סניפים בתפריט</div><div class="chips" id="eBr">' + S.branches.map(function (b) { var on = d.branch_ids.indexOf(b.id) >= 0; return '<button class="chip' + (on ? ' on' : '') + '" data-b="' + b.id + '" aria-pressed="' + on + '">' + esc(b.name) + '</button>'; }).join('') + '</div>' +
        d.branch_ids.map(function (bid) { return '<label class="field"><span>מחיר ב' + esc(J.branchName(bid)) + ' · ₪</span><input class="input" inputmode="decimal" data-price="' + bid + '" value="' + esc(d.prices[bid] == null ? '' : d.prices[bid]) + '" placeholder="לא חובה"></label>'; }).join('') +
        '<div class="chips"><button class="chip' + (d.fixed ? ' on' : '') + '" id="eFix" aria-pressed="' + !!d.fixed + '">⭐ בדיקה קבועה</button><button class="chip' + (d.hidden ? ' on' : '') + '" id="eHid" aria-pressed="' + !!d.hidden + '">🙈 מוסתרת</button></div>' +
        '<details class="adv-ed"' + (hasAdv(a) ? ' open' : '') + '><summary>פירוט מתקדם · לא חובה</summary>' +
        '<label class="field"><span>מרכיבים · כל מרכיב בשורה</span><textarea class="input ta" id="eIng" rows="3" placeholder="לחמנייה&#10;קציצה 200 גרם&#10;חסה">' + esc((a.ingredients || []).join('\n')) + '</textarea></label>' +
        '<div class="lbl">טמפרטורת הגשה נדרשת</div><div class="chips" id="eTk"><button class="chip' + (tKind === 'hot' ? ' on' : '') + '" data-k="hot">🔥 חמה · מעל</button><button class="chip' + (tKind === 'cold' ? ' on' : '') + '" data-k="cold">❄️ קרה · עד</button></div>' +
        '<label class="field"><span>מעלות</span><input class="input" inputmode="decimal" id="eTemp" value="' + esc(tVal) + '" placeholder="לא חובה, למשל 65"></label>' +
        '<label class="field"><span>משקל או גודל</span><input class="input" id="eSize" value="' + esc(a.size || '') + '" placeholder="למשל: 200 גרם"></label>' +
        '<label class="field"><span>הערות הגשה</span><textarea class="input ta" id="ePres" rows="2" placeholder="למשל: רוטב בצד, צ\'יפס בסלסלה">' + esc(a.presentation || '') + '</textarea></label>' +
        '<label class="btn btn-line cam-wide">📷 ' + (a.ref_photo || refBlob ? 'החלף תמונת ייחוס' : 'הוסף תמונת ייחוס') + '<input type="file" accept="image/*" id="eRef" hidden></label>' +
        '<div class="thumbs" id="eRefPrev">' + (refBlob ? '<img class="thumb big" src="' + URL.createObjectURL(refBlob) + '" alt="תמונת ייחוס">' : a.ref_photo ? '<img class="thumb big" data-path="' + esc(a.ref_photo) + '" alt="תמונת ייחוס">' : '') + '</div>' +
        '</details>' +
        '<div class="stack"><button class="btn btn-primary" id="eSave">💾 שמור מנה</button>' + (isNew ? '' : '<button class="btn btn-ghost danger-t" id="eDel">🗑️ מחק מהספרייה</button>') + '</div>');
      I.loadThumbs($('sheet'));
      document.querySelectorAll('#eBr .chip').forEach(function (c) {
        c.onclick = function () { read(); var i = d.branch_ids.indexOf(c.dataset.b); if (i >= 0) d.branch_ids.splice(i, 1); else d.branch_ids.push(c.dataset.b); draw(); };
      });
      $('eFix').onclick = function () { read(); d.fixed = !d.fixed; draw(); };
      $('eHid').onclick = function () { read(); d.hidden = !d.hidden; draw(); };
      document.querySelectorAll('#eTk .chip').forEach(function (c) { c.onclick = function () { read(); tKind = c.dataset.k; draw(); }; });
      $('eRef').onchange = function () { var f = this.files && this.files[0]; if (!f) return; read(); I.compress(f).then(function (b) { refBlob = b; draw(); }, function () { toast('התמונה לא נטענה'); }); };
      $('eSave').onclick = saveIt;
      var dl = $('eDel'); if (dl) dl.onclick = delIt;
    }
    function read() {
      if (!$('eName')) return;
      d.name = $('eName').value.trim(); d.category = $('eCat').value.trim();
      document.querySelectorAll('[data-price]').forEach(function (p) { var v = p.value.trim(); if (v === '' || isNaN(Number(v))) delete d.prices[p.dataset.price]; else d.prices[p.dataset.price] = Number(v); });
      a.ingredients = $('eIng').value.split(/\n|,/).map(function (x) { return x.trim(); }).filter(Boolean);
      var tv = $('eTemp').value.trim(); tVal = tv;
      delete a.temp_min; delete a.temp_max;
      if (tv !== '' && !isNaN(Number(tv))) { if (tKind === 'hot') a.temp_min = Number(tv); else a.temp_max = Number(tv); }
      a.size = $('eSize').value.trim(); a.presentation = $('ePres').value.trim();
      if (!a.ingredients.length) delete a.ingredients; if (!a.size) delete a.size; if (!a.presentation) delete a.presentation;
    }
    function saveIt() {
      read();
      if (!d.name) { toast('כתוב שם למנה'); $('eName').focus(); return; }
      if (!navigator.onLine) { toast('אין קליטה. עריכת הספרייה דורשת חיבור.'); return; }
      Object.keys(d.prices).forEach(function (k) { if (d.branch_ids.indexOf(k) < 0) delete d.prices[k]; });
      var btn = $('eSave'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> שומר…';
      var up = Promise.resolve();
      if (refBlob) {
        var path = 'library/' + d.id + '-' + Date.now() + '.jpg';
        up = sb.storage.from('photos').upload(path, refBlob, { upsert: true, contentType: 'image/jpeg' }).then(function (r) { if (r.error) throw r.error; a.ref_photo = path; });
      }
      up.then(function () {
        var rowOut = { id: d.id, name: d.name, category: d.category || null, branch_ids: d.branch_ids, prices: d.prices, advanced: a, hidden: !!d.hidden, fixed: !!d.fixed, sort: d.sort || 0, updated_at: new Date().toISOString() };
        return sb.from('dishes').upsert(rowOut, { onConflict: 'id' }).then(function (r) { if (r.error) throw r.error; });
      }).then(function () {
        J.closeSheet(); toast(isNew ? 'המנה נוספה' : 'המנה נשמרה');
        loadLib(true).then(drawLib);
      }).catch(function () { btn.disabled = false; btn.textContent = '💾 שמור מנה'; toast('השמירה לא הצליחה. נסה שוב.'); });
    }
    function delIt() {
      J.sheet('<h3>למחוק את ' + esc(d.name) + '?</h3><p class="muted">המנה תימחק מהספרייה. בדיקות שמורות לא ישתנו, כי הן שומרות עותק של המנה. אם רק הורדתם אותה מהתפריט, עדיף "מוסתרת".</p>' +
        '<div class="stack"><button class="btn btn-danger" id="yDel">🗑️ מחק</button><button class="btn btn-ghost" id="nDel">ביטול</button></div>');
      $('nDel').onclick = draw;
      $('yDel').onclick = function () {
        sb.from('dishes').delete().eq('id', d.id).then(function (r) {
          if (r.error) { toast('המחיקה לא הצליחה'); return; }
          J.closeSheet(); toast('המנה נמחקה'); loadLib(true).then(drawLib);
        });
      };
    }
    draw();
  }

  // warm the library cache so the picker works without signal
  setTimeout(function () { if (S.me) loadLib(); }, 1500);

  A.views.dishes = viewLib;
  window.JEMS_TASTING = {
    start: start, form: form, save: save, compute: compute, report: report, pill: pill, partial: partial, summaryLine: summaryLine,
    // exposed for tests
    _waText: waText, _loadLib: loadLib
  };
})();
