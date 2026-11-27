// Login code length must match Supabase: Auth, Email, Email OTP Length.
var CODE_LEN = (window.JEMS_CONFIG && window.JEMS_CONFIG.codeLength) || 8;
/* ביקור סניף · ג'מס · 2.0 · שלב 1: כניסה ושלד */
(function () {
  'use strict';
  var C = window.JEMS_CONFIG;
  var sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'jems-audit-auth' }
  });

  var $app = document.getElementById('app');
  var state = { me: null, roles: [], branches: [], tab: 'home', loginEmail: '', cooldown: 0 };

  var ROLE_NAMES = {
    super_admin: 'מנהל-על', exec_viewer: 'צופה הנהלה', auditor: 'מבקר',
    branch_manager: 'מנהל סניף', mystery_internal: 'לקוח סמוי'
  };
  var TYPE_NAMES = { full: 'ביקורת מלאה', quick: 'ביקורת בזק', tasting: 'בדיקת מנות', mystery: 'לקוח סמוי' };
  var TYPES = [
    { id: 'full', e: '📝', n: 'ביקורת מלאה', d: 'כ-30 דקות' },
    { id: 'quick', e: '⚡', n: 'ביקורת בזק', d: 'כ-10 דקות' },
    { id: 'tasting', e: '🍽️', n: 'בדיקת מנות', d: 'שמונה קריטריונים לכל מנה' },
    { id: 'mystery', e: '🕵️', n: 'לקוח סמוי', d: 'רק למורשים' }
  ];

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function h(html) { $app.innerHTML = html; }
  var toastT;
  function toast(msg) {
    var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function has(r) { return state.roles.indexOf(r) >= 0; }
  function isAdmin() { return has('super_admin'); }
  function fmtDate(d) { try { return new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' }); } catch (e) { return ''; } }
  function branchName(id) { var b = state.branches.find(function (x) { return x.id === id; }); return b ? b.name : ''; }

  // ---------- theme ----------
  function theme() { return document.documentElement.dataset.theme; }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('jems-theme', t); } catch (e) {}
    var m = document.getElementById('themeColor'); if (m) m.content = t === 'light' ? '#f8f3ea' : '#16120d';
    var b = document.getElementById('themeBtn'); if (b) { b.textContent = t === 'light' ? '🌙' : '☀️'; b.setAttribute('aria-label', t === 'light' ? 'מעבר למצב לילה' : 'מעבר למצב יום'); }
  }
  setTheme(theme());
  function themeBtn() {
    var t = theme();
    return '<button class="icon-btn" id="themeBtn" aria-label="' + (t === 'light' ? 'מעבר למצב לילה' : 'מעבר למצב יום') + '">' + (t === 'light' ? '🌙' : '☀️') + '</button>';
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#themeBtn')) setTheme(theme() === 'light' ? 'dark' : 'light');
  });

  // ---------- error text ----------
  function authError(err) {
    var m = (err && (err.message || err.msg)) || '';
    if (/Database error|not_invited|Signups not allowed|saving new user/i.test(m)) return 'המייל הזה עוד לא הוזמן למערכת. בקש מתומר להוסיף אותך.';
    if (/after \d+ seconds|rate limit|too many/i.test(m)) return 'נשלחו יותר מדי קודים. חכה דקה ונסה שוב.';
    if (/expired|invalid|otp/i.test(m)) return 'הקוד לא נכון או שפג תוקפו. בדוק את המייל האחרון, או בקש קוד חדש.';
    if (/fetch|network|Failed to/i.test(m)) return 'אין חיבור לרשת. בדוק קליטה ונסה שוב.';
    return 'משהו השתבש. נסה שוב בעוד רגע.';
  }

  // ---------- login ----------
  function brand() {
    return '<div class="brand"><div class="mark">J</div><div><h1>ביקור סניף</h1><small>ג\'מס · מערכת ביקורת ותפעול</small></div></div>';
  }
  function renderEmail(err) {
    h('<div class="login"><div class="glow"></div>' + brand() +
      '<form class="card" id="emailForm" novalidate>' +
      '<label class="field"><span>המייל שלך</span>' +
      '<input class="input ltr" id="email" type="email" inputmode="email" autocomplete="email" placeholder="name@gmail.com" value="' + esc(state.loginEmail) + '" required>' +
      '<div class="hint">נשלח אליך קוד של ' + CODE_LEN + ' ספרות. בלי סיסמה.</div></label>' +
      '<div class="err" id="err">' + esc(err || '') + '</div>' +
      '<button class="btn btn-primary" id="sendBtn" type="submit">שלח לי קוד</button>' +
      '</form>' +
      '<div class="row-links" style="justify-content:center">' + themeBtn() + '</div>' +
      '</div>');
    var f = document.getElementById('emailForm');
    var inp = document.getElementById('email');
    setTimeout(function () { inp.focus(); }, 50);
    inp.addEventListener('input', function () { document.getElementById('err').textContent = ''; });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = inp.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { document.getElementById('err').textContent = 'נראה שחסר משהו בכתובת. למשל: name@gmail.com'; inp.focus(); return; }
      state.loginEmail = email;
      sendCode(document.getElementById('sendBtn'), function (e2) { if (e2) document.getElementById('err').textContent = e2; else renderCode(); });
    });
  }
  function sendCode(btn, done) {
    var label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> שולח…';
    sb.auth.signInWithOtp({ email: state.loginEmail, options: { shouldCreateUser: true } }).then(function (r) {
      btn.disabled = false; btn.innerHTML = label;
      if (r.error) return done(authError(r.error));
      startCooldown(); done(null);
    }).catch(function (e) { btn.disabled = false; btn.innerHTML = label; done(authError(e)); });
  }
  var cdT;
  function startCooldown() {
    state.cooldown = 60; clearInterval(cdT);
    cdT = setInterval(function () {
      state.cooldown--; var b = document.getElementById('resendBtn');
      if (b) { b.disabled = state.cooldown > 0; b.textContent = state.cooldown > 0 ? 'קוד חדש בעוד ' + state.cooldown : 'שלח קוד חדש'; }
      if (state.cooldown <= 0) clearInterval(cdT);
    }, 1000);
  }
  function renderCode(err) {
    h('<div class="login"><div class="glow"></div>' + brand() +
      '<form class="card" id="codeForm" novalidate>' +
      '<p class="sent-to">שלחנו קוד אל <b>' + esc(state.loginEmail) + '</b></p>' +
      '<label class="field"><span>הקוד מהמייל</span>' +
      '<input class="input code" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="' + CODE_LEN + '" pattern="[0-9]*" placeholder="' + '·'.repeat(CODE_LEN) + '" required>' +
      '<div class="hint">לא מגיע? בדוק גם בקידומי מכירות ובספאם.</div></label>' +
      '<div class="err" id="err">' + esc(err || '') + '</div>' +
      '<button class="btn btn-primary" id="goBtn" type="submit">היכנס</button>' +
      '<div class="row-links"><button type="button" class="btn btn-ghost" id="backBtn">החלף מייל</button>' +
      '<button type="button" class="btn btn-ghost" id="resendBtn"' + (state.cooldown > 0 ? ' disabled' : '') + '>' + (state.cooldown > 0 ? 'קוד חדש בעוד ' + state.cooldown : 'שלח קוד חדש') + '</button></div>' +
      '</form></div>');
    var inp = document.getElementById('code');
    setTimeout(function () { inp.focus(); }, 50);
    inp.addEventListener('input', function () {
      inp.value = inp.value.replace(/\D/g, '').slice(0, CODE_LEN);
      document.getElementById('err').textContent = '';
      if (inp.value.length === CODE_LEN) document.getElementById('codeForm').requestSubmit();
    });
    document.getElementById('backBtn').onclick = function () { renderEmail(); };
    document.getElementById('resendBtn').onclick = function () {
      var b = this;
      sendCode(b, function (e2) { document.getElementById('err').textContent = e2 || ''; if (!e2) toast('נשלח קוד חדש'); });
    };
    document.getElementById('codeForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (inp.value.length !== CODE_LEN) { document.getElementById('err').textContent = 'הקוד הוא ' + CODE_LEN + ' ספרות.'; return; }
      var b = document.getElementById('goBtn'); b.disabled = true; b.innerHTML = '<span class="spin"></span> נכנס…';
      sb.auth.verifyOtp({ email: state.loginEmail, token: inp.value, type: 'email' }).then(function (r) {
        if (r.error) { b.disabled = false; b.textContent = 'היכנס'; document.getElementById('err').textContent = authError(r.error); inp.select(); }
        // success is handled by onAuthStateChange
      });
    });
  }

  // ---------- load user ----------
  function loadMe(user) {
    return Promise.all([
      sb.from('profiles').select('id,email,full_name').eq('id', user.id).maybeSingle(),
      sb.from('user_roles').select('role,is_primary').eq('user_id', user.id),
      sb.from('branches').select('id,code,name,ownership,sort').eq('active', true).order('sort')
    ]).then(function (res) {
      if (res[0].error || res[1].error || res[2].error) throw (res[0].error || res[1].error || res[2].error);
      state.me = res[0].data || { id: user.id, email: user.email };
      var roles = res[1].data || [];
      roles.sort(function (a, b) { return (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0); });
      state.roles = roles.map(function (r) { return r.role; });
      state.branches = res[2].data || [];
    });
  }

  // ---------- shell ----------
  function displayName() { return (state.me && (state.me.full_name || (state.me.email || '').split('@')[0])) || ''; }
  function renderShell() {
    var role = state.roles[0] ? ROLE_NAMES[state.roles[0]] : 'בלי הרשאה עדיין';
    h('<header class="topbar">' +
      '<div class="mark" aria-hidden="true">J</div>' +
      '<button class="who" id="whoBtn" aria-label="החשבון שלי"><b>' + esc(displayName()) + '</b><small>' + esc(role) + '</small></button>' +
      themeBtn() +
      (isAdmin() ? '<button class="icon-btn" id="setBtn" aria-label="הגדרות">⚙️</button>' : '') +
      '</header>' +
      '<main id="main"></main>' +
      '<nav class="nav" aria-label="ניווט ראשי">' +
      navBtn('home', '🏠', 'בית') + navBtn('trends', '📈', 'מגמות') +
      '<button class="plus" id="newBtn" aria-label="ביקורת חדשה"><span class="fab">＋</span><span class="l">חדשה</span></button>' +
      navBtn('history', '🗂️', 'היסטוריה') + navBtn('me', '👤', 'אני') +
      '</nav>');
    document.querySelectorAll('.nav [data-tab]').forEach(function (b) { b.onclick = function () { go(b.dataset.tab); }; });
    document.getElementById('newBtn').onclick = openNew;
    document.getElementById('whoBtn').onclick = function () { go('me'); };
    var sbtn = document.getElementById('setBtn'); if (sbtn) sbtn.onclick = function () { go('settings'); };
    go(state.tab);
  }
  function navBtn(id, i, l) { return '<button data-tab="' + id + '"><span class="i">' + i + '</span><span>' + l + '</span></button>'; }
  function go(tab) {
    state.tab = tab;
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
    document.querySelectorAll('.nav [data-tab]').forEach(function (b) {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    var m = document.getElementById('main'); if (!m) return;
    window.scrollTo(0, 0);
    ({ home: viewHome, trends: viewTrends, history: viewHistory, me: viewMe, settings: viewSettings }[tab] || viewHome)(m);
  }

  function emptyBox(ico, title, text, btnLabel, btnId) {
    return '<div class="empty"><div class="ico">' + ico + '</div><b>' + title + '</b><p>' + text + '</p>' +
      (btnLabel ? '<button class="btn btn-primary" id="' + btnId + '">' + btnLabel + '</button>' : '') + '</div>';
  }
  function noRoleBox() {
    return emptyBox('🔒', 'עוד אין לך הרשאות', 'החשבון נפתח, אבל עוד לא שויכו לך תפקיד וסניף. בקש מתומר להשלים.', '', '');
  }

  // ---------- views ----------
  function viewHome(m) {
    if (!state.roles.length) { m.innerHTML = '<h2 class="page">שלום ' + esc(displayName()) + '</h2>' + noRoleBox(); return; }
    m.innerHTML = '<h2 class="page">שלום ' + esc(displayName()) + '</h2>' +
      '<div class="stat-row"><div class="stat"><div class="n gold" id="stDraft">–</div><div class="l">ביקורות בעבודה</div></div>' +
      '<div class="stat"><div class="n" id="stDef">–</div><div class="l">ליקויים פתוחים</div></div></div>' +
      '<h3 class="sec">ביקורות בעבודה</h3><div id="drafts"></div>' +
      '<h3 class="sec">ליקויים ארוכי טווח</h3><div id="defects"></div>' +
      '<h3 class="sec">ביקורות אחרונות</h3><div id="recent"></div>';
    var uid = state.me.id;
    sb.from('audits').select('id,type,branch_id,started_at,status').eq('status', 'draft').eq('created_by', uid).order('started_at', { ascending: false }).then(function (r) {
      var el = document.getElementById('drafts'); if (!el) return;
      var rows = r.data || [];
      document.getElementById('stDraft').textContent = rows.length;
      el.innerHTML = rows.length ? list(rows) : emptyBox('📝', 'אין ביקורת פתוחה', 'ביקורת שהתחלת ועצרת תחכה כאן, ותמשיך מאותו מקום.', 'התחל ביקורת', 'emptyNew');
      var b = document.getElementById('emptyNew'); if (b) b.onclick = openNew;
    });
    sb.from('long_term_defects').select('id,due_date', { count: 'exact' }).eq('status', 'open').then(function (r) {
      var el = document.getElementById('defects'); if (!el) return;
      var n = r.count || 0, today = new Date().toISOString().slice(0, 10);
      var late = (r.data || []).filter(function (d) { return d.due_date && d.due_date < today; }).length;
      document.getElementById('stDef').textContent = n;
      el.innerHTML = n ? '<div class="item"><div class="t"><b>' + n + ' פתוחים' + (late ? ' · ' + late + ' באיחור' : '') + '</b><small>הרשימה המלאה תגיע בשלב 2</small></div></div>'
        : emptyBox('✅', 'אין ליקויים פתוחים', 'ליקוי שצריך זמן לתקן יופיע כאן, עד שמישהו בסניף יסמן שטופל.', '', '');
    });
    sb.from('audits').select('id,type,branch_id,started_at,status,coverage').neq('status', 'draft').order('started_at', { ascending: false }).limit(5).then(function (r) {
      var el = document.getElementById('recent'); if (!el) return;
      var rows = r.data || [];
      el.innerHTML = rows.length ? list(rows) : emptyBox('🗂️', 'עוד אין ביקורות שמורות', 'כשתסיים ביקורת ראשונה, היא תופיע כאן עם הציון.', '', '');
    });
  }
  function list(rows) {
    return '<div class="list">' + rows.map(function (a) {
      return '<div class="item"><div class="t"><b>' + esc(TYPE_NAMES[a.type] || a.type) + ' · ' + esc(branchName(a.branch_id)) + '</b><small>' + fmtDate(a.started_at) + '</small></div>' +
        '<span class="pill">' + (a.status === 'draft' ? 'בעבודה' : a.status === 'partial' ? 'חלקית' : 'הושלמה') + '</span></div>';
    }).join('') + '</div>';
  }
  function viewTrends(m) {
    m.innerHTML = '<h2 class="page">מגמות</h2>' + (state.roles.length ?
      emptyBox('📈', 'עוד אין מה להציג', 'הגרפים יתמלאו אחרי כמה ביקורות שמורות: ציונים לאורך זמן, השוואת סניפים ומחלקות.', 'התחל ביקורת', 'emptyNew') : noRoleBox());
    var b = document.getElementById('emptyNew'); if (b) b.onclick = openNew;
  }
  function viewHistory(m) {
    m.innerHTML = '<h2 class="page">היסטוריה</h2><div id="hist"></div>';
    if (!state.roles.length) { document.getElementById('hist').innerHTML = noRoleBox(); return; }
    sb.from('audits').select('id,type,branch_id,started_at,status').neq('status', 'draft').order('started_at', { ascending: false }).limit(50).then(function (r) {
      var el = document.getElementById('hist'); if (!el) return;
      var rows = r.data || [];
      el.innerHTML = rows.length ? list(rows) : emptyBox('🗂️', 'ההיסטוריה ריקה', 'כל ביקורת שתסיים תישמר כאן. אפשר יהיה לסנן לפי סניף, סוג ותאריך.', 'התחל ביקורת', 'emptyNew');
      var b = document.getElementById('emptyNew'); if (b) b.onclick = openNew;
    });
  }
  function viewMe(m) {
    var br = state.branches.map(function (b) { return b.name; }).join(', ') || 'אין';
    m.innerHTML = '<h2 class="page">החשבון שלי</h2>' +
      '<div class="card"><div class="kv">' +
      '<div>שם: <b>' + esc(state.me.full_name || 'לא הוגדר') + '</b></div>' +
      '<div>מייל: <b class="ltr">' + esc(state.me.email) + '</b></div>' +
      '<div>תפקיד: <b>' + esc(state.roles.map(function (r) { return ROLE_NAMES[r]; }).join(', ') || 'אין עדיין') + '</b></div>' +
      '<div>סניפים: <b>' + esc(br) + '</b></div></div>' +
      '<label class="field"><span>השם שיופיע בדוחות</span><input class="input" id="nameIn" value="' + esc(state.me.full_name || '') + '" placeholder="למשל: תומר בר-לוי" autocomplete="name"></label>' +
      '<button class="btn btn-primary" id="saveName">שמור שם</button></div>' +
      '<h3 class="sec">כללי</h3><div class="menu">' +
      '<button class="btn" id="themeRow">' + (theme() === 'light' ? '🌙 עבור למצב לילה' : '☀️ עבור למצב יום') + '</button>' +
      '<button class="btn" id="outBtn">🚪 התנתק</button></div>' +
      '<p style="color:var(--faint);font-size:13px;text-align:center;margin-top:24px">גרסה ' + esc(C.version) + '</p>';
    document.getElementById('themeRow').onclick = function () { setTheme(theme() === 'light' ? 'dark' : 'light'); viewMe(m); };
    document.getElementById('outBtn').onclick = function () { sb.auth.signOut(); };
    document.getElementById('saveName').onclick = function () {
      var v = document.getElementById('nameIn').value.trim(); if (!v) { toast('כתוב שם קודם'); return; }
      var btn = this; btn.disabled = true;
      sb.from('profiles').update({ full_name: v }).eq('id', state.me.id).then(function (r) {
        btn.disabled = false;
        if (r.error) { toast('השמירה לא הצליחה. נסה שוב.'); return; }
        state.me.full_name = v; toast('השם נשמר'); renderShell();
      });
    };
  }
  function viewSettings(m) {
    if (!isAdmin()) { go('home'); return; }
    m.innerHTML = '<h2 class="page">הגדרות</h2>' +
      emptyBox('⚙️', 'מסכי ההגדרות ייבנו בשלב 6', 'סניפים, מחלקות וסעיפים, ספריית מנות, תבנית לקוח סמוי ומשתמשים.', '', '') +
      '<h3 class="sec">סניפים במערכת</h3><div class="list">' +
      state.branches.map(function (b) { return '<div class="item"><div class="t"><b>' + esc(b.name) + '</b><small>' + (b.ownership === 'franchise' ? 'זיכיון' : 'חברה') + '</small></div></div>'; }).join('') + '</div>';
  }

  // ---------- new audit sheet ----------
  function allowedTypes() {
    if (isAdmin() || has('auditor')) return ['full', 'quick', 'tasting', 'mystery'];
    var t = [];
    if (has('branch_manager')) t.push('full', 'quick', 'tasting');
    if (has('mystery_internal')) t.push('mystery');
    return t;
  }
  function openNew() {
    var ok = allowedTypes();
    var body = ok.length ? '<div class="types">' + TYPES.filter(function (t) { return ok.indexOf(t.id) >= 0; }).map(function (t) {
      return '<button class="type" data-type="' + t.id + '"><span class="e">' + t.e + '</span><span class="t"><b>' + t.n + '</b><small>' + t.d + '</small></span><span class="pill">בקרוב</span></button>';
    }).join('') + '</div>' : noRoleBox();
    sheet('<h3>איזו ביקורת?</h3>' + body);
    document.querySelectorAll('.type').forEach(function (b) {
      b.onclick = function () { closeSheet(); toast(TYPE_NAMES[b.dataset.type] + ': הטופס נבנה בשלב הבא'); };
    });
  }
  function sheet(inner) {
    closeSheet();
    var s = document.createElement('div'); s.className = 'scrim'; s.id = 'scrim';
    var p = document.createElement('div'); p.className = 'sheet'; p.id = 'sheet'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true');
    p.innerHTML = '<div class="grab"></div>' + inner;
    s.onclick = closeSheet;
    document.body.appendChild(s); document.body.appendChild(p);
    var f = p.querySelector('button'); if (f) f.focus();
  }
  function closeSheet() { ['scrim', 'sheet'].forEach(function (id) { var e = document.getElementById(id); if (e) e.remove(); }); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  // ---------- boot ----------
  var booted = null;
  function onSession(session) {
    if (!session) { booted = null; state.me = null; state.roles = []; renderEmail(); return; }
    if (booted === session.user.id) return;
    booted = session.user.id;
    var t = (location.hash || '').slice(1); if (t) state.tab = t;
    loadMe(session.user).then(renderShell).catch(function () {
      booted = null;
      h('<div class="login">' + brand() + '<div class="card">' + emptyBox('📡', 'לא הצלחנו לטעון', 'בדוק חיבור לרשת ונסה שוב.', 'נסה שוב', 'retry') + '</div></div>');
      document.getElementById('retry').onclick = function () { onSession(session); };
    });
  }
  sb.auth.onAuthStateChange(function (_ev, session) { setTimeout(function () { onSession(session); }, 0); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
