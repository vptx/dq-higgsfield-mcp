// Static assets for /admin. Served under a strict CSP: no inline scripts or style attributes, no external hosts.

const svg = (paths: string, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const logo = (width: number, id: string) =>
  `<svg width="${width}" height="${Math.round((width * 215) / 340)}" viewBox="0 0 340 215" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Big Cloud">` +
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a9bff"/><stop offset="1" stop-color="#1a5ff5"/></linearGradient></defs>` +
  `<g stroke="url(#${id})" stroke-width="20"><path d="M75 110H60a45 45 0 0 0 0 90h15"/><path d="M95 200V55a42 42 0 0 1 84 0v20"/><path d="M125 135v-25h155a45 45 0 0 1 0 90H125v-25"/></g></svg>`;
const EYE = '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>';

export const PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<title>Big Cloud · AI gateway</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(logo(64, "lg-fav"))}">
<link rel="stylesheet" href="/admin/app.css">
</head>
<body>
<div id="toasts" class="toasts" aria-live="polite"></div>

<main id="login" class="login" hidden>
  <form id="login-form" class="login-card" novalidate>
    <div class="login-brand">
      ${logo(96, "lg-login")}
      <h1>Big Cloud</h1>
      <p class="muted">لوحة إدارة <bdi>AI gateway</bdi></p>
    </div>
    <div class="field">
      <label for="secret">كلمة سر الأدمن أو توكن الأدمن</label>
      <div class="input-group">
        <input id="secret" type="password" autocomplete="current-password" spellcheck="false" required aria-describedby="login-error">
        <button type="button" class="icon-btn" id="secret-toggle" aria-label="إظهار كلمة السر" aria-pressed="false">${svg(EYE)}</button>
      </div>
    </div>
    <p id="login-error" class="field-error" role="alert"></p>
    <button type="submit" class="btn btn-primary btn-block" id="login-btn"><span class="spinner" aria-hidden="true"></span><span>دخول</span></button>
    <p class="muted small center-text">بعد 10 محاولات غلط، الدخول بيتسكّر 10 دقائق.</p>
  </form>
</main>

<div id="app" hidden>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-mark">${logo(40, "lg-top")}</span>
        <div>
          <strong>Big Cloud</strong>
          <span class="muted small">AI gateway</span>
        </div>
      </div>
      <div class="topbar-end">
        <span class="chip" id="who"></span>
        <button class="btn btn-ghost" id="logout" type="button"><span data-icon="logout"></span><span>خروج</span></button>
      </div>
    </div>
  </header>

  <main class="container">
    <div class="page-head">
      <div>
        <h1>الفريق</h1>
        <p class="muted">صرف وأعضاء شهر <span id="month" dir="ltr"></span> · الأرقام تقديرية حسب أسعار كل خدمة</p>
      </div>
      <button class="btn btn-primary" id="open-add" type="button"><span data-icon="plus"></span><span>إضافة عضو</span></button>
    </div>

    <section class="stats" id="stats" aria-label="ملخص الشهر"></section>

    <section class="panel">
      <div class="panel-head">
        <h2>الأعضاء <span class="count" id="member-count"></span></h2>
        <div class="search">
          <span data-icon="search"></span>
          <input id="filter" type="search" placeholder="ابحث بالاسم" aria-label="ابحث عن عضو بالاسم">
        </div>
      </div>
      <div class="table-wrap">
        <table class="members">
          <thead><tr>
            <th scope="col">العضو</th>
            <th scope="col">الحالة</th>
            <th scope="col">الصرف هالشهر</th>
            <th scope="col" class="num">التزامن</th>
            <th scope="col" class="num">توليدات</th>
            <th scope="col"><span class="sr-only">إجراءات</span></th>
          </tr></thead>
          <tbody id="users"></tbody>
        </table>
      </div>
    </section>
  </main>
</div>

<dialog id="add-dialog" class="dialog" aria-labelledby="add-title">
  <form id="add-form" novalidate>
    <div class="dialog-head">
      <h2 id="add-title">إضافة عضو</h2>
      <button type="button" class="icon-btn" data-close aria-label="إغلاق"><span data-icon="x"></span></button>
    </div>
    <div class="field">
      <label for="add-name">الاسم</label>
      <input id="add-name" required maxlength="40" autocomplete="off" spellcheck="false" aria-describedby="add-name-hint">
      <p class="hint" id="add-name-hint">حروف وأرقام ومسافات و . _ - ، لحد 40 حرف</p>
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="add-budget">الميزانية الشهرية</label>
        <div class="input-affix"><span dir="ltr">$</span><input id="add-budget" type="number" min="0" step="1" value="50" inputmode="decimal"></div>
      </div>
      <div class="field">
        <label for="add-conc">توليدات متزامنة</label>
        <input id="add-conc" type="number" min="1" max="20" step="1" value="3" inputmode="numeric">
      </div>
    </div>
    <fieldset class="svc-field">
      <legend>الخدمات المسموحة</legend>
      <div id="add-services" class="svc-list"></div>
    </fieldset>
    <label class="switch-row">
      <input id="add-admin" type="checkbox" class="switch">
      <span><strong>أدمن</strong><span class="muted small">بيقدر يدخل هاللوحة ويشوف توليدات الكل</span></span>
    </label>
    <p id="add-error" class="field-error" role="alert"></p>
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" data-close>إلغاء</button>
      <button type="submit" class="btn btn-primary"><span class="spinner" aria-hidden="true"></span><span>إضافة وتوليد رابط</span></button>
    </div>
  </form>
