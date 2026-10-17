// ページの文章・写真・メニュー・構成・色の差し替え（管理画面で保存された内容を反映）
// HTML に書かれている内容が初期値。保存された項目だけ上書きする。

// 管理画面が使うフック（お客様画面だけで開いたときは何もしない）
// decorateList: 描き直した一覧に操作ボタンを付ける / isDirty: 未保存の編集中なら上書きしない
// layoutOverride: デザインタブのプレビュー中の構成・色
export const hooks = { decorateList: null, isDirty: null, layoutOverride: null };

const menuDefaults = {};
let currentImages = {};

export function captureDefaults() {
  document.querySelectorAll('[data-edit]').forEach(el => {
    if (el.dataset.default === undefined) el.dataset.default = el.innerText.replace(/\n+$/, '');
  });
  // HTML に書かれた一覧（メニュー・イベント）を初期値として読み取り、編集できる形に組み直す
  document.querySelectorAll('[data-menu]').forEach(list => {
    if (menuDefaults[list.dataset.menu]) return;
    menuDefaults[list.dataset.menu] = serializeList(list);
    list.replaceChildren(...menuDefaults[list.dataset.menu].map(it => createItem(list, it)));
  });
  captureLayoutDefaults();
}

export function setImage(el, src) {
  if (src) {
    el.style.setProperty('--img', `url("${src}")`);
    el.classList.add('has-img');
  } else {
    el.style.removeProperty('--img');
    el.classList.remove('has-img');
  }
}

export function syncTel(el) {
  if (el.hasAttribute('data-tel')) el.href = 'tel:' + el.innerText.replace(/[^\d+]/g, '');
}

/* ---------- YouTube ---------- */
export function youtubeId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// data-youtube="URLを書く項目のキー" の枠に、動画を埋め込む
export function refreshVideos() {
  document.querySelectorAll('[data-youtube]').forEach(box => {
    const src = document.querySelector(`[data-edit="${box.dataset.youtube}"]`);
    const id = youtubeId(src?.innerText) || '';
    if (box.dataset.vid === id && box.firstChild) return;
    box.dataset.vid = id;
    box.classList.toggle('has-video', !!id);
    box.innerHTML = id
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube動画" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
      : '<span>YouTube の URL を入れると、ここに動画が表示されます</span>';
  });
}

/* ---------- 一覧（メニュー・イベント） ---------- */
const fieldText = (item, name) => (item.querySelector(`[data-field="${name}"]`)?.innerText || '').replace(/\n+$/, '').trim();
export const newId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toLowerCase();

export function serializeList(list) {
  const type = list.dataset.menuType;
  return [...list.querySelectorAll('[data-item]')].map(item => {
    if (type === 'event') {
      return { id: item.dataset.id, date: fieldText(item, 'date'), title: fieldText(item, 'title'), desc: fieldText(item, 'desc') };
    }
    const o = { name: fieldText(item, 'name'), price: fieldText(item, 'price') };
    if (type !== 'simple') {
      o.desc = fieldText(item, 'desc');
      o.tag = fieldText(item, 'tag');
    }
    return o;
  });
}

function field(tag, name, value, attrs = {}) {
  const el = document.createElement(tag);
  el.dataset.field = name;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerText = value || '';
  return el;
}

export function createItem(list, it = {}) {
  const type = list.dataset.menuType;
  if (type === 'event') {
    const id = it.id || newId();
    const art = document.createElement('article');
    art.className = 'event';
    art.dataset.item = '';
    art.dataset.id = id;
    const photo = document.createElement('div');
    photo.className = 'photo';
    photo.dataset.img = `ev-${id}`;
    photo.setAttribute('role', 'img');
    photo.setAttribute('aria-label', it.title || 'イベントの写真');
    photo.innerHTML = '<span>PHOTO</span>';
    const body = document.createElement('div');
    body.className = 'ev-body';
    body.append(
      field('p', 'date', it.date, { class: 'ev-date', 'data-single': '', 'data-ph': '日付（例：2026.12.06 SUN）' }),
      field('h3', 'title', it.title, { 'data-single': '', 'data-ph': 'イベント名' }),
      field('p', 'desc', it.desc, { class: 'ev-desc', 'data-ph': '内容（時間・場所・参加方法など）' }),
    );
    art.append(photo, body);
    return art;
  }
  if (type === 'simple') {
    const li = document.createElement('li');
    li.dataset.item = '';
    li.append(
      field('span', 'name', it.name, { 'data-single': '', 'data-ph': '品名' }),
      field('span', 'price', it.price, { class: 'price', 'data-single': '', 'data-ph': '¥価格' }),
    );
    return li;
  }
  const item = document.createElement('div');
  item.className = 'menu-item';
  item.dataset.item = '';
  const row = document.createElement('div');
  row.className = 'row';
  const h3 = document.createElement('h3');
  h3.append(
    field('span', 'name', it.name, { 'data-single': '', 'data-ph': '品名' }),
    field('span', 'tag', it.tag, { class: 'tag', 'data-single': '', 'data-ph': 'ラベル' }),
  );
  row.append(h3, field('span', 'price', it.price, { class: 'price', 'data-single': '', 'data-ph': '¥価格' }));
  item.append(row, field('p', 'desc', it.desc, { 'data-ph': '説明（任意）' }));
  return item;
}

export function renderList(list, items) {
  if (JSON.stringify(serializeList(list)) === JSON.stringify(items)) return;
  list.replaceChildren(...items.map(it => createItem(list, it)));
  list.querySelectorAll('[data-img]').forEach(el => setImage(el, currentImages[el.dataset.img]));
  hooks.decorateList?.(list);
}

