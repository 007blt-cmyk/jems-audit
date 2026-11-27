/* ביקור סניף · JEM'S · 2.0 · שלב 2: ביקורת מלאה ובזק, טיוטות, עבודה בלי קליטה, ליקויים ארוכי טווח */
(function () {
  'use strict';
  var J = window.JEMS;
  var sb = J.sb, S = J.state, esc = J.esc, toast = J.toast;

  var REASONS = ['אין זמן', 'הפרעה תפעולית', 'סניף סגור חלקית', 'אחר'];
  var DAY = 86400000;

  // ---------- small helpers ----------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function fmt1(x) { return (x == null || isNaN(x)) ? '–' : Number(x).toFixed(1); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dmy(iso) { var d = new Date(iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function hm(iso) { var d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dm(iso) { var d = new Date(iso.length <= 10 ? iso + 'T00:00' : iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function uid() { return S.me && S.me.id; }
  function branch(id) { return S.branches.find(function (b) { return b.id === id; }) || null; }
  function gen() { return S.general || {}; }
  function colors() { return gen().colors || { green: 8, yellow: 6 }; }
  function cap() { return gen().critical_cap != null ? Number(gen().critical_cap) : 5.9; }
  function minCov() { return gen().min_coverage != null ? Number(gen().min_coverage) : 50; }
  function tone(s) { if (s == null) return 'none'; var c = colors(); return s >= c.green ? 'green' : s >= c.yellow ? 'yellow' : 'red'; }
  function toneEmoji(s) { return { green: '🟢', yellow: '🟡', red: '🔴', none: '⚪' }[tone(s)]; }
  function main() { return document.getElementById('main'); }
  function $(id) { return document.getElementById(id); }

  // ---------- phone storage ----------
  // Everything is written here first, then sent to the cloud. Nothing is lost without signal.
  function key(k) { return 'jems-a2-' + (uid() || 'x') + '-' + k; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('הזיכרון בטלפון מלא. התחבר לרשת כדי לשלוח.'); return false; } }
  function local() { return lsGet(key('audits'), {}); }
  function setLocal(m) { lsSet(key('audits'), m); }
  function defq() { return lsGet(key('defq'), []); }
  function setDefq(q) { lsSet(key('defq'), q); }
  function photoq() { return lsGet(key('photoq'), []); }
  function setPhotoq(q) { lsSet(key('photoq'), q); }

  function saveMeta(id, meta) { try { localStorage.setItem('jems-a2-meta-' + id, JSON.stringify(meta)); } catch (e) {} }
  function loadMeta(id) { try { return JSON.parse(localStorage.getItem('jems-a2-meta-' + id)); } catch (e) { return null; } }

  // photos waiting for signal live in IndexedDB (too big for localStorage)
  var idbP = null;
  function idb() {
    if (idbP) return idbP;
    idbP = new Promise(function (res, rej) {
      var r = indexedDB.open('jems-a2', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('photos'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return idbP;
  }
  function idbPut(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('photos', 'readwrite'); t.objectStore('photos').put(v, k); t.oncomplete = res; t.onerror = function () { rej(t.error); }; }); }); }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction('photos').objectStore('photos').get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }); }
  function idbDel(k) { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction('photos', 'readwrite'); t.objectStore('photos').delete(k); t.oncomplete = res; t.onerror = res; }); }); }

  // ---------- sync ----------
  var syncing = false, syncAgain = false, saveT = null;
  function pendingCount() {
    var m = local(), n = 0;
    Object.keys(m).forEach(function (k) { if (m[k].dirty) n++; });
    return n + defq().length + photoq().length;
  }
  function syncBadge() {
    var n = pendingCount();
    var el = $('syncbar');
    if (!el) { el = document.createElement('div'); el.id = 'syncbar'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    if (!n) { el.className = ''; el.textContent = ''; return; }
    el.className = 'show' + (navigator.onLine ? '' : ' off');
    el.textContent = navigator.onLine ? '⏳ שולח לענן…' : '📱 נשמר בטלפון, ממתין לשליחה';
    var f = $('saveState'); if (f) f.textContent = navigator.onLine ? 'שולח…' : '📱 נשמר בטלפון';
  }
  function permanent(err) { return err && (err.code === '42501' || err.code === '23503' || err.code === '23514' || err.code === '22P02' || /row-level security/i.test(err.message || '')); }

  function sync() {
    if (!uid()) return Promise.resolve();
    if (syncing) { syncAgain = true; return Promise.resolve(); }
    if (!navigator.onLine) { syncBadge(); return Promise.resolve(); }
    syncing = true; syncBadge();
    return syncAudits().then(syncPhotos).then(syncDefects).catch(function () {}).then(function () {
      syncing = false; syncBadge();
      var f = $('saveState'); if (f && !pendingCount()) f.textContent = '☁️ נשמר';
      if (syncAgain) { syncAgain = false; return sync(); }
    });
  }
  function syncAudits() {
    var m = local(), ids = Object.keys(m).filter(function (k) { return m[k].dirty; });
    return ids.reduce(function (p, id) {
      return p.then(function () {
        var e = local()[id]; if (!e || !e.dirty) return;
        var rev = e.rev;
        return sb.from('audits').upsert(e.row, { onConflict: 'id' }).then(function (r) {
          var cur = local();
          if (r.error) {
            if (permanent(r.error) && cur[id]) { cur[id].error = r.error.message; cur[id].dirty = false; setLocal(cur); toast('ביקורת אחת לא נשמרה בענן: אין הרשאה לסניף הזה.'); return; }
            throw r.error;
          }
          if (cur[id] && cur[id].rev === rev) {
            cur[id].dirty = false;
            if (cur[id].row.status !== 'draft') delete cur[id]; // finished and safe in the cloud
            setLocal(cur);
          }
        });
      });
    }, Promise.resolve());
  }
  function syncPhotos() {
    var q = photoq();
    return q.reduce(function (p, path) {
      return p.then(function () {
        return idbGet(path).then(function (blob) {
          if (!blob) { setPhotoq(photoq().filter(function (x) { return x !== path; })); return; }
          return sb.storage.from('photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' }).then(function (r) {
            if (r.error && !/exists|Duplicate/i.test(r.error.message || '')) {
              if (/row-level|security|403|Unauthorized/i.test(r.error.message || '')) { setPhotoq(photoq().filter(function (x) { return x !== path; })); return; }
              throw r.error;
            }
            setPhotoq(photoq().filter(function (x) { return x !== path; }));
            return idbDel(path);
          });
        });
      });
    }, Promise.resolve());
  }
  function syncDefects() {
    var q = defq();
    return q.reduce(function (p, op) {
      return p.then(function () {
        var req = op.op === 'insert' ? sb.from('long_term_defects').upsert(op.row, { onConflict: 'id' })
          : sb.from('long_term_defects').update(op.row).eq('id', op.id);
        return req.then(function (r) {
          if (r.error && !permanent(r.error)) throw r.error;
          if (r.error) toast('עדכון ליקוי לא נשמר: אין הרשאה.');
          setDefq(defq().filter(function (x) { return x.k !== op.k; }));
        });
      });
    }, Promise.resolve());
  }
  window.addEventListener('online', function () { syncBadge(); sync(); });
  window.addEventListener('offline', syncBadge);
  var started = false;
  function start() {
    syncBadge();
    if (started) return; started = true;
    setInterval(sync, 30000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync(); });
    sync();
  }

  // ---------- audit model ----------
  // dept_snap: the departments and items of this branch at the moment the audit started, filtered by type.
  // Later settings changes never touch an audit that already exists.
  function buildSnap(b, type) {
    var cfg = (b && b.config) || {};
    var depts = (cfg.depts || []).filter(function (d) {
      if (d.tasting) return false; // dish tastings come in stage 3
      if (d.monthly && type !== 'full') return false;
      return true;
    }).map(function (d) {
      var items = (d.items || []).filter(function (i) { return type !== 'quick' || (i.quick != null ? i.quick : i.critical); });
      return { id: d.id, name: d.name, icon: d.icon, weight: d.weight, cat: d.cat, monthly: !!d.monthly, items: clone(items) };
    }).filter(function (d) { return d.items.length; });
    return { config_version: gen().config_version || 1, legacy_branch: cfg.legacy_id || null, depts: depts };
  }
  function itemResult(item, rec) {
    if (!rec) return null;
    if (rec.r === 'na') return 'na';
    if (item.kind === 'temp') {
      if (rec.v === '' || rec.v == null || isNaN(rec.v)) return null;
      var v = Number(rec.v);
      if (item.max != null && item.max !== '' && v > Number(item.max)) return 'bad';
      if (item.min != null && item.min !== '' && v < Number(item.min)) return 'bad';
      return 'ok';
    }
    return rec.r === 'ok' || rec.r === 'bad' ? rec.r : null;
  }
  // score: dept = 1 + 9 × ok/(ok+bad), critical fail caps at 5.9.
  // A dept checked under 50% is "partial" and stays out of the total. Total = weighted average.
  function compute(row) {
    var snap = row.dept_snap || { depts: [] }, items = (row.data && row.data.items) || {};
    var depts = {}, wS = 0, sS = 0, total = 0, answered = 0, notChecked = {}, critUnchecked = [];
    var mc = minCov() / 100;
    snap.depts.forEach(function (d) {
      var ok = 0, bad = 0, na = 0, crit = false, miss = [];
      d.items.forEach(function (it) {
        var r = itemResult(it, items[it.id]);
        if (r === 'ok') ok++; else if (r === 'bad') { bad++; if (it.critical) crit = true; } else if (r === 'na') na++;
        else { miss.push(it.id); if (it.critical) critUnchecked.push(it.id); }
      });
      var t = d.items.length, a = ok + bad + na;
      total += t; answered += a;
      var s = ok + bad ? 1 + 9 * ok / (ok + bad) : null;
      if (s != null && crit) s = Math.min(s, cap());
      s = s == null ? null : r1(s);
      var partial = t > 0 && a / t < mc;
      var w = Number(d.weight) || 0;
      if (s != null && !partial && w > 0) { wS += w; sS += w * s; }
      depts[d.id] = { score: s, ok: ok, bad: bad, na: na, total: t, answered: a, critFail: crit, partial: partial };
      if (miss.length) notChecked[d.id] = miss;
    });
    var coverage = total ? Math.round(answered / total * 1000) / 10 : 0;
    return {
      overall: wS ? r1(sS / wS) : null, coverage: coverage, answered: answered, total: total,
      not_representative: coverage < minCov(), depts: depts, not_checked: notChecked, crit_unchecked: critUnchecked
    };
  }
  function store(row) {
    row.updated_at = new Date().toISOString();
    var m = local(), e = m[row.id] || { rev: 0 };
    e.row = row; e.rev = (e.rev || 0) + 1; e.dirty = true; delete e.error;
    m[row.id] = e; setLocal(m); syncBadge();
    clearTimeout(saveT); saveT = setTimeout(sync, 700);
  }
  function cloudRow(row) {
    // only real columns go to the cloud
    var o = {};
    ['id', 'branch_id', 'created_by', 'type', 'status', 'coverage', 'not_representative', 'partial_reason', 'data', 'dept_snap', 'result', 'started_at', 'finished_at'].forEach(function (k) { if (row[k] !== undefined) o[k] = row[k]; });
    return o;
  }
  function save(row) {
    var res = compute(row);
    row.coverage = res.coverage;
    row.result = { overall: res.overall, coverage: res.coverage, answered: res.answered, total: res.total, depts: res.depts, not_checked: res.not_checked };
    store(cloudRow(row));
  }

  // ---------- new audit ----------
  function openNew() {
    var ok = J.allowedTypes();
    if (!ok.length) { J.sheet('<h3>ביקורת חדשה</h3>' + J.noRoleBox()); return; }
    var live = { full: 1, quick: 1 };
    J.sheet('<h3>איזו ביקורת?</h3><div class="types">' + J.TYPES.filter(function (t) { return ok.indexOf(t.id) >= 0; }).map(function (t) {
      return '<button class="type" data-type="' + t.id + '"' + (live[t.id] ? '' : ' disabled') + '><span class="e">' + t.e + '</span><span class="t"><b>' + t.n + '</b><small>' + t.d + '</small></span>' +
        (live[t.id] ? '' : '<span class="pill">בקרוב</span>') + '</button>';
    }).join('') + '</div>');
    document.querySelectorAll('.type[data-type]').forEach(function (b) {
      b.onclick = function () { if (live[b.dataset.type]) pickBranch(b.dataset.type); };
    });
  }
  function writableBranches() {
    return S.branches.filter(function (b) { return b.config && b.config.depts && b.config.depts.length; });
  }
  function pickBranch(type, chosen) {
    var bs = writableBranches();
    if (!bs.length) { J.sheet('<h3>אין סניף זמין</h3>' + J.emptyBox('🏬', 'לא שויך לך סניף', 'בקש מתומר לשייך אותך לסניף.', '', '')); return; }
    var bid = chosen || (bs.length === 1 ? bs[0].id : null);
    var b = bid ? branch(bid) : null;
    var shifts = b ? (b.config.shifts || []) : [];
    var lastMgr = lsGet(key('lastmgr-' + bid), '');
    J.sheet('<h3>' + esc(J.TYPE_NAMES[type]) + '</h3>' +
      '<div class="lbl">סניף</div><div class="chips" id="brChips">' + bs.map(function (x) {
        return '<button class="chip' + (x.id === bid ? ' on' : '') + '" data-b="' + x.id + '" aria-pressed="' + (x.id === bid) + '">' + esc(x.name) + '</button>';
      }).join('') + '</div>' +
      (b ? (shifts.length ? '<div class="lbl">משמרת</div><div class="chips" id="shChips">' + shifts.map(function (s, i) {
        return '<button class="chip' + (i === guessShift(shifts) ? ' on' : '') + '" data-s="' + esc(s) + '">' + esc(s) + '</button>';
      }).join('') + '</div>' : '') +
        '<label class="field"><span>מנהל המשמרת</span><input class="input" id="mgrIn" value="' + esc(lastMgr) + '" placeholder="לא חובה" autocomplete="off"></label>' +
        '<div class="hint-line">' + snapSummary(b, type) + '</div>' +
        '<button class="btn btn-primary" id="goAudit">התחל ביקורת</button>' : '<p class="muted">בחר סניף כדי להמשיך.</p>'));
    document.querySelectorAll('#brChips .chip').forEach(function (c) { c.onclick = function () { pickBranch(type, c.dataset.b); }; });
    document.querySelectorAll('#shChips .chip').forEach(function (c) {
      c.onclick = function () { document.querySelectorAll('#shChips .chip').forEach(function (x) { x.classList.toggle('on', x === c); }); };
    });
    var g = $('goAudit'); if (g) g.onclick = function () {
      var sh = document.querySelector('#shChips .chip.on');
      var mgr = $('mgrIn').value.trim(); lsSet(key('lastmgr-' + bid), mgr);
      startAudit(type, bid, sh ? sh.dataset.s : '', mgr);
    };
  }
  function guessShift(shifts) { if (shifts.length < 2) return 0; return new Date().getHours() >= 16 ? shifts.length - 1 : 0; }
  function snapSummary(b, type) {
    var s = buildSnap(b, type), n = 0, c = 0;
    s.depts.forEach(function (d) { n += d.items.length; d.items.forEach(function (i) { if (i.critical) c++; }); });
    return s.depts.length + ' מחלקות · ' + n + ' סעיפים · ' + c + ' קריטיים';
  }
  function startAudit(type, bid, shift, mgr) {
    var b = branch(bid);
    var row = {
      id: uuid(), branch_id: bid, created_by: uid(), type: type, status: 'draft',
      started_at: new Date().toISOString(), not_representative: false, partial_reason: null, finished_at: null,
      dept_snap: buildSnap(b, type),
      data: { shift: shift, manager: mgr, auditor: J.displayName(), items: {}, depts: {}, defect_check: {}, open_defects: [], summary: '', highlight: '' }
    };
    // open long-term defects of this branch, as a checklist at the start
    var cached = lsGet(key('defcache-' + bid), []);
    var go = function (list) {
      row.data.open_defects = list.map(function (d) { return { id: d.id, text: d.text, owner: d.owner || '', due_date: d.due_date || null }; });
      save(row);
      J.closeSheet(); J.go('audit', row.id);
    };
    if (!navigator.onLine) { go(cached); return; }
    sb.from('long_term_defects').select('id,text,owner,due_date').eq('branch_id', bid).eq('status', 'open').order('created_at').then(function (r) {
      if (r.error) { go(cached); return; }
      lsSet(key('defcache-' + bid), r.data || []); go(r.data || []);
    }, function () { go(cached); });
  }

  // ---------- load an audit (phone first, then cloud) ----------
  function getAudit(id) {
    var e = local()[id];
    if (e) return Promise.resolve(e.row);
    return sb.from('audits').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (r.error || !r.data) return null;
      return r.data;
    });
  }

  // ---------- the form ----------
  var F = null; // { row, dept: index (-1 = defects step) }
  function viewAudit(m, id) {
    m.innerHTML = '<div class="loading"><span class="spin"></span></div>';
    getAudit(id).then(function (row) {
      if (!row) { m.innerHTML = J.emptyBox('🔍', 'הביקורת לא נמצאה', 'אולי נמחקה, או שאין חיבור לרשת.', 'חזרה לבית', 'backHome'); $('backHome').onclick = function () { J.go('home'); }; return; }
      if (row.status !== 'draft') { J.go('report', id); return; }
      if (row.created_by !== uid()) { J.go('report', id); return; }
      var e = local()[id]; if (!e) { var mm = local(); mm[id] = { row: row, rev: 0, dirty: false }; setLocal(mm); }
      var startAt = (row.data.open_defects || []).length && !row.data.defects_seen ? -1 : (row.data.last_dept || 0);
      F = { row: row, dept: startAt };
      renderForm();
    });
  }
  function depts() { return F.row.dept_snap.depts; }
  function rec(itemId) { var it = F.row.data.items; return it[itemId] || (it[itemId] = {}); }
  function deptDone(d, res) { var x = res.depts[d.id]; return x && x.answered === x.total; }

  function renderForm() {
    var m = main(); if (!m) return;
    var row = F.row, b = branch(row.branch_id), res = compute(row);
    var hasDef = (row.data.open_defects || []).length > 0;
    var pct = res.total ? Math.round(res.answered / res.total * 100) : 0;
    var strip = (hasDef ? '<button class="dchip' + (F.dept === -1 ? ' on' : '') + '" data-d="-1"><span>🔁</span><b>ליקויים</b><small>' + defDoneCount() + '/' + row.data.open_defects.length + '</small></button>' : '') +
      depts().map(function (d, i) {
        var x = res.depts[d.id] || {};
        var cls = 'dchip' + (i === F.dept ? ' on' : '') + (x.answered === x.total ? ' done' : '') + (x.bad ? ' has-bad' : '');
        return '<button class="' + cls + '" data-d="' + i + '"><span>' + esc(d.icon || '•') + '</span><b>' + esc(d.name) + '</b><small>' + (x.answered === x.total ? '✓' : x.answered + '/' + x.total) + '</small></button>';
      }).join('');
    m.innerHTML =
      '<div class="fhead">' +
      '<button class="icon-btn" id="fBack" aria-label="חזרה לבית">→</button>' +
      '<div class="ft"><b>' + esc(J.TYPE_NAMES[row.type]) + ' · ' + esc(b ? b.name : '') + '</b><small><span id="saveState">' + (pendingCount() ? (navigator.onLine ? 'שולח…' : '📱 נשמר בטלפון') : '☁️ נשמר') + '</span> · ' + res.answered + '/' + res.total + '</small></div>' +
      '<button class="btn btn-sm" id="fFinish">סיום</button></div>' +
      '<div class="prog" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
      '<div class="dstrip" id="dstrip">' + strip + '</div>' +
      '<div id="fbody"></div>';
    $('fBack').onclick = function () { J.go('home'); };
    $('fFinish').onclick = openFinish;
    document.querySelectorAll('.dchip').forEach(function (c) { c.onclick = function () { setDept(Number(c.dataset.d)); }; });
    var on = document.querySelector('.dchip.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
    renderBody();
  }
  function setDept(i) {
    F.dept = i;
    if (i >= 0) { F.row.data.last_dept = i; }
    renderForm(); window.scrollTo(0, 0);
  }
  function refreshChrome() {
    // light refresh without redrawing the open department
    var res = compute(F.row);
    var pct = res.total ? Math.round(res.answered / res.total * 100) : 0;
    var p = document.querySelector('.prog i'); if (p) p.style.width = pct + '%';
    var sm = document.querySelector('.fhead small'); if (sm) sm.innerHTML = '<span id="saveState">' + (pendingCount() ? (navigator.onLine ? 'שולח…' : '📱 נשמר בטלפון') : '☁️ נשמר') + '</span> · ' + res.answered + '/' + res.total;
    depts().forEach(function (d, i) {
      var c = document.querySelector('.dchip[data-d="' + i + '"]'); if (!c) return;
      var x = res.depts[d.id];
      c.classList.toggle('done', x.answered === x.total); c.classList.toggle('has-bad', x.bad > 0);
      c.querySelector('small').textContent = x.answered === x.total ? '✓' : x.answered + '/' + x.total;
    });
    var hs = $('deptScore'); if (hs && F.dept >= 0) hs.innerHTML = deptScoreHtml(res.depts[depts()[F.dept].id]);
    var dc = document.querySelector('.dchip[data-d="-1"] small'); if (dc) dc.textContent = defDoneCount() + '/' + F.row.data.open_defects.length;
  }
  function deptScoreHtml(x) {
    if (!x || x.score == null) return '<span class="score-chip none">–</span>';
    return '<span class="score-chip t-' + tone(x.score) + '">' + fmt1(x.score) + (x.critFail ? ' ⚠️' : '') + '</span>';
  }
  function defDoneCount() { var c = F.row.data.defect_check || {}; return (F.row.data.open_defects || []).filter(function (d) { return c[d.id]; }).length; }

  function renderBody() {
    var el = $('fbody');
    if (F.dept === -1) { renderDefectStep(el); return; }
    var d = depts()[F.dept]; if (!d) { F.dept = 0; d = depts()[0]; }
    var res = compute(F.row);
    var note = (F.row.data.depts[d.id] || {}).note || '';
    el.innerHTML = '<div class="dhead"><h2>' + esc(d.icon || '') + ' ' + esc(d.name) + '</h2><span id="deptScore">' + deptScoreHtml(res.depts[d.id]) + '</span></div>' +
      '<button class="btn btn-soft" id="allOk">✓ הכל תקין במחלקה</button>' +
      '<div class="items">' + d.items.map(itemHtml).join('') + '</div>' +
      '<label class="field"><span>הערה למחלקה</span><textarea class="input ta" id="deptNote" rows="2" placeholder="לא חובה">' + esc(note) + '</textarea></label>' +
      '<div class="fnav">' +
      (F.dept > 0 || (F.row.data.open_defects || []).length ? '<button class="btn btn-line" id="prevD">→ הקודמת</button>' : '<span></span>') +
      (F.dept < depts().length - 1 ? '<button class="btn btn-primary" id="nextD">הבאה ←</button>' : '<button class="btn btn-primary" id="endD">סיום הביקורת</button>') +
      '</div>';
    $('allOk').onclick = function () {
      var n = 0;
      d.items.forEach(function (it) { if (it.kind === 'check' && !itemResult(it, F.row.data.items[it.id])) { rec(it.id).r = 'ok'; n++; } });
      if (!n) { toast('כל הסעיפים כבר סומנו'); return; }
      save(F.row); renderBody(); refreshChrome();
      var temps = d.items.filter(function (it) { return it.kind === 'temp' && !itemResult(it, F.row.data.items[it.id]); }).length;
      toast(n + ' סומנו תקין' + (temps ? ' · נשארו ' + temps + ' מדידות טמפרטורה' : ''));
    };
    $('deptNote').onchange = function () { (F.row.data.depts[d.id] = F.row.data.depts[d.id] || {}).note = this.value.trim(); save(F.row); };
    var pv = $('prevD'); if (pv) pv.onclick = function () { setDept(F.dept > 0 ? F.dept - 1 : -1); };
    var nx = $('nextD'); if (nx) nx.onclick = function () { setDept(F.dept + 1); };
    var en = $('endD'); if (en) en.onclick = openFinish;
    bindItems(el, d);
    loadThumbs(el);
  }
  function itemHtml(it) {
    var r = F.row.data.items[it.id] || {}, res = itemResult(it, r);
    var badge = it.critical ? '<span class="crit">קריטי</span>' : '';
    var ctl;
    if (it.kind === 'temp') {
      var lim = it.max != null ? 'עד ' + it.max + '°' : it.min != null ? 'מעל ' + it.min + '°' : '';
      ctl = '<div class="temp"><input class="input tin" type="text" inputmode="decimal" data-temp="' + it.id + '" value="' + esc(r.r === 'na' ? '' : (r.v == null ? '' : r.v)) + '" placeholder="°" aria-label="טמפרטורה שנמדדה"><span class="lim">' + lim + '</span>' +
        '<button class="seg na' + (res === 'na' ? ' on' : '') + '" data-na="' + it.id + '" aria-pressed="' + (res === 'na') + '">לא רלוונטי</button></div>';
    } else {
      ctl = '<div class="segs">' +
        '<button class="seg ok' + (res === 'ok' ? ' on' : '') + '" data-set="ok" data-id="' + it.id + '" aria-pressed="' + (res === 'ok') + '">✓ תקין</button>' +
        '<button class="seg bad' + (res === 'bad' ? ' on' : '') + '" data-set="bad" data-id="' + it.id + '" aria-pressed="' + (res === 'bad') + '">✗ לא תקין</button>' +
        '<button class="seg na' + (res === 'na' ? ' on' : '') + '" data-set="na" data-id="' + it.id + '" aria-pressed="' + (res === 'na') + '">לא רלוונטי</button></div>';
    }
    var flag = r.flag;
    var extra = '';
    if (res === 'bad') {
      extra = '<div class="badbox">' +
        (flag ? '<div class="flagline">🚩 <b>' + esc(flag.text) + '</b>' + (flag.owner ? ' · ' + esc(flag.owner) : '') +
          '<span class="pill ' + (flag.long ? 'pill-warn' : 'pill-ok') + '">' + (flag.long ? '⏳ ארוך טווח' : '✔️ טופל במקום') + '</span></div>' : '') +
        '<div class="row2"><button class="btn btn-line btn-sm" data-flag="' + it.id + '">' + (flag ? '✏️ ערוך דגל' : '🚩 דגל: מה לתקן') + '</button></div></div>';
    }
    var photos = (r.photos || []).map(function (p) { return '<img class="thumb" data-path="' + esc(p) + '" alt="תמונה">'; }).join('');
    return '<div class="it' + (res ? ' ans ' + res : '') + '" id="it-' + it.id + '"><div class="il"><span>' + esc(it.label) + '</span>' + badge + '</div>' + ctl +
      '<div class="iact"><label class="cam" aria-label="צילום">📷<input type="file" accept="image/*" capture="environment" data-photo="' + it.id + '" hidden></label>' +
      '<div class="thumbs">' + photos + '</div></div>' + extra + '</div>';
  }
  function redrawItem(it) {
    var el = $('it-' + it.id); if (!el || !el.parentNode) return;
    var tmp = document.createElement('div'); tmp.innerHTML = itemHtml(it);
    var n = tmp.firstChild; el.replaceWith(n);
    bindItems(n, depts()[F.dept]); loadThumbs(n);
  }
  function bindItems(root, d) {
    var find = function (id) { return d.items.find(function (x) { return x.id === id; }); };
    root.querySelectorAll('[data-set]').forEach(function (b) {
      b.onclick = function () {
        var it = find(b.dataset.id), r = rec(it.id);
        r.r = r.r === b.dataset.set ? null : b.dataset.set; // tap again to clear
        if (r.r !== 'bad' && r.flag && !r.flag.long) delete r.flag;
        save(F.row); redrawItem(it); refreshChrome();
        if (r.r === 'bad' && !r.flag) openFlag(it);
      };
    });
    root.querySelectorAll('[data-temp]').forEach(function (inp) {
      var it = find(inp.dataset.temp);
      inp.oninput = function () { inp.value = inp.value.replace(/[^\d.\-]/g, ''); };
      inp.onchange = function () {
        if (!F || !inp.isConnected) return;
        var r = rec(it.id), v = inp.value.trim();
        if (String(r.v == null ? '' : r.v) === v && r.r !== 'na') return;
        if (v === '' || isNaN(Number(v))) { delete r.v; if (r.r !== 'na') r.r = null; } else { r.v = Number(v); r.r = null; }
        save(F.row); refreshChrome();
        setTimeout(function () { if (!F) return; redrawItem(it); if (itemResult(it, r) === 'bad') { toast('חריגה מהסף: ' + v + '°'); if (!r.flag) openFlag(it); } }, 0);
      };
    });
    root.querySelectorAll('[data-na]').forEach(function (b) {
      b.onclick = function () { var it = find(b.dataset.na), r = rec(it.id); r.r = r.r === 'na' ? null : 'na'; if (r.r === 'na') delete r.v; save(F.row); redrawItem(it); refreshChrome(); };
    });
    root.querySelectorAll('[data-flag]').forEach(function (b) { b.onclick = function () { openFlag(find(b.dataset.flag)); }; });
    root.querySelectorAll('[data-photo]').forEach(function (inp) {
      inp.onchange = function () { if (inp.files && inp.files[0]) addPhoto(find(inp.dataset.photo), inp.files[0]); inp.value = ''; };
    });
    root.querySelectorAll('.thumb').forEach(function (t) { t.onclick = function () { viewPhoto(t.dataset.path, true); }; });
  }

  // ---------- flags ----------
  function openFlag(it) {
    var r = rec(it.id), f = r.flag || { text: it.label, owner: '', long: false };
    var locked = !!f.defect_id;
    J.sheet('<h3>🚩 דגל על סעיף</h3><p class="muted">' + esc(it.label) + '</p>' +
      '<label class="field"><span>מה צריך לתקן</span><textarea class="input ta" id="flText" rows="2">' + esc(f.text) + '</textarea></label>' +
      '<label class="field"><span>אחראי</span><input class="input" id="flOwner" value="' + esc(f.owner) + '" placeholder="לא חובה, למשל: מנהל המשמרת"></label>' +
      (locked ? '<div class="notice">⏳ הועבר לליקויים ארוכי טווח. הסגירה נעשית שם.</div>' :
        '<div class="hint-line">ברירת המחדל: טופל במקום.</div>') +
      '<div class="stack">' +
      '<button class="btn btn-primary" id="flSave">' + (locked ? 'שמור' : '✔️ טופל במקום') + '</button>' +
      (locked ? '' : '<button class="btn btn-line" id="flLong">⏳ העבר לארוך טווח</button>') +
      (r.flag && !locked ? '<button class="btn btn-ghost" id="flDel">הסר דגל</button>' : '') + '</div>');
    var t = $('flText'); setTimeout(function () { t.focus(); t.select(); }, 60);
    function read() { var x = t.value.trim(); if (!x) { toast('כתוב מה צריך לתקן'); t.focus(); return null; } return { text: x, owner: $('flOwner').value.trim() }; }
    $('flSave').onclick = function () {
      var v = read(); if (!v) return;
      r.flag = Object.assign(f, v); save(F.row); J.closeSheet(); redrawItem(it);
      if (f.defect_id) queueDefect({ op: 'update', id: f.defect_id, row: { text: v.text, owner: v.owner || null } });
    };
    var lg = $('flLong'); if (lg) lg.onclick = function () {
      var v = read(); if (!v) return;
      var d = depts()[F.dept];
      var id = uuid();
      r.flag = { text: v.text, owner: v.owner, long: true, defect_id: id };
      save(F.row); // the audit goes to the cloud before the defect that points to it
      queueDefect({ op: 'insert', id: id, row: { id: id, branch_id: F.row.branch_id, text: v.text, owner: v.owner || null, category: d ? d.name : null, source_audit_id: F.row.id, created_by: uid(), note: it.label } });
      J.closeSheet(); redrawItem(it); toast('נוסף לליקויים ארוכי טווח');
    };
    var dl = $('flDel'); if (dl) dl.onclick = function () { delete r.flag; save(F.row); J.closeSheet(); redrawItem(it); };
  }
  function queueDefect(op) {
    op.k = uuid();
    var q = defq();
    // merge updates of the same defect
    if (op.op === 'update') {
      var ins = q.find(function (x) { return x.op === 'insert' && x.id === op.id; });
      if (ins) { Object.assign(ins.row, op.row); setDefq(q); syncBadge(); clearTimeout(saveT); saveT = setTimeout(sync, 400); return; }
    }
    q.push(op); setDefq(q); syncBadge();
    clearTimeout(saveT); saveT = setTimeout(sync, 400);
  }

  // ---------- defects checklist at the start of the audit ----------
  function renderDefectStep(el) {
    var list = F.row.data.open_defects || [], c = F.row.data.defect_check || (F.row.data.defect_check = {});
    el.innerHTML = '<div class="dhead"><h2>🔁 ליקויים פתוחים בסניף</h2></div>' +
      '<p class="muted">לפני שמתחילים: מה מהרשימה עדיין פתוח?</p>' +
      '<div class="items">' + list.map(function (d) {
        var v = c[d.id];
        return '<div class="it' + (v ? ' ans ' + (v === 'done' ? 'ok' : 'bad') : '') + '"><div class="il"><span>' + esc(d.text) + '</span>' +
          (d.due_date && d.due_date < today() ? '<span class="crit">באיחור</span>' : '') + '</div>' +
          (d.owner ? '<small class="muted">אחראי: ' + esc(d.owner) + '</small>' : '') +
          '<div class="segs two"><button class="seg bad' + (v === 'open' ? ' on' : '') + '" data-dc="' + d.id + '" data-v="open">עדיין פתוח</button>' +
          '<button class="seg ok' + (v === 'done' ? ' on' : '') + '" data-dc="' + d.id + '" data-v="done">✓ טופל</button></div></div>';
      }).join('') + '</div>' +
      '<div class="fnav"><span></span><button class="btn btn-primary" id="defNext">לביקורת ←</button></div>';
    el.querySelectorAll('[data-dc]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.dc, v = b.dataset.v, was = c[id];
        c[id] = was === v ? null : v;
        save(F.row);
        if (c[id] === 'done') queueDefect({ op: 'update', id: id, row: { status: 'done' } });
        else if (was === 'done') toast('הליקוי כבר סומן כטופל. פתיחה מחדש: רק מנהל-על, ממסך הליקויים.');
        renderDefectStep(el); refreshChrome();
      };
    });
    $('defNext').onclick = function () { F.row.data.defects_seen = true; save(F.row); setDept(0); };
  }

  // ---------- photos ----------
  function compress(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1280, w = img.naturalWidth, hh = img.naturalHeight, k = Math.min(1, max / Math.max(w, hh));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', 0.72);
      };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('img')); };
      img.src = u;
    });
  }
  function addPhoto(it, file) {
    toast('מכווץ תמונה…');
    compress(file).then(function (blob) {
      var path = F.row.branch_id + '/' + F.row.id + '/' + it.id + '-' + Date.now() + '.jpg';
      return idbPut(path, blob).then(function () {
        var q = photoq(); q.push(path); setPhotoq(q);
        var r = rec(it.id); (r.photos = r.photos || []).push(path);
        save(F.row); redrawItem(it); toast('התמונה נשמרה');
      });
    }).catch(function () { toast('לא הצלחנו לשמור את התמונה. נסה שוב.'); });
  }
  var urlCache = {};
  function photoUrl(path) {
    if (urlCache[path]) return Promise.resolve(urlCache[path]);
    return idbGet(path).then(function (blob) {
      if (blob) return (urlCache[path] = URL.createObjectURL(blob));
      if (!navigator.onLine) return null;
      return sb.storage.from('photos').createSignedUrl(path, 3600).then(function (r) { return r.data ? (urlCache[path] = r.data.signedUrl) : null; });
    }).catch(function () { return null; });
  }
  function loadThumbs(root) {
    root.querySelectorAll('img[data-path]').forEach(function (img) {
      photoUrl(img.dataset.path).then(function (u) { if (u) img.src = u; else img.classList.add('missing'); });
    });
  }
  function viewPhoto(path, canDelete) {
    photoUrl(path).then(function (u) {
      J.sheet('<div class="photo-full">' + (u ? '<img src="' + esc(u) + '" alt="תמונה">' : '<p class="muted">התמונה לא זמינה כרגע.</p>') + '</div>' +
        (canDelete && F ? '<button class="btn btn-ghost" id="phDel">🗑️ הסר תמונה</button>' : ''));
      var d = $('phDel'); if (d) d.onclick = function () {
        Object.keys(F.row.data.items).forEach(function (k) {
          var r = F.row.data.items[k]; if (r.photos) r.photos = r.photos.filter(function (p) { return p !== path; });
        });
        setPhotoq(photoq().filter(function (p) { return p !== path; })); idbDel(path);
        save(F.row); J.closeSheet(); renderBody();
      };
    });
  }

  // ---------- finish ----------
  function openFinish() {
    var row = F.row, res = compute(row), missing = res.total - res.answered;
    J.sheet('<h3>סיום הביקורת</h3>' +
      '<div class="bigscore t-' + tone(res.overall) + '"><b>' + fmt1(res.overall) + '</b><span>נבדק ' + Math.round(res.coverage) + '%</span></div>' +
      (missing ? '<div class="notice">' + missing + ' סעיפים עוד לא נבדקו.</div>' : '<div class="notice ok">כל הסעיפים נבדקו 👏</div>') +
      '<label class="field"><span>💪 מה היה טוב</span><input class="input" id="fHi" value="' + esc(row.data.highlight || '') + '" placeholder="לא חובה"></label>' +
      '<label class="field"><span>📝 סיכום קצר</span><textarea class="input ta" id="fSum" rows="2" placeholder="לא חובה">' + esc(row.data.summary || '') + '</textarea></label>' +
      '<div class="stack"><button class="btn btn-primary" id="fDone">💾 סיים ושמור</button>' +
      '<button class="btn btn-line" id="fPart">⏹️ סגור בלי להשלים</button>' +
      '<button class="btn btn-ghost" id="fCont">המשך לבדוק</button></div>');
    function keep() { row.data.highlight = $('fHi').value.trim(); row.data.summary = $('fSum').value.trim(); }
    $('fCont').onclick = function () { keep(); save(row); J.closeSheet(); };
    $('fDone').onclick = function () { keep(); if (missing) { openPartial(true); return; } finish('done', null); };
    $('fPart').onclick = function () { keep(); openPartial(false); };
  }
  function openPartial(fromDone) {
    var res = compute(F.row);
    var critNames = res.crit_unchecked.map(function (id) {
      var it = null; depts().some(function (d) { it = d.items.find(function (x) { return x.id === id; }); return !!it; });
      return it ? it.label : id;
    });
    J.sheet('<h3>⏹️ סגירה חלקית</h3>' +
      (fromDone ? '<p class="muted">נשארו ' + (res.total - res.answered) + ' סעיפים שלא נבדקו, אז הביקורת תישמר כחלקית.</p>' : '') +
      (critNames.length ? '<div class="notice bad"><b>⚠️ ' + critNames.length + ' סעיפים קריטיים לא נבדקו:</b><ul>' + critNames.slice(0, 8).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + (critNames.length > 8 ? '<li>ועוד ' + (critNames.length - 8) + '</li>' : '') + '</ul></div>' : '') +
      (res.coverage < minCov() ? '<div class="notice">נבדק ' + Math.round(res.coverage) + '%, פחות מ-' + minCov() + '%. הביקורת תסומן "לא מייצגת" ולא תיכנס לממוצעים.</div>' : '') +
      '<div class="lbl">למה סוגרים?</div><div class="chips" id="rsn">' + REASONS.map(function (r) { return '<button class="chip" data-r="' + r + '">' + r + '</button>'; }).join('') + '</div>' +
      '<div class="stack"><button class="btn btn-ghost" id="pBack">חזרה לביקורת</button></div>');
    document.querySelectorAll('#rsn .chip').forEach(function (c) { c.onclick = function () { finish('partial', c.dataset.r); }; });
    $('pBack').onclick = J.closeSheet;
  }
  function finish(status, reason) {
    var row = F.row, res = compute(row);
    row.status = status;
    row.partial_reason = reason;
    row.not_representative = res.not_representative;
    row.finished_at = new Date().toISOString();
    // dept_snap was taken when the audit started: names, weights and items as they were. It never changes after.
    save(row);
    J.closeSheet(); F = null;
    toast(status === 'done' ? 'הביקורת נשמרה' : 'נשמרה כביקורת חלקית');
    J.go('report', row.id);
  }

  // ---------- drafts ----------
  function deleteDraft(id) {
    var m = local(); var e = m[id];
    delete m[id]; setLocal(m);
    // photos of this draft that never left the phone
    setPhotoq(photoq().filter(function (p) { if (p.indexOf('/' + id + '/') > 0) { idbDel(p); return false; } return true; }));
    if (!navigator.onLine) { toast('הטיוטה נמחקה מהטלפון'); return Promise.resolve(); }
    return sb.from('audits').delete().eq('id', id).eq('status', 'draft').then(function () { toast('הטיוטה נמחקה'); });
  }
  function draftCard(a) {
    var res = a.dept_snap ? compute(a) : { answered: 0, total: 0 };
    var pct = res.total ? Math.round(res.answered / res.total * 100) : 0;
    var old = Date.now() - new Date(a.started_at).getTime() > 7 * DAY;
    var e = local()[a.id];
    return '<div class="dcard' + (old ? ' old' : '') + '"><button class="dmain" data-cont="' + a.id + '">' +
      '<div class="t"><b>' + esc(J.TYPE_NAMES[a.type]) + ' · ' + esc(J.branchName(a.branch_id)) + '</b>' +
      '<small>התחילה ' + dm(a.started_at) + ' ב-' + hm(a.started_at) + ' · ' + res.answered + '/' + res.total + (e && e.dirty ? ' · 📱 ממתין לשליחה' : '') + '</small></div>' +
      '<span class="go">המשך ←</span></button>' +
      '<div class="prog"><i style="width:' + pct + '%"></i></div>' +
      (old ? '<div class="remind">⏰ פתוחה יותר משבוע. להשלים, לסגור חלקית או למחוק?' +
        '<div class="row3"><button class="btn btn-sm" data-cont="' + a.id + '">השלם</button><button class="btn btn-sm btn-line" data-part="' + a.id + '">סגור חלקית</button><button class="btn btn-sm btn-ghost" data-del="' + a.id + '">מחק</button></div></div>'
        : '<button class="mini-del" data-del="' + a.id + '" aria-label="מחק טיוטה">🗑️</button>') +
      '</div>';
  }

  // ---------- home ----------
  function home(m) {
    m.innerHTML = '<h2 class="page">שלום ' + esc(J.displayName()) + '</h2>' +
      '<div class="stat-row"><div class="stat"><div class="n gold" id="stDraft">–</div><div class="l">ביקורות בעבודה</div></div>' +
      '<button class="stat tap" id="stDefBtn"><div class="n" id="stDef">–</div><div class="l" id="stDefL">ליקויים פתוחים</div></button></div>' +
      '<h3 class="sec">ביקורות בעבודה</h3><div id="drafts" class="list"></div>' +
      '<h3 class="sec">ליקויים ארוכי טווח <button class="link" id="allDef">לכל הרשימה</button></h3><div id="defects"></div>' +
      '<h3 class="sec">ביקורות אחרונות</h3><div id="recent"></div>';
    $('stDefBtn').onclick = $('allDef').onclick = function () { J.go('defects'); };
    // drafts: phone first, then cloud
    var shown = {};
    function drawDrafts(cloud) {
      var m2 = local(), rows = [];
      Object.keys(m2).forEach(function (k) { var r = m2[k].row; if (r && r.status === 'draft' && r.created_by === uid()) { rows.push(r); shown[k] = 1; } });
      (cloud || []).forEach(function (r) { if (!shown[r.id]) { rows.push(r); shown[r.id] = 1; } });
      rows.sort(function (a, b) { return b.started_at < a.started_at ? -1 : 1; });
      var el = $('drafts'); if (!el) return;
      $('stDraft').textContent = rows.length;
      el.innerHTML = rows.length ? rows.map(draftCard).join('') : J.emptyBox('📝', 'אין ביקורת פתוחה', 'ביקורת שהתחלת ועצרת תחכה כאן, ותמשיך מאותו מקום.', 'התחל ביקורת', 'emptyNew');
      var b = $('emptyNew'); if (b) b.onclick = openNew;
      el.querySelectorAll('[data-cont]').forEach(function (x) { x.onclick = function () { J.go('audit', x.dataset.cont); }; });
      el.querySelectorAll('[data-del]').forEach(function (x) {
        x.onclick = function () {
          J.sheet('<h3>למחוק את הטיוטה?</h3><p class="muted">כל מה שסומן בה יימחק, ואי אפשר לשחזר.</p><div class="stack"><button class="btn btn-danger" id="yDel">🗑️ מחק טיוטה</button><button class="btn btn-ghost" id="nDel">ביטול</button></div>');
          $('nDel').onclick = J.closeSheet;
          $('yDel').onclick = function () { J.closeSheet(); deleteDraft(x.dataset.del).then(function () { home(main()); }); };
        };
      });
      el.querySelectorAll('[data-part]').forEach(function (x) {
        x.onclick = function () {
          getAudit(x.dataset.part).then(function (row) { if (!row) return; F = { row: row, dept: 0 }; openPartial(false); });
        };
      });
    }
    drawDrafts([]);
    if (navigator.onLine) sb.from('audits').select('id,type,branch_id,started_at,status,created_by,dept_snap,data').eq('status', 'draft').eq('created_by', uid()).then(function (r) {
      if (r.error) return;
      // keep a phone copy of cloud drafts so they open without signal
      var m2 = local(), ch = false;
      (r.data || []).forEach(function (row) { if (!m2[row.id]) { m2[row.id] = { row: row, rev: 0, dirty: false }; ch = true; } });
      if (ch) setLocal(m2);
      drawDrafts(r.data);
    });
    homeDefects();
    sb.from('audits').select('id,type,branch_id,started_at,status,coverage,not_representative,result').neq('status', 'draft').order('started_at', { ascending: false }).limit(5).then(function (r) {
      var el = $('recent'); if (!el) return;
      var rows = r.data || [];
      el.innerHTML = rows.length ? J.list(rows) : J.emptyBox('🗂️', 'עוד אין ביקורות שמורות', 'כשתסיים ביקורת ראשונה, היא תופיע כאן עם הציון.', '', '');
      bindOpen(el);
    }, function () { var el = $('recent'); if (el) el.innerHTML = J.emptyBox('📡', 'אין חיבור', 'הביקורות האחרונות יופיעו כשתחזור הקליטה.', '', ''); });
  }
  function homeDefects() {
    sb.from('long_term_defects').select('id,text,due_date,branch_id').eq('status', 'open').order('created_at', { ascending: false }).then(function (r) {
      var el = $('defects'); if (!el || r.error) return;
      var rows = r.data || [], t = today();
      var late = rows.filter(function (d) { return d.due_date && d.due_date < t; }).length;
      $('stDef').textContent = rows.length;
      $('stDefL').textContent = late ? 'פתוחים · ' + late + ' באיחור' : 'ליקויים פתוחים';
      el.innerHTML = rows.length ? '<button class="item tap" id="defSum"><div class="t"><b>' + rows.length + ' פתוחים' + (late ? ' · <span class="bad-t">' + late + ' באיחור</span>' : '') + '</b><small>' +
        esc(rows.slice(0, 2).map(function (d) { return d.text; }).join(' · ')) + '</small></div><span class="go">←</span></button>'
        : J.emptyBox('✅', 'אין ליקויים פתוחים', 'ליקוי שצריך זמן לתקן יופיע כאן, עד שמישהו בסניף יסמן שטופל.', '', '');
      var s = $('defSum'); if (s) s.onclick = function () { J.go('defects'); };
    });
  }
  function bindOpen(el) {
    el.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { J.go('report', b.dataset.open); }; });
  }
  function scorePill(a) {
    if (a.status === 'draft') return '<span class="pill">בעבודה</span>';
    var s = a.result && a.result.overall;
    return '<span class="pills">' + (a.status === 'partial' ? '<span class="pill pill-warn">חלקית</span>' : '') +
      (a.not_representative ? '<span class="pill">לא מייצגת</span>' : '') +
      '<span class="score-chip t-' + tone(s) + '">' + fmt1(s) + '</span></span>';
  }

  // ---------- saved audit: view only ----------
  function viewReport(m, id) {
    m.innerHTML = '<div class="loading"><span class="spin"></span></div>';
    getAudit(id).then(function (a) {
      if (!a) { m.innerHTML = J.emptyBox('🔍', 'הביקורת לא נמצאה', 'אולי אין לך הרשאה אליה, או שאין חיבור לרשת.', 'חזרה לבית', 'backHome'); $('backHome').onclick = function () { J.go('home'); }; return; }
      if (a.status === 'draft' && a.created_by === uid()) { J.go('audit', id); return; }
      renderReport(m, a);
    });
  }
  function renderReport(m, a) {
    var snap = a.dept_snap || { depts: [] }, res = a.result || compute(a), items = (a.data && a.data.items) || {};
    var s = res.overall, d = a.data || {};
    var flags = [];
    snap.depts.forEach(function (dp) { dp.items.forEach(function (it) { var r = items[it.id]; if (r && r.flag) flags.push({ dept: dp, it: it, f: r.flag }); }); });
    var photos = [];
    snap.depts.forEach(function (dp) { dp.items.forEach(function (it) { ((items[it.id] || {}).photos || []).forEach(function (p) { photos.push({ p: p, label: it.label }); }); }); });
    m.innerHTML = '<div class="fhead"><button class="icon-btn" id="rBack" aria-label="חזרה">→</button><div class="ft"><b>' + esc(J.TYPE_NAMES[a.type]) + ' · ' + esc(J.branchName(a.branch_id)) + '</b><small>' + dmy(a.started_at) + ' · ' + hm(a.started_at) + (d.shift ? ' · ' + esc(d.shift) : '') + '</small></div></div>' +
      '<div class="bigscore t-' + tone(s) + '"><b>' + fmt1(s) + '</b><span>נבדק ' + Math.round(res.coverage || 0) + '%</span></div>' +
      '<div class="tags">' + (a.status === 'partial' ? '<span class="pill pill-warn">⏹️ חלקית' + (a.partial_reason ? ' · ' + esc(a.partial_reason) : '') + '</span>' : '<span class="pill pill-ok">הושלמה</span>') +
      (a.not_representative ? '<span class="pill">לא מייצגת · לא נכנסת לממוצעים</span>' : '') + '</div>' +
      '<div class="kv card"><div>מבקר: <b>' + esc(d.auditor || '') + '</b></div>' + (d.manager ? '<div>מנהל משמרת: <b>' + esc(d.manager) + '</b></div>' : '') +
      (d.highlight ? '<div>💪 <b>' + esc(d.highlight) + '</b></div>' : '') + (d.summary ? '<div>📝 <b>' + esc(d.summary) + '</b></div>' : '') + '</div>' +
      '<div class="stack"><button class="btn btn-primary" id="waCopy">💬 העתק סיכום לוואטסאפ</button><a class="btn btn-line" id="waOpen" target="_blank" rel="noopener">פתח בוואטסאפ</a></div>' +
      '<h3 class="sec">מחלקות</h3><div class="list">' + snap.depts.map(function (dp) {
        var x = (res.depts || {})[dp.id] || {};
        var right = x.partial ? '<span class="pill">חלקית</span>' : '<span class="score-chip t-' + tone(x.score) + '">' + fmt1(x.score) + (x.critFail ? ' ⚠️' : '') + '</span>';
        var bads = dp.items.filter(function (it) { return itemResult(it, items[it.id]) === 'bad'; });
        var note = ((d.depts || {})[dp.id] || {}).note;
        return '<div class="item col"><div class="rowx"><div class="t"><b>' + esc(dp.icon || '') + ' ' + esc(dp.name) + '</b><small>' + (x.answered || 0) + '/' + (x.total || dp.items.length) + ' נבדקו</small></div>' + right + '</div>' +
          (bads.length ? '<ul class="bads">' + bads.map(function (it) { var r = items[it.id]; return '<li>✗ ' + esc(it.label) + (it.kind === 'temp' && r.v != null ? ' · ' + r.v + '°' : '') + (it.critical ? ' <span class="crit">קריטי</span>' : '') + '</li>'; }).join('') + '</ul>' : '') +
          (note ? '<p class="muted small">' + esc(note) + '</p>' : '') + '</div>';
      }).join('') + '</div>' +
      (flags.length ? '<h3 class="sec">🚩 דגלים (' + flags.length + ')</h3><div class="list">' + flags.map(function (x) {
        return '<div class="item"><div class="t"><b>' + esc(x.f.text) + '</b><small>' + esc(x.dept.name) + (x.f.owner ? ' · ' + esc(x.f.owner) : '') + '</small></div><span class="pill ' + (x.f.long ? 'pill-warn' : 'pill-ok') + '">' + (x.f.long ? '⏳ ארוך טווח' : '✔️ טופל במקום') + '</span></div>';
      }).join('') + '</div>' : '') +
      (Object.keys(res.not_checked || {}).length ? '<h3 class="sec">לא נבדק</h3><div class="list">' + snap.depts.filter(function (dp) { return (res.not_checked || {})[dp.id]; }).map(function (dp) {
        var ids = res.not_checked[dp.id];
        return '<details class="item col"><summary><b>' + esc(dp.icon || '') + ' ' + esc(dp.name) + '</b> · ' + ids.length + '</summary><ul class="bads">' +
          ids.map(function (id) { var it = dp.items.find(function (i) { return i.id === id; }); return '<li>' + esc(it ? it.label : id) + (it && it.critical ? ' <span class="crit">קריטי</span>' : '') + '</li>'; }).join('') + '</ul></details>';
      }).join('') + '</div>' : '') +
      (photos.length ? '<h3 class="sec">תמונות (' + photos.length + ')</h3><div class="pgrid">' + photos.map(function (x) { return '<figure><img class="thumb" data-path="' + esc(x.p) + '" alt="' + esc(x.label) + '"><figcaption>' + esc(x.label) + '</figcaption></figure>'; }).join('') + '</div>' : '') +
      '<p class="muted small center">צפייה בלבד. עריכה ומחיקה של ביקורת שמורה יגיעו בשלב 5.</p>';
    $('rBack').onclick = function () { J.go('home'); };
    var text = waText(a);
    $('waOpen').href = 'https://wa.me/?text=' + encodeURIComponent(text);
    $('waCopy').onclick = function () { copy(text); };
    loadThumbs(m);
    m.querySelectorAll('.thumb').forEach(function (t) { t.onclick = function () { F = null; viewPhoto(t.dataset.path, false); }; });
  }
  function copy(text) {
    var done = function () { toast('הסיכום הועתק. הדבק בוואטסאפ'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('ההעתקה נכשלה'); } t.remove(); }
  }
  // WhatsApp text, in the 1.5.1 wording
  function waText(a) {
    var snap = a.dept_snap || { depts: [] }, res = a.result || compute(a), d = a.data || {}, items = d.items || {}, c = colors();
    var s = res.overall;
    var L = [
      "🍺 *ג'מס · סיכום ביקורת" + (a.type === 'quick' ? ' בזק ⚡' : '') + '*',
      '📍 ' + J.branchName(a.branch_id),
      '🗓️ ' + dmy(a.started_at) + (d.shift ? ' · ' + d.shift : ''),
      '👤 מבקר: ' + (d.auditor || '') + (d.manager ? ' · מנהל משמרת: ' + d.manager : ''),
      '',
      '*ציון כולל: ' + fmt1(s) + '/10* ' + toneEmoji(s) + ' · נבדק ' + Math.round(res.coverage || 0) + '%'
    ];
    if (a.status === 'partial') L.push('⏹️ נסגרה חלקית' + (a.partial_reason ? ': ' + a.partial_reason : ''));
    if (a.not_representative) L.push('_לא מייצגת: נבדק פחות מ-' + minCov() + '%_');
    L.push('', '*מחלקות*');
    snap.depts.forEach(function (dp) {
      var x = (res.depts || {})[dp.id] || {}, note = ((d.depts || {})[dp.id] || {}).note;
      if (x.partial) { if (x.answered) L.push('⚪ ' + dp.name + ' · חלקית'); return; }
      if (x.score == null) return;
      L.push(toneEmoji(x.score) + ' ' + dp.name + ' ' + fmt1(x.score) + (x.critFail ? ' ⚠️' : '') + (note ? ' · ' + note : ''));
    });
    var flags = [];
    snap.depts.forEach(function (dp) { dp.items.forEach(function (it) { var r = items[it.id]; if (r && r.flag) flags.push(r.flag); }); });
    L.push('');
    if (flags.length) {
      L.push('*ליקויים לטיפול (' + flags.length + ')*');
      flags.forEach(function (f, i) { L.push((i + 1) + '. ' + f.text + (f.owner ? ' · ' + f.owner : '') + (f.long ? ' · ⏳ ארוך טווח' : ' · ✔️ טופל במקום')); });
    } else L.push('✅ אין ליקויים לטיפול');
    var fixed = Object.keys(d.defect_check || {}).filter(function (k) { return d.defect_check[k] === 'done'; }).length;
    var still = Object.keys(d.defect_check || {}).filter(function (k) { return d.defect_check[k] === 'open'; }).length;
    var rf = []; if (still) rf.push('🔁 עדיין פתוחים: ' + still); if (fixed) rf.push('✔️ תוקנו מהקודמת: ' + fixed);
    if (rf.length) L.push(rf.join(' · '));
    if (d.highlight || d.summary) L.push('');
    if (d.highlight) L.push('💪 ' + d.highlight);
    if (d.summary) L.push('📝 ' + d.summary);
    L.push('', '_🟢 ' + c.green + ' ומעלה תקין · 🟡 בין ' + c.yellow + ' ל-' + fmt1(c.green - 0.1) + ' טעון שיפור · 🔴 מתחת ל-' + c.yellow + ' דורש טיפול · ⚠️ כשל קריטי_');
    return L.join('\n');
  }

  // ---------- long-term defects ----------
  var defTab = 'open', defBranch = '';
  function viewDefects(m) {
    m.innerHTML = '<div class="fhead"><button class="icon-btn" id="dBack" aria-label="חזרה">→</button><div class="ft"><b>ליקויים ארוכי טווח</b><small>פתוח או טופל</small></div><button class="btn btn-sm" id="dNew">＋ ליקוי</button></div>' +
      '<div class="tabs"><button data-t="open" class="' + (defTab === 'open' ? 'on' : '') + '">פתוחים</button><button data-t="done" class="' + (defTab === 'done' ? 'on' : '') + '">נסגרו לאחרונה</button></div>' +
      (S.branches.length > 1 ? '<div class="chips" id="dBr"><button class="chip' + (!defBranch ? ' on' : '') + '" data-b="">כל הסניפים</button>' + S.branches.map(function (b) { return '<button class="chip' + (defBranch === b.id ? ' on' : '') + '" data-b="' + b.id + '">' + esc(b.name) + '</button>'; }).join('') + '</div>' : '') +
      '<div id="dList"><div class="loading"><span class="spin"></span></div></div>';
    $('dBack').onclick = function () { J.go('home'); };
    $('dNew').onclick = newDefect;
    m.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { defTab = b.dataset.t; viewDefects(m); }; });
    m.querySelectorAll('#dBr .chip').forEach(function (b) { b.onclick = function () { defBranch = b.dataset.b; viewDefects(m); }; });
    var q = sb.from('long_term_defects').select('*').eq('status', defTab);
    if (defBranch) q = q.eq('branch_id', defBranch);
    q = defTab === 'open' ? q.order('created_at', { ascending: false }) : q.order('closed_at', { ascending: false }).limit(30);
    q.then(function (r) {
      var el = $('dList'); if (!el) return;
      if (r.error) { el.innerHTML = J.emptyBox('📡', 'לא הצלחנו לטעון', 'בדוק חיבור לרשת ונסה שוב.', '', ''); return; }
      var rows = r.data || [], t = today();
      // changes still waiting on the phone
      var pend = {}; defq().forEach(function (o) { pend[o.id] = o; });
      if (!rows.length) { el.innerHTML = defTab === 'open' ? J.emptyBox('✅', 'אין ליקויים פתוחים', 'ליקוי נכנס לכאן מדגל בביקורת, או בכפתור ＋ ליקוי.', '', '') : J.emptyBox('🗂️', 'עוד לא נסגרו ליקויים', 'ליקוי שיסומן "טופל" יופיע כאן.', '', ''); return; }
      el.innerHTML = '<div class="list">' + rows.map(function (d) {
        var late = d.status === 'open' && d.due_date && d.due_date < t;
        var p = pend[d.id] && pend[d.id].row.status === 'done';
        return '<div class="item col' + (late ? ' late' : '') + '"><div class="rowx"><div class="t"><b>' + esc(d.text) + '</b><small>' + esc(J.branchName(d.branch_id)) +
          (d.category ? ' · ' + esc(d.category) : '') + (d.owner ? ' · ' + esc(d.owner) : '') + (d.due_date ? ' · יעד ' + dm(d.due_date) : '') + (late ? ' · <span class="bad-t">באיחור</span>' : '') +
          (d.status === 'done' && d.closed_at ? ' · נסגר ' + dm(d.closed_at) : '') + '</small></div>' +
          (d.status === 'open' ? (p ? '<span class="pill">📱 ממתין</span>' : '<button class="btn btn-sm" data-fix="' + d.id + '">✓ טופל</button>') :
            (J.isAdmin() ? '<button class="btn btn-sm btn-line" data-re="' + d.id + '">↺ פתח מחדש</button>' : '<span class="pill pill-ok">טופל</span>')) + '</div>' +
          ((d.photo_path || d.close_photo_path) ? '<div class="thumbs">' + [d.photo_path, d.close_photo_path].filter(Boolean).map(function (p) { return '<img class="thumb" data-path="' + esc(p) + '" alt="תמונה">'; }).join('') + '</div>' : '') +
          (d.source_audit_id ? '<button class="link" data-src="' + d.source_audit_id + '">מתוך ביקורת ←</button>' : '') + '</div>';
      }).join('') + '</div>';
      loadThumbs(el);
      el.querySelectorAll('.thumb').forEach(function (t2) { t2.onclick = function () { F = null; viewPhoto(t2.dataset.path, false); }; });
      el.querySelectorAll('[data-src]').forEach(function (b) { b.onclick = function () { J.go('report', b.dataset.src); }; });
      el.querySelectorAll('[data-fix]').forEach(function (b) { b.onclick = function () { closeDefect(rows.find(function (x) { return x.id === b.dataset.fix; })); }; });
      el.querySelectorAll('[data-re]').forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          sb.from('long_term_defects').update({ status: 'open', close_photo_path: null }).eq('id', b.dataset.re).then(function (r2) {
            if (r2.error) { b.disabled = false; toast('הפתיחה מחדש לא הצליחה'); return; }
            toast('הליקוי נפתח מחדש'); viewDefects(main());
          });
        };
      });
    });
  }
  function closeDefect(d) {
    var blob = null;
    J.sheet('<h3>✓ טופל</h3><p>' + esc(d.text) + '</p>' +
      '<label class="btn btn-line cam-wide">📷 צרף תמונה של התיקון (לא חובה)<input type="file" accept="image/*" capture="environment" id="cfPh" hidden></label>' +
      '<div id="cfPrev" class="thumbs"></div>' +
      '<div class="stack"><button class="btn btn-primary" id="cfOk">✓ סמן שטופל</button><button class="btn btn-ghost" id="cfNo">ביטול</button></div>');
    $('cfNo').onclick = J.closeSheet;
    $('cfPh').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      compress(f).then(function (b) { blob = b; $('cfPrev').innerHTML = '<img class="thumb" src="' + URL.createObjectURL(b) + '" alt="תמונת תיקון">'; });
    };
    $('cfOk').onclick = function () {
      var row = { status: 'done' };
      var p = Promise.resolve();
      if (blob) {
        var path = d.branch_id + '/defects/' + d.id + '-' + Date.now() + '.jpg';
        row.close_photo_path = path;
        p = idbPut(path, blob).then(function () { var q = photoq(); q.push(path); setPhotoq(q); });
      }
      p.then(function () {
        queueDefect({ op: 'update', id: d.id, row: row });
        J.closeSheet(); toast(navigator.onLine ? 'סומן שטופל' : 'נשמר בטלפון. יישלח כשתחזור הקליטה');
        setTimeout(function () { if (S.tab === 'defects') viewDefects(main()); }, navigator.onLine ? 1200 : 0);
      });
    };
  }
  function newDefect() {
    var bs = S.branches; var bid = defBranch || (bs.length === 1 ? bs[0].id : (bs[0] && bs[0].id));
    J.sheet('<h3>＋ ליקוי ארוך טווח</h3>' +
      (bs.length > 1 ? '<div class="lbl">סניף</div><div class="chips" id="ndBr">' + bs.map(function (b) { return '<button class="chip' + (b.id === bid ? ' on' : '') + '" data-b="' + b.id + '">' + esc(b.name) + '</button>'; }).join('') + '</div>' : '') +
      '<label class="field"><span>מה צריך לתקן</span><textarea class="input ta" id="ndText" rows="2"></textarea></label>' +
      '<label class="field"><span>אחראי</span><input class="input" id="ndOwner" placeholder="לא חובה"></label>' +
      '<label class="field"><span>תאריך יעד</span><input class="input" type="date" id="ndDue"></label>' +
      '<div class="stack"><button class="btn btn-primary" id="ndOk">הוסף ליקוי</button></div>');
    document.querySelectorAll('#ndBr .chip').forEach(function (c) { c.onclick = function () { bid = c.dataset.b; document.querySelectorAll('#ndBr .chip').forEach(function (x) { x.classList.toggle('on', x === c); }); }; });
    setTimeout(function () { $('ndText').focus(); }, 60);
    $('ndOk').onclick = function () {
      var t = $('ndText').value.trim(); if (!t) { toast('כתוב מה צריך לתקן'); return; }
      var id = uuid();
      queueDefect({ op: 'insert', id: id, row: { id: id, branch_id: bid, text: t, owner: $('ndOwner').value.trim() || null, due_date: $('ndDue').value || null, created_by: uid() } });
      J.closeSheet(); toast('הליקוי נוסף');
      setTimeout(function () { viewDefects(main()); }, navigator.onLine ? 1200 : 0);
    };
  }

  window.JEMS_AUDIT = {
    views: { audit: viewAudit, report: viewReport, defects: viewDefects },
    openNew: openNew, home: home, bindOpen: bindOpen, scorePill: scorePill, start: start, sync: sync,
    saveMeta: saveMeta, loadMeta: loadMeta,
    // exposed for tests
    _compute: compute, _buildSnap: buildSnap, _waText: waText
  };
})();