</dialog>

<dialog id="edit-dialog" class="dialog" aria-labelledby="edit-title">
  <form id="edit-form" novalidate>
    <div class="dialog-head">
      <h2 id="edit-title">تعديل</h2>
      <button type="button" class="icon-btn" data-close aria-label="إغلاق"><span data-icon="x"></span></button>
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="edit-budget">الميزانية الشهرية</label>
        <div class="input-affix"><span dir="ltr">$</span><input id="edit-budget" type="number" min="0" step="1" inputmode="decimal"></div>
      </div>
      <div class="field">
        <label for="edit-conc">توليدات متزامنة</label>
        <input id="edit-conc" type="number" min="1" max="20" step="1" inputmode="numeric">
      </div>
    </div>
    <fieldset class="svc-field">
      <legend>الخدمات المسموحة</legend>
      <div id="edit-services" class="svc-list"></div>
      <p class="hint">التغيير بيصير فوراً على نفس الرابط، ما بيحتاج العضو يغيّر شي.</p>
    </fieldset>
    <label class="switch-row" id="edit-admin-row">
      <input id="edit-admin" type="checkbox" class="switch">
      <span><strong>أدمن</strong><span class="muted small">بيقدر يدخل هاللوحة ويشوف توليدات الكل</span></span>
    </label>
    <p id="edit-error" class="field-error" role="alert"></p>
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" data-close>إلغاء</button>
      <button type="submit" class="btn btn-primary"><span class="spinner" aria-hidden="true"></span><span>حفظ</span></button>
    </div>
  </form>
</dialog>

<dialog id="link-dialog" class="dialog dialog-wide" aria-labelledby="link-title">
  <div class="dialog-head">
    <div>
      <h2 id="link-title"></h2>
      <p class="muted small" id="link-sub"></p>
    </div>
    <button type="button" class="icon-btn" data-close aria-label="إغلاق"><span data-icon="x"></span></button>
  </div>
  <div class="callout">
    <span data-icon="alert"></span>
    <p>هالرابط بيظهر <strong>مرة وحدة بس</strong> وما منقدر نرجّعه. ابعته للعضو بشكل خاص، مش بجروب، لأنه بمثابة كلمة سر.</p>
  </div>
  <div class="field">
    <label for="link-url">رابط الـ connector لـ <bdi>Claude.ai</bdi></label>
    <div class="secret" data-secret>
      <input id="link-url" type="password" readonly dir="ltr" spellcheck="false">
      <button type="button" class="icon-btn" data-reveal aria-label="إظهار" aria-pressed="false"><span data-icon="eye"></span></button>
      <button type="button" class="btn btn-secondary" data-copy><span data-icon="copy"></span><span>نسخ</span></button>
    </div>
  </div>
  <div class="field">
    <label for="link-cmd">أمر الإضافة لـ <bdi>Claude Code</bdi></label>
    <div class="secret" data-secret>
      <input id="link-cmd" type="password" readonly dir="ltr" spellcheck="false">
      <button type="button" class="icon-btn" data-reveal aria-label="إظهار" aria-pressed="false"><span data-icon="eye"></span></button>
      <button type="button" class="btn btn-secondary" data-copy><span data-icon="copy"></span><span>نسخ</span></button>
    </div>
  </div>
  <ol class="steps">
    <li>بـ Claude افتح <b><bdi>Settings ← Connectors ← Add custom connector</bdi></b></li>
    <li>الاسم: <b><bdi>Big Cloud AI</bdi></b></li>
    <li>الرابط: الرابط اللي فوق، وبعدين فعّل الـ connector بالمحادثة</li>
  </ol>
  <div class="dialog-actions">
    <button type="button" class="btn btn-primary" data-close>تم، نسخته</button>
  </div>
</dialog>

<dialog id="confirm-dialog" class="dialog dialog-narrow" aria-labelledby="confirm-title">
  <h2 id="confirm-title"></h2>
  <p class="muted" id="confirm-body"></p>
  <div class="dialog-actions">
    <button type="button" class="btn btn-ghost" id="confirm-no">إلغاء</button>
    <button type="button" class="btn" id="confirm-yes"></button>
  </div>
</dialog>

<script src="/admin/app.js"></script>
</body>
</html>`;

export const STYLE = `
:root{
  --bg:#0b1120;--surface:#111827;--card:#1b2336;--muted-bg:#272f42;--line:#2a3448;--line-strong:#475569;
  --fg:#f8fafc;--muted:#94a3b8;--subtle:#64748b;
  --accent:#1f6feb;--accent-hover:#1a5fd0;--on-accent:#ffffff;--accent-soft:rgba(31,111,235,.18);--accent-text:#5aa2ff;
  --ok:#22c55e;--ok-soft:rgba(34,197,94,.12);
  --warn:#f59e0b;--warn-soft:rgba(245,158,11,.12);--danger:#ef4444;--danger-soft:rgba(239,68,68,.12);
  --ring:#f8fafc;--radius:12px;--radius-sm:8px;
  --font:"Segoe UI","IBM Plex Sans Arabic","Noto Sans Arabic",Tahoma,system-ui,-apple-system,sans-serif;
  --mono:ui-monospace,"Cascadia Code","JetBrains Mono",Consolas,monospace;
  --ease:cubic-bezier(.2,.7,.2,1);
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 var(--font);min-height:100vh;-webkit-font-smoothing:antialiased}
h1,h2{margin:0;line-height:1.3}
h1{font-size:22px;font-weight:700}
h2{font-size:16px;font-weight:600}
p{margin:0}
.muted{color:var(--muted)}
.small{font-size:13px}
.center-text{text-align:center}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
svg{flex-shrink:0;display:block}
[data-icon]{display:inline-flex}

:focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:6px}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 16px;border-radius:var(--radius-sm);border:1px solid transparent;font:inherit;font-weight:600;font-size:14px;cursor:pointer;white-space:nowrap;transition:background-color .18s var(--ease),border-color .18s var(--ease),color .18s var(--ease),transform .1s}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.55;cursor:not-allowed}
.btn-primary{background:var(--accent);color:var(--on-accent)}
.btn-primary:hover:not(:disabled){background:var(--accent-hover)}
.btn-secondary{background:var(--muted-bg);color:var(--fg);border-color:var(--line)}
.btn-secondary:hover:not(:disabled){border-color:var(--line-strong)}
.btn-ghost{background:transparent;color:var(--fg);border-color:var(--line)}
.btn-ghost:hover:not(:disabled){background:var(--muted-bg)}
.btn-danger{background:var(--danger);color:#fff}
.btn-danger:hover:not(:disabled){background:#dc2626}
.btn-block{width:100%}
.icon-btn{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:var(--radius-sm);border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;transition:background-color .18s var(--ease),color .18s var(--ease)}
.icon-btn:hover{background:var(--muted-bg);color:var(--fg)}
.icon-btn.danger:hover{background:var(--danger-soft);color:var(--danger)}
.icon-btn.ok:hover{background:var(--ok-soft);color:var(--ok)}
.spinner{display:none;width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-inline-end-color:transparent;animation:spin .7s linear infinite}
.is-loading .spinner{display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}

/* fields */
.field{display:grid;gap:6px;margin-bottom:16px}
.field label{font-size:13px;font-weight:600;color:var(--muted)}
input{font:inherit;color:var(--fg);background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--radius-sm);min-height:42px;padding:0 12px;width:100%;transition:border-color .18s var(--ease),box-shadow .18s var(--ease)}
input:hover{border-color:var(--subtle)}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
input[aria-invalid="true"]{border-color:var(--danger)}
input[type=number]{direction:ltr;text-align:right;font-variant-numeric:tabular-nums}
.hint{font-size:12px;color:var(--subtle)}
.field-error{color:var(--danger);font-size:13px;margin:-4px 0 8px}
.field-error:empty{margin:0}
.input-group{position:relative}
.input-group input{padding-inline-end:48px}
.input-group .icon-btn{position:absolute;inset-inline-end:1px;top:1px;height:40px}
.input-affix{display:flex;align-items:center;background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--radius-sm);transition:border-color .18s var(--ease),box-shadow .18s var(--ease)}
.input-affix:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.input-affix span{padding:0 12px;color:var(--subtle);border-inline-start:1px solid var(--line);order:2}
.input-affix input{border:0;box-shadow:none;background:transparent}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.switch-row{display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:12px}
.switch-row > span{display:grid;gap:2px}
.switch{appearance:none;flex-shrink:0;width:38px;height:22px;min-height:0;padding:0;border-radius:999px;background:var(--muted-bg);border:1px solid var(--line-strong);position:relative;cursor:pointer;margin-top:2px}
.switch::after{content:"";position:absolute;top:2px;inset-inline-start:2px;width:16px;height:16px;border-radius:50%;background:var(--muted);transition:inset-inline-start .18s var(--ease),background-color .18s var(--ease)}
.switch:checked{background:var(--accent);border-color:var(--accent)}
.switch:checked::after{inset-inline-start:18px;background:var(--on-accent)}
.switch:focus{box-shadow:0 0 0 3px var(--accent-soft)}

/* brand */
.brand{display:flex;align-items:center;gap:10px}
.brand > div{display:grid;line-height:1.25}
.brand-mark{display:grid;place-items:center}
.login-brand{display:grid;justify-items:center;text-align:center;gap:6px;margin-bottom:28px}
.login-brand svg{margin-bottom:6px}

/* login */
.login{min-height:100vh;display:grid;place-items:center;padding:24px}
.login-card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 28px;box-shadow:0 24px 48px -16px rgba(0,0,0,.5)}
.login-card .btn-block{margin-bottom:16px;min-height:44px}