/* ---------- 空欄の項目を隠す ---------- */
// 中身が空の「お知らせ」「ギャラリー」「動画」などをお客様画面では隠す
export function refreshOptional() {
  document.querySelectorAll('[data-optional]').forEach(el => {
    const mode = el.dataset.optional;
    const empty = mode === 'img' ? !el.querySelector('[data-img].has-img')
      : mode === 'video' ? !el.querySelector('[data-youtube].has-video')
      : [...el.querySelectorAll('[data-edit]')].every(x => !x.textContent.trim());
    el.classList.toggle('is-empty', empty);
  });
  document.querySelectorAll('[data-optional-group]').forEach(g => {
    g.classList.toggle('is-empty', [...g.querySelectorAll('[data-optional]')].every(x => x.classList.contains('is-empty')));
  });
  refreshSections();
}

export function applyContent({ texts = {}, images = {}, menu = {} }) {
  currentImages = images;
  for (const el of document.querySelectorAll('[data-edit]')) {
    const text = texts[el.dataset.edit] ?? el.dataset.default ?? '';
    if (el.innerText.replace(/\n+$/, '') !== text) el.innerText = text;
    syncTel(el);
  }
  for (const list of document.querySelectorAll('[data-menu]')) {
    renderList(list, menu[list.dataset.menu] ?? menuDefaults[list.dataset.menu] ?? []);
  }
  for (const el of document.querySelectorAll('[data-img]')) setImage(el, images[el.dataset.img]);
  refreshVideos();
  refreshOptional();
  document.dispatchEvent(new Event('tbf:content'));
}

/* ---------- 構成（セクションの順番・表示）と色 ---------- */
export const THEMES = {
  sea:    { label: '海（標準）',       main: '#1d4e6e', accent: '#c9a46a', paper: '#fbf9f5' },
  sumi:   { label: '墨と金（和モダン）', main: '#2e2e2e', accent: '#b8975a', paper: '#faf8f3' },
  sunset: { label: '夕凪（あたたか）',   main: '#a2482f', accent: '#e0a35b', paper: '#fffaf4' },
  leaf:   { label: '若葉（ナチュラル）', main: '#3f6b4a', accent: '#c2a15a', paper: '#fafaf5' },
  sky:    { label: '藍白（さわやか）',   main: '#2f6fa3', accent: '#f2b84b', paper: '#ffffff' },
};
export const DEFAULT_THEME = { preset: 'sea', main: THEMES.sea.main, accent: THEMES.sea.accent, paper: THEMES.sea.paper };

let defaultOrder = [];
function sectionsRoot() { return document.getElementById('sections'); }

function captureLayoutDefaults() {
  const root = sectionsRoot();
  if (!root || defaultOrder.length) return;
  defaultOrder = [...root.querySelectorAll(':scope > [data-section]')].map(s => s.dataset.section);
}

// 管理画面の一覧用：今のページにあるセクション（初期の順番・名前）
export function sectionCatalog() {
  return defaultOrder.map(id => {
    const s = document.querySelector(`[data-section="${id}"]`);
    return { id, label: s.dataset.label, defaultHidden: s.hasAttribute('data-default-hidden') };
  });
}

export function normalizeLayout(layout) {
  layout = layout || {};
  const known = new Set(defaultOrder);
  const order = (layout.order || []).filter(id => known.has(id));
  for (const id of defaultOrder) if (!order.includes(id)) order.push(id); // 後から増えたセクションは末尾に
  const hidden = layout.hidden
    ? layout.hidden.filter(id => known.has(id))
    : defaultOrder.filter(id => document.querySelector(`[data-section="${id}"]`).hasAttribute('data-default-hidden'));
  const t = { ...DEFAULT_THEME, ...(layout.theme || {}) };
  return { order, hidden, theme: { preset: t.preset, main: t.main, accent: t.accent, paper: t.paper } };
}

export function applyTheme(theme) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const r = document.documentElement.style;
  r.setProperty('--sea', t.main);
  r.setProperty('--shell', t.accent);
  r.setProperty('--paper', t.paper);
}

export function applyLayout(layout) {
  const root = sectionsRoot();
  if (!root) return;
  const { order, hidden, theme } = normalizeLayout(layout);
  for (const id of order) {
    const sec = root.querySelector(`:scope > [data-section="${id}"]`);
    if (sec) root.appendChild(sec);
  }
  const off = new Set(hidden);
  root.querySelectorAll(':scope > [data-section]').forEach(s => s.classList.toggle('is-off', off.has(s.dataset.section)));
  applyTheme(theme);
  refreshSections();
}

// 表示中のセクションに交互の背景色を付け、メニュー（ナビ）を作り直す
export function refreshSections() {
  const root = sectionsRoot();
  if (!root) return;
  const visible = [...root.querySelectorAll(':scope > [data-section]')].filter(s => getComputedStyle(s).display !== 'none');
  let alt = false;
  for (const s of visible) {
    if (s.hasAttribute('data-band')) { alt = false; continue; } // 濃い色の帯は交互の対象外
    s.classList.toggle('alt', alt);
    alt = !alt;
  }
  const nav = document.getElementById('navList');
  if (nav) {
    nav.innerHTML = visible.filter(s => s.dataset.nav)
      .map(s => `<li><a href="#${s.id}"><span class="en">${s.dataset.nav}</span>${s.dataset.label}</a></li>`).join('');
  }
}