/* topbar */
.topbar{position:sticky;top:0;z-index:10;background:rgba(11,17,32,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.topbar-inner{max-width:1160px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.topbar-end{display:flex;align-items:center;gap:10px}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);padding:4px 10px;border:1px solid var(--line);border-radius:999px}

.container{max-width:1160px;margin:0 auto;padding:28px 24px 64px}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.page-head .muted{margin-top:4px;font-size:14px}

/* stats */
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;display:grid;gap:6px;align-content:start}
.stat-top{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:13px;font-weight:600}
.stat-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--muted-bg);color:var(--muted)}
.stat-value{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.stat-sub{font-size:12px;color:var(--subtle)}
.stat-of{font-size:15px;font-weight:600;color:var(--muted)}
.svc-split{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px;font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.svc-chip{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);border:1px solid rgba(31,111,235,.3)}
.svc-chip.warn{background:var(--warn-soft);color:var(--warn);border-color:rgba(245,158,11,.3)}
.svc-field{border:0;padding:0;margin:0 0 12px}
.svc-field legend{font-size:13px;font-weight:600;color:var(--muted);padding:0;margin-bottom:6px}
.svc-field .hint{margin-top:6px}
.svc-list{display:grid;gap:8px}
.svc-option{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:var(--radius-sm);cursor:pointer;transition:border-color .18s var(--ease),background-color .18s var(--ease)}
.svc-option:hover{border-color:var(--line-strong)}
.svc-option:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.svc-option.is-off{opacity:.55;cursor:not-allowed}
.svc-text{display:grid;gap:1px}
.svc-check{appearance:none;flex-shrink:0;width:20px;height:20px;min-height:0;padding:0;border-radius:6px;border:1.5px solid var(--line-strong);background:var(--surface);display:grid;place-items:center;cursor:inherit}
.svc-check:checked{background:var(--accent);border-color:var(--accent)}
.svc-check:checked::after{content:"";width:10px;height:6px;border-left:2px solid #fff;border-bottom:2px solid #fff;transform:translateY(-1px) rotate(-45deg)}
.svc-check:focus-visible{box-shadow:0 0 0 3px var(--accent-soft)}

/* panel + table */
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.count{font-size:12px;font-weight:600;color:var(--muted);background:var(--muted-bg);padding:2px 8px;border-radius:999px;margin-inline-start:6px;vertical-align:middle}
.search{position:relative;width:min(260px,100%)}
.search [data-icon]{position:absolute;inset-inline-start:12px;top:50%;transform:translateY(-50%);color:var(--subtle);pointer-events:none}
.search input{padding-inline-start:38px;min-height:38px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{font-size:12px;font-weight:600;color:var(--subtle);text-align:start;padding:10px 18px;background:var(--surface);border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:12px 18px;border-bottom:1px solid var(--line);vertical-align:middle}
tbody tr{transition:background-color .15s var(--ease)}
tbody tr:hover{background:rgba(255,255,255,.02)}
tbody tr:last-child td{border-bottom:0}
.num{text-align:center;font-variant-numeric:tabular-nums}
.member{display:flex;align-items:center;gap:12px;min-width:180px}
.avatar{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;font-weight:700;font-size:14px;flex-shrink:0;background:var(--muted-bg);color:var(--fg);border:1px solid var(--line-strong)}
.member-name{font-weight:600;display:flex;align-items:center;gap:6px}
.member-meta{font-size:12px;color:var(--subtle)}
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;color:var(--warn);background:var(--warn-soft)}
.status{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;white-space:nowrap}
.status::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.status.on{color:var(--ok)}
.status.off{color:var(--danger)}
.usage{min-width:190px}
.usage-line{display:flex;justify-content:space-between;gap:8px;font-size:13px;font-variant-numeric:tabular-nums}
.usage-line b{font-weight:600}
.usage-line .muted{font-size:12px}
.meter{height:6px;border-radius:999px;background:var(--muted-bg);overflow:hidden;margin-top:6px}
.meter i{display:block;height:100%;border-radius:inherit;background:var(--accent);transition:width .4s var(--ease)}
.meter.warn i{background:var(--warn)}
.meter.over i{background:var(--danger)}
.usage-note{font-size:11px;margin-top:3px;color:var(--subtle)}
.usage-note.warn{color:var(--warn)}
.usage-note.over{color:var(--danger)}
.actions{display:flex;gap:2px;justify-content:flex-end}
tr.is-disabled .member,tr.is-disabled .usage{opacity:.55}
.empty{padding:48px 18px;text-align:center;color:var(--muted)}
.empty strong{display:block;color:var(--fg);margin-bottom:4px}

/* skeleton */
.skel{height:12px;border-radius:6px;background:linear-gradient(90deg,var(--muted-bg) 0%,#323b50 50%,var(--muted-bg) 100%);background-size:200% 100%;animation:shimmer 1.2s linear infinite}
@keyframes shimmer{to{background-position:-200% 0}}

/* dialogs */
.dialog{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:16px;padding:24px;width:min(480px,calc(100vw - 32px));box-shadow:0 32px 64px -16px rgba(0,0,0,.6)}
.dialog-wide{width:min(600px,calc(100vw - 32px))}
.dialog-narrow{width:min(400px,calc(100vw - 32px))}
.dialog::backdrop{background:rgba(2,6,23,.72);backdrop-filter:blur(2px)}
.dialog[open]{animation:pop .2s var(--ease)}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.98)}}
.dialog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:20px}
.dialog-head .icon-btn{margin-block-start:-8px;margin-inline-end:-8px}
.dialog-narrow h2{margin-bottom:8px}
.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.callout{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:var(--radius-sm);background:var(--warn-soft);border:1px solid rgba(245,158,11,.3);color:#fcd34d;font-size:14px;margin-bottom:20px}
.callout [data-icon]{margin-top:2px}
.secret{display:flex;gap:6px;align-items:center}
.secret input{font-family:var(--mono);font-size:13px;text-align:left}
.secret .btn{min-width:88px}
.secret .btn.copied{color:var(--ok);border-color:var(--ok)}
.steps{margin:4px 0 0;padding-inline-start:20px;color:var(--muted);font-size:13px;display:grid;gap:4px}
.steps b{color:var(--fg);font-weight:600}

/* toasts */
.toasts{position:fixed;bottom:20px;inset-inline-start:50%;transform:translateX(50%);z-index:100;display:grid;gap:8px;width:min(420px,calc(100vw - 32px))}
.toast{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:var(--radius-sm);background:var(--card);border:1px solid var(--line-strong);box-shadow:0 12px 32px -8px rgba(0,0,0,.6);font-size:14px;animation:pop .2s var(--ease)}
.toast.ok [data-icon]{color:var(--ok)}
.toast.err{border-color:rgba(239,68,68,.5)}
.toast.err [data-icon]{color:var(--danger)}

/* responsive */
@media (max-width:900px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:720px){
  .container{padding:20px 16px 48px}
  .topbar-inner{padding:10px 16px}
  .chip{display:none}
  .page-head .btn{width:100%}
  .search{width:100%}
  .grid-2{grid-template-columns:1fr}
  thead{display:none}
  table,tbody,tr,td{display:block;width:100%}
  tbody tr{padding:14px 16px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr auto;gap:10px 12px}
  tbody tr:last-child{border-bottom:0}
  td{padding:0;border:0}
  td.c-member{grid-column:1}
  td.c-status{grid-column:2;justify-self:end;align-self:center}
  td.c-usage{grid-column:1 / -1}
  td.c-conc,td.c-gen{grid-column:auto;text-align:start;font-size:13px;color:var(--muted)}
  td.c-conc::before{content:"التزامن: "}
  td.c-gen::before{content:"توليدات: "}
  td.c-actions{grid-column:1 / -1;border-top:1px solid var(--line);padding-top:8px}
  .actions{justify-content:flex-start}
  .usage,.member{min-width:0}
}
@media (max-width:480px){
  .stats{gap:8px}
  .stat{padding:12px}
  .stat-value{font-size:20px}
  .stat-icon{display:none}
  .secret{flex-wrap:wrap}
  .secret input{flex:1 1 100%}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

export const SCRIPT = `(() => {
  "use strict";
  var KEY = "bc_admin_secret";
  var me = null;
  var users = [];
  var services = [];
  var $ = function (id) { return document.getElementById(id); };

  var P = {
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    rotate: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    enable: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    dollar: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
    spark: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'
  };
  function icon(name, size) {
    var s = size || 18;
    var span = document.createElement("span");
    span.setAttribute("data-icon", name);
    span.innerHTML = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[name] + "</svg>";
    return span;
  }
  function hydrateIcons(root) {
    root.querySelectorAll("[data-icon]:empty").forEach(function (n) { n.replaceWith(icon(n.getAttribute("data-icon"))); });
  }

  function el(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    var kids = Array.prototype.slice.call(arguments, 2).flat();
    kids.forEach(function (kid) { if (kid !== null && kid !== undefined && kid !== false) e.append(kid); });
    return e;
  }

  var usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var money = function (n) { var s = el("span", { dir: "ltr" }); s.textContent = usd.format(Number(n) || 0); return s; };
  var day = new Intl.DateTimeFormat("ar-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });

  function toast(msg, kind) {
    var t = el("div", { class: "toast " + (kind || "ok"), role: kind === "err" ? "alert" : "status" }, icon(kind === "err" ? "alert" : "check"), el("span", { text: msg }));
    $("toasts").append(t);
    setTimeout(function () { t.remove(); }, kind === "err" ? 6000 : 3500);
  }

  function setLoading(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle("is-loading", on);
    btn.setAttribute("aria-busy", on ? "true" : "false");
  }

  function api(method, path, body) {
    return fetch("/admin/api" + path, {
      method: method,
      headers: { "authorization": "Bearer " + (sessionStorage.getItem(KEY) || ""), "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && me) { logout(); throw new Error("انتهت الجلسة، ادخل من جديد"); }
        if (!res.ok) throw new Error(data.error || "صار خطأ غير متوقع");
        return data;
      });
    });
  }

  /* ---------- auth ---------- */
  function showLogin(msg) {
    $("app").hidden = true;
    $("login").hidden = false;
    $("login-error").textContent = msg || "";
    $("secret").setAttribute("aria-invalid", msg ? "true" : "false");
    $("secret").focus();
  }
  function logout() { sessionStorage.removeItem(KEY); me = null; showLogin(); }

  function start() {
    if (!sessionStorage.getItem(KEY)) { showLogin(); return Promise.resolve(); }
    return api("GET", "/me").then(function (data) {
      me = data;
      $("login").hidden = true;
      $("app").hidden = false;
      var who = $("who");
      who.replaceChildren(icon("shield", 14), el("span", { text: me.name }));
      renderSkeleton();
      return refresh();
    }).catch(function (e) { sessionStorage.removeItem(KEY); showLogin(e.message); });
  }

  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = $("secret").value.trim();
    if (!v) { showLogin("اكتب كلمة السر أو التوكن"); return; }
    var btn = $("login-btn");
    setLoading(btn, true);
    sessionStorage.setItem(KEY, v);
    start().then(function () { setLoading(btn, false); if (me) $("secret").value = ""; });
  });
  $("secret-toggle").addEventListener("click", function () {
    var inp = $("secret");
    var show = inp.type === "password";
    inp.type = show ? "text" : "password";
    this.setAttribute("aria-pressed", String(show));
    this.setAttribute("aria-label", show ? "إخفاء كلمة السر" : "إظهار كلمة السر");
    this.replaceChildren(icon(show ? "eyeOff" : "eye"));
  });
  $("logout").addEventListener("click", logout);

  /* ---------- data ---------- */
  function refresh() {
    return api("GET", "/overview").then(function (d) {
      users = d.users;
      services = d.services;
      $("month").textContent = d.month;
      renderStats(d);
      renderUsers();
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function stat(label, ic, value, sub) {
    return el("div", { class: "stat" },
      el("div", { class: "stat-top" }, el("span", { text: label }), el("span", { class: "stat-icon" }, icon(ic, 16))),
      el("div", { class: "stat-value" }, value),
      sub ? el("div", { class: "stat-sub" }, sub) : null);
  }

  function renderStats(d) {
    var active = d.users.filter(function (u) { return !u.disabled; }).length;
    var done = d.users.reduce(function (s, u) { return s + u.completed; }, 0);
    var failed = d.users.reduce(function (s, u) { return s + u.failed; }, 0);
    var running = d.users.reduce(function (s, u) { return s + u.running; }, 0);
    var budgetTotal = d.users.filter(function (u) { return !u.disabled; }).reduce(function (s, u) { return s + u.budget; }, 0);

    var spendSub;
    if (d.org.budget > 0) {
      var pct = Math.min(100, (d.org.spent / d.org.budget) * 100);
      var bar = el("i");
      bar.style.width = pct.toFixed(1) + "%";
      spendSub = el("span", {}, "من سقف ", money(d.org.budget), el("div", { class: "meter " + meterTone(pct) }, bar));
    } else {
      spendSub = el("span", {}, "بدون سقف للفريق");
    }
    var split = d.services.filter(function (s) { return s.configured || s.spent > 0; });
    if (split.length > 1) {
      spendSub = el("div", {}, spendSub, el("div", { class: "svc-split" }, split.map(function (s) {
        return el("span", {}, el("span", { class: "muted", text: s.label + " " }), money(s.spent));
      })));
    }

    $("stats").replaceChildren(
      stat("صرف الفريق", "dollar", money(d.org.spent), spendSub),
      stat("قيد التنفيذ", "spark", money(running), el("span", { text: "محجوز من ميزانيات الأعضاء" })),
      stat("توليدات ناجحة", "check", String(done), el("span", { text: failed ? failed + " فشلت (ما انحسبت)" : "ولا توليد فشل" })),
      stat("أعضاء نشطين", "users", el("span", {}, String(active), el("span", { class: "stat-of", text: " من " + d.users.length })), el("span", {}, "مجموع الميزانيات ", money(budgetTotal)))
    );
  }

  function meterTone(pct) { return pct >= 100 ? "over" : pct >= 80 ? "warn" : ""; }

  function initials(name) {
    var parts = name.trim().split(/\\s+/);
    var a = Array.from(parts[0] || "?")[0] || "?";
    var b = parts.length > 1 ? (Array.from(parts[1])[0] || "") : "";
    return (a + b).toUpperCase();
  }

  function renderSkeleton() {
    var rows = [];
    for (var i = 0; i < 3; i++) {
      var tr = el("tr", { "aria-hidden": "true" });
      for (var j = 0; j < 6; j++) tr.append(el("td", {}, el("div", { class: "skel" })));
      rows.push(tr);
    }
    $("users").replaceChildren.apply($("users"), rows);
  }

  function renderUsers() {
    var q = $("filter").value.trim().toLowerCase();
    var list = users.filter(function (u) { return !q || u.name.toLowerCase().indexOf(q) !== -1; });
    $("member-count").textContent = String(users.length);
    var body = $("users");
    if (!users.length) {
      body.replaceChildren(el("tr", {}, el("td", { colspan: "6", class: "empty" }, el("strong", { text: "ما في أعضاء لسا" }), el("span", { text: "اضغط «إضافة عضو» لتولّد أول رابط connector." }))));
      return;
    }
    if (!list.length) {
      body.replaceChildren(el("tr", {}, el("td", { colspan: "6", class: "empty" }, el("strong", { text: "ما في نتائج" }), el("span", { text: "ما في عضو اسمه بيحتوي «" + q + "»" }))));
      return;
    }
    body.replaceChildren.apply(body, list.map(row));
  }

  function row(u) {
    var spent = u.used + u.running;
    var pct = u.budget > 0 ? (spent / u.budget) * 100 : (spent > 0 ? 100 : 0);
    var tone = meterTone(pct);
    var bar = el("i");
    bar.style.width = Math.min(100, pct).toFixed(1) + "%";
    var isSelf = me && me.via === "user" && me.name === u.name;
    var left = Math.max(0, u.budget - spent);

    var note = null;
    if (tone === "over") note = el("div", { class: "usage-note over", text: "خلصت الميزانية، التوليدات الجديدة رح تنرفض" });
    else if (tone === "warn") note = el("div", { class: "usage-note warn" }, "قرّب يخلص · ضايل ", money(left));
    else if (u.running > 0) note = el("div", { class: "usage-note" }, money(u.running), " قيد التنفيذ");

    var actions = el("div", { class: "actions" },
      el("button", { type: "button", class: "icon-btn", title: "تعديل", "aria-label": "تعديل " + u.name, onclick: function () { openEdit(u); } }, icon("edit")),
      el("button", { type: "button", class: "icon-btn", title: "رابط جديد", "aria-label": "رابط جديد لـ " + u.name, onclick: function (e) { rotate(u, e.currentTarget); } }, icon("rotate")),
      isSelf ? null : el("button", {
        type: "button",
        class: "icon-btn " + (u.disabled ? "ok" : "danger"),
        title: u.disabled ? "تفعيل" : "إيقاف",
        "aria-label": (u.disabled ? "تفعيل " : "إيقاف ") + u.name,
        onclick: function (e) { toggleDisabled(u, e.currentTarget); }
      }, icon(u.disabled ? "enable" : "ban"))
    );

    return el("tr", { class: u.disabled ? "is-disabled" : "" },
      el("td", { class: "c-member" }, el("div", { class: "member" },
        el("span", { class: "avatar", "aria-hidden": "true", text: initials(u.name) }),
        el("div", {},
          el("div", { class: "member-name" }, el("span", { text: u.name }), u.role === "admin" ? el("span", { class: "badge", text: "أدمن" }) : null, isSelf ? el("span", { class: "muted small", text: "(انت)" }) : null),
          el("div", { class: "member-meta", text: "انضاف " + day.format(new Date(u.created_at)) }),
          el("div", { class: "chips" }, u.services.length
            ? u.services.map(function (id) { return el("span", { class: "svc-chip", text: serviceLabel(id) }); })
            : el("span", { class: "svc-chip warn", text: "بدون خدمات" }))))),
      el("td", { class: "c-status" }, el("span", { class: "status " + (u.disabled ? "off" : "on"), text: u.disabled ? "موقوف" : "نشط" })),
      el("td", { class: "c-usage" }, el("div", { class: "usage" },
        el("div", { class: "usage-line" }, el("b", {}, money(spent)), el("span", { class: "muted" }, "من ", money(u.budget))),
        el("div", { class: "meter " + tone, role: "meter", "aria-valuemin": "0", "aria-valuemax": String(u.budget), "aria-valuenow": spent.toFixed(2), "aria-label": "صرف " + u.name }, bar),
        note)),
      el("td", { class: "c-conc num", text: String(u.concurrency) }),
      el("td", { class: "c-gen num" }, el("span", { text: String(u.completed) }), u.failed ? el("div", { class: "usage-note", text: u.failed + " فشل" }) : null),
      el("td", { class: "c-actions" }, actions)
    );
  }

  $("filter").addEventListener("input", renderUsers);

  /* ---------- dialogs ---------- */
  document.addEventListener("click", function (e) {
    var close = e.target.closest && e.target.closest("[data-close]");
    if (close) close.closest("dialog").close();
  });
  document.querySelectorAll("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
  });

  function confirmBox(title, body, yesLabel, danger) {
    return new Promise(function (resolve) {
      var d = $("confirm-dialog");
      $("confirm-title").textContent = title;
      $("confirm-body").textContent = body;
      var yes = $("confirm-yes");
      yes.textContent = yesLabel;
      yes.className = "btn " + (danger ? "btn-danger" : "btn-primary");
      var done = function (v) { cleanup(); d.close(); resolve(v); };
      var onYes = function () { done(true); };
      var onNo = function () { done(false); };
      var onClose = function () { cleanup(); resolve(false); };
      function cleanup() {
        yes.removeEventListener("click", onYes);
        $("confirm-no").removeEventListener("click", onNo);
        d.removeEventListener("close", onClose);
      }
      yes.addEventListener("click", onYes);
      $("confirm-no").addEventListener("click", onNo);
      d.addEventListener("close", onClose);
      d.showModal();
      $("confirm-no").focus();
    });
  }

  function showLink(title, data) {
    $("link-title").textContent = title;
    $("link-sub").textContent = "العضو: " + data.name;
    $("link-url").value = data.connectorUrl;
    var base = data.connectorUrl.split("/mcp/u/")[0];
    $("link-cmd").value = 'claude mcp add --transport http bc-ai ' + base + '/mcp --header "Authorization: Bearer ' + data.token + '"';
    document.querySelectorAll("#link-dialog [data-secret]").forEach(resetSecret);
    $("link-dialog").showModal();
    $("link-dialog").querySelector("[data-copy]").focus();
  }
  $("link-dialog").addEventListener("close", function () { $("link-url").value = ""; $("link-cmd").value = ""; });

  function resetSecret(box) {
    var inp = box.querySelector("input");
    inp.type = "password";
    var r = box.querySelector("[data-reveal]");
    r.setAttribute("aria-pressed", "false");
    r.setAttribute("aria-label", "إظهار");
    r.replaceChildren(icon("eye"));
    var c = box.querySelector("[data-copy]");
    c.classList.remove("copied");
    c.replaceChildren(icon("copy"), el("span", { text: "نسخ" }));
  }

  document.addEventListener("click", function (e) {
    var reveal = e.target.closest && e.target.closest("[data-reveal]");
    if (reveal) {
      var inp = reveal.closest("[data-secret]").querySelector("input");
      var show = inp.type === "password";
      inp.type = show ? "text" : "password";
      reveal.setAttribute("aria-pressed", String(show));
      reveal.setAttribute("aria-label", show ? "إخفاء" : "إظهار");
      reveal.replaceChildren(icon(show ? "eyeOff" : "eye"));
      return;
    }
    var copy = e.target.closest && e.target.closest("[data-copy]");
    if (copy) {
      var input = copy.closest("[data-secret]").querySelector("input");
      var ok = function () {
        copy.classList.add("copied");
        copy.replaceChildren(icon("check"), el("span", { text: "انتسخ" }));
        setTimeout(function () { copy.classList.remove("copied"); copy.replaceChildren(icon("copy"), el("span", { text: "نسخ" })); }, 1800);
      };
      var fallback = function () {
        var prev = input.type; input.type = "text"; input.select();
        var worked = false;
        try { worked = document.execCommand("copy"); } catch (_) {}
        input.type = prev;
        if (worked) ok(); else toast("ما قدرنا ننسخ تلقائياً، اضغط إظهار وانسخه يدوياً", "err");
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(input.value).then(ok, fallback);
      else fallback();
    }
  });

  /* add */
  function renderServicePicker(box, selected) {
    var nodes = services.map(function (s) {
      var id = box.id + "-" + s.id;
      var cb = el("input", { type: "checkbox", id: id, value: s.id, class: "svc-check" });
      cb.checked = s.configured && selected.indexOf(s.id) !== -1;
      cb.disabled = !s.configured;
      return el("label", { class: "svc-option" + (s.configured ? "" : " is-off"), for: id }, cb,
        el("span", { class: "svc-text" }, el("strong", { text: s.label }), el("span", { class: "muted small", text: s.configured ? s.description : "مش مضبوطة على السيرفر لسا" })));
    });
    box.replaceChildren.apply(box, nodes);
  }
  function pickedServices(box) {
    return Array.prototype.map.call(box.querySelectorAll("input:checked"), function (x) { return x.value; });
  }
  function serviceLabel(id) {
    var s = services.find(function (x) { return x.id === id; });
    return s ? s.label : id;
  }

  $("open-add").addEventListener("click", function () {
    $("add-form").reset();
    renderServicePicker($("add-services"), services.filter(function (s) { return s.configured; }).map(function (s) { return s.id; }));
    $("add-error").textContent = "";
    $("add-name").setAttribute("aria-invalid", "false");
    $("add-dialog").showModal();
    $("add-name").focus();
  });
  $("add-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("add-name").value.trim();
    var err = $("add-error");
    err.textContent = "";
    if (!name) { err.textContent = "اكتب اسم العضو"; $("add-name").setAttribute("aria-invalid", "true"); $("add-name").focus(); return; }
    var picked = pickedServices($("add-services"));
    if (!picked.length) { err.textContent = "اختار خدمة وحدة عالأقل"; return; }
    var btn = e.submitter || this.querySelector("[type=submit]");
    setLoading(btn, true);
    api("POST", "/users", {
      name: name,
      budget: Number($("add-budget").value),
      concurrency: Number($("add-conc").value),
      admin: $("add-admin").checked,
      services: picked
    }).then(function (data) {
      $("add-dialog").close();
      showLink("العضو انضاف", data);
      return refresh();
    }).catch(function (x) { err.textContent = x.message; }).then(function () { setLoading(btn, false); });
  });

  /* edit */
  var editing = null;
  function openEdit(u) {
    editing = u;
    $("edit-title").textContent = "تعديل " + u.name;
    $("edit-budget").value = String(u.budget);
    $("edit-conc").value = String(u.concurrency);
    $("edit-admin").checked = u.role === "admin";
    $("edit-admin-row").hidden = Boolean(me && me.via === "user" && me.name === u.name);
    renderServicePicker($("edit-services"), u.services);
    $("edit-error").textContent = "";
    $("edit-dialog").showModal();
    $("edit-budget").focus();
  }
  $("edit-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!editing) return;
    var patch = { budget: Number($("edit-budget").value), concurrency: Number($("edit-conc").value) };
    if (!$("edit-admin-row").hidden) patch.role = $("edit-admin").checked ? "admin" : "member";
    // keep grants for services that aren't configured on the server yet (their boxes are disabled)
    var dormant = editing.services.filter(function (id) { return !services.some(function (s) { return s.id === id && s.configured; }); });
    patch.services = pickedServices($("edit-services")).concat(dormant);
    var btn = e.submitter || this.querySelector("[type=submit]");
    setLoading(btn, true);
    var name = editing.name;
    api("PATCH", "/users/" + editing.id, patch).then(function () {
      $("edit-dialog").close();
      toast("انحفظت تعديلات " + name);
      return refresh();
    }).catch(function (x) { $("edit-error").textContent = x.message; }).then(function () { setLoading(btn, false); });
  });

  /* rotate + disable */
  function rotate(u, btn) {
    confirmBox("رابط جديد لـ " + u.name + "؟", "الرابط الحالي رح يوقف فوراً، ولازم " + u.name + " يشيل الـ connector القديم من Claude ويضيف الجديد.", "توليد رابط جديد", false).then(function (yes) {
      if (!yes) return;
      btn.disabled = true;
      api("POST", "/users/" + u.id + "/rotate").then(function (data) { showLink("رابط جديد", data); })
        .catch(function (x) { toast(x.message, "err"); }).then(function () { btn.disabled = false; });
    });
  }
  function toggleDisabled(u, btn) {
    var p = u.disabled ? Promise.resolve(true) : confirmBox("إيقاف " + u.name + "؟", "الـ connector تبعه رح يوقف فوراً. بتقدر ترجع تفعّله بأي وقت وبيرجع يشتغل بنفس الرابط.", "إيقاف", true);
    p.then(function (yes) {
      if (!yes) return;
      btn.disabled = true;
      api("PATCH", "/users/" + u.id, { disabled: !u.disabled }).then(function () {
        toast(u.disabled ? "رجع " + u.name + " نشط" : "انوقف " + u.name);
        return refresh();
      }).catch(function (x) { toast(x.message, "err"); }).then(function () { btn.disabled = false; });
    });
  }

  hydrateIcons(document);
  start();
})();`;
