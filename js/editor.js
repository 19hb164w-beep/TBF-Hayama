// ページ編集機能（管理画面 admin.html の「ページ編集」タブの中だけで使う）
// 管理画面が、枠の中に表示したお客様画面にこのファイルを読み込ませて起動する。
// お客様画面（index.html）単体ではこのファイルは読み込まれない。
// 点線の部分をタップして文章を書き換え、写真やメニューの品目を変え、「保存して公開」で反映する。
import { isDemo, watchAuth, saveContent, compressImage } from './store.js';
import { hooks, setImage, syncTel, refreshOptional, refreshVideos, serializeList, createItem } from './content.js';

export const editorState = { dirty: false };
const texts = {}, images = {};
const menuDirty = new Set();
let bar, saveBtn, countEl, toastEl, toastTimer;

const EDITABLE = '[data-edit], [data-field]';
// 一覧の品目の「名前」にあたる項目（メニューは品名、イベントはイベント名）
const NAME_FIELD = '[data-field="name"], [data-field="title"]';
const clean = el => el.innerText.replace(/\n+$/, '');

function toast(msg, error = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', error);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

function updateCount() {
  const n = Object.keys(texts).length + Object.keys(images).length + menuDirty.size;
  editorState.dirty = n > 0;
  countEl.textContent = n ? `変更 ${n} か所（まだ公開されていません）` : '点線の部分をタップすると書き換えられます';
  countEl.classList.toggle('pending', n > 0);
  saveBtn.disabled = n === 0;
}

function buildBar() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/editor.css';
  document.head.appendChild(link);

  bar = document.createElement('div');
  bar.className = 'ed-bar';
  bar.innerHTML = `
    <div class="ed-msg"><b>ページ編集${isDemo ? '（デモ）' : ''}</b><span class="ed-count">確認しています…</span></div>
    <div class="ed-actions">
      <button type="button" class="ed-btn ghost" id="edCancel">元に戻す</button>
      <button type="button" class="ed-btn primary" id="edSave" disabled>保存して公開</button>
    </div>`;
  document.body.appendChild(bar);
  toastEl = document.createElement('div');
  toastEl.className = 'ed-toast';
  toastEl.setAttribute('role', 'status');
  document.body.appendChild(toastEl);
  saveBtn = bar.querySelector('#edSave');
  countEl = bar.querySelector('.ed-count');
}

function makeEditable(el) {
  if (el.isContentEditable) return;
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.spellcheck = false;
  if (!el.dataset.ph) el.dataset.ph = '（ここに入力）';
}

/* ---------- メニュー：品目ごとの「↑ ↓ 削除」と「＋ 品目を追加」 ---------- */
function decorateList(list) {
  list.querySelectorAll(EDITABLE).forEach(makeEditable);
  list.querySelectorAll('[data-img]').forEach(slot => { if (!slot.querySelector('.ed-img')) setupImageSlot(slot); });
  for (const item of list.querySelectorAll('[data-item]')) {
    if (item.querySelector(':scope > .ed-item')) continue;
    const ctl = document.createElement('div');
    ctl.className = 'ed-item';
    ctl.innerHTML = `
      <button type="button" class="ed-mini" data-act="up" aria-label="上へ移動">↑</button>
      <button type="button" class="ed-mini" data-act="down" aria-label="下へ移動">↓</button>
      <button type="button" class="ed-mini danger" data-act="del">削除</button>`;
    item.appendChild(ctl);
  }
  if (!list.nextElementSibling?.classList.contains('ed-add')) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'ed-add';
    add.textContent = list.dataset.menuType === 'event' ? '＋ イベントを追加' : '＋ 品目を追加';
    list.after(add);
    add.addEventListener('click', () => {
      const item = createItem(list);
      list.appendChild(item);
      decorateList(list);
      markMenu(list);
      item.scrollIntoView({ block: 'center', behavior: 'smooth' });
      item.querySelector(NAME_FIELD).focus();
    });
  }
}

function markMenu(list) {
  menuDirty.add(list.dataset.menu);
  updateCount();
}

function onItemAction(e) {
  const btn = e.target.closest('.ed-item button');
  if (!btn) return;
  const item = btn.closest('[data-item]');
  const list = item.closest('[data-menu]');
  const act = btn.dataset.act;
  if (act === 'up' && item.previousElementSibling) list.insertBefore(item, item.previousElementSibling);
  else if (act === 'down' && item.nextElementSibling) list.insertBefore(item.nextElementSibling, item);
  else if (act === 'del') {
    const name = item.querySelector(NAME_FIELD).innerText.trim() || 'この項目';
    if (!confirm(`「${name}」を削除しますか？（「保存して公開」を押すまでお客様には反映されません）`)) return;
    // イベントの写真も一緒に削除する
    item.querySelectorAll('[data-img]').forEach(slot => { images[slot.dataset.img] = null; });
    item.remove();
  } else return;
  markMenu(list);
}

/* ---------- 写真 ---------- */
function setupImageSlot(slot) {
  const ctl = document.createElement('div');
  ctl.className = 'ed-img';
  ctl.innerHTML = `
    <label class="ed-btn primary"><span>📷 写真を追加</span><input type="file" accept="image/*" hidden></label>
    <button type="button" class="ed-btn ghost ed-del" hidden>削除</button>`;
  slot.appendChild(ctl);
  const label = ctl.querySelector('label');
  const input = ctl.querySelector('input');
  const del = ctl.querySelector('.ed-del');
  const refresh = () => {
    const has = slot.classList.contains('has-img');
    label.querySelector('span').textContent = `📷 写真を${has ? '変更' : '追加'}`;
    del.hidden = !has;
    refreshOptional();
  };
  refresh();
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    label.classList.add('busy');
    try {
      const data = await compressImage(file);
      setImage(slot, data);
      images[slot.dataset.img] = data;
      updateCount();
      refresh();
    } catch (e) {
      toast(e.message === 'not-image' ? '写真として読み込めませんでした。別の写真を選んでください。' : '写真が大きすぎます。別の写真を選んでください。', true);
    } finally {
      label.classList.remove('busy');
    }
  });
  del.addEventListener('click', () => {
    if (!confirm('この写真を削除しますか？（「保存して公開」を押すまでお客様には反映されません）')) return;
    setImage(slot, null);
    images[slot.dataset.img] = null;
    updateCount();
    refresh();
  });
}

/* ---------- 保存 ---------- */
async function save() {
  // 品名が空の品目があれば、保存前に知らせる
  for (const key of menuDirty) {
    const list = document.querySelector(`[data-menu="${key}"]`);
    const blank = [...list.querySelectorAll('[data-item]')].find(it => !it.querySelector(NAME_FIELD).innerText.trim());
    if (blank) {
      blank.scrollIntoView({ block: 'center', behavior: 'smooth' });
      blank.querySelector(NAME_FIELD).focus();
      toast(list.dataset.menuType === 'event'
        ? 'イベント名が入っていないイベントがあります。入力するか「削除」してください。'
        : '品名が入っていない品目があります。入力するか「削除」してください。', true);
      return;
    }
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '保存中…';
  const menu = {};
  for (const key of menuDirty) menu[key] = serializeList(document.querySelector(`[data-menu="${key}"]`));
  try {
    await saveContent({ texts: { ...texts }, images: { ...images }, menu });
    for (const k of Object.keys(texts)) {
      const el = document.querySelector(`[data-edit="${CSS.escape(k)}"]`);
      if (el) el.dataset.saved = texts[k];
      delete texts[k];
    }
    for (const k of Object.keys(images)) delete images[k];
    menuDirty.clear();
    updateCount();
    toast('保存しました。お客様の画面に反映されました。');
  } catch (e) {
    toast(e.code === 'quota' ? '写真の容量がいっぱいです（デモモードの制限）。写真を減らしてください。'
      : e.code === 'permission-denied' ? '保存できませんでした（管理権限がありません）。'
      : '保存できませんでした。通信状況を確認してもう一度お試しください。', true);
    updateCount();
  } finally {
    saveBtn.textContent = '保存して公開';
  }
}

/* ---------- 編集モード開始 ---------- */
function enable() {
  document.body.classList.add('editing');
  document.querySelectorAll('.fade').forEach(el => el.classList.add('show'));

  document.querySelectorAll('[data-edit]').forEach(makeEditable);
  document.querySelectorAll('[data-menu]').forEach(decorateList);
  hooks.decorateList = decorateList;
  hooks.isDirty = () => editorState.dirty;
  document.querySelectorAll('[data-img]').forEach(setupImageSlot);

  // 文章の入力（あとから追加された品目にも効くよう、ページ全体で受ける）
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-edit]');
    if (el && el.dataset.saved === undefined) el.dataset.saved = clean(el);
  });
  document.addEventListener('input', e => {
    const el = e.target.closest?.(EDITABLE);
    if (!el) return;
    if (el.hasAttribute('data-edit')) {
      const v = clean(el);
      if (v === (el.dataset.saved ?? el.dataset.default)) delete texts[el.dataset.edit];
      else texts[el.dataset.edit] = v;
      syncTel(el);
      refreshVideos();
      updateCount();
    } else {
      markMenu(el.closest('[data-menu]'));
    }
  });
  document.addEventListener('keydown', e => {
    const el = e.target.closest?.(EDITABLE);
    if (el && e.key === 'Enter' && el.hasAttribute('data-single')) { e.preventDefault(); el.blur(); }
  });
  document.addEventListener('paste', e => {
    const el = e.target.closest?.(EDITABLE);
    if (!el) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, el.hasAttribute('data-single') ? text.replace(/\s*\n\s*/g, ' ') : text);
  });
  document.addEventListener('click', onItemAction);

  // 編集中はリンクで別ページに飛ばないようにする
  document.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a || bar.contains(a)) return;
    if (a.closest(EDITABLE) || a.matches(EDITABLE) || !a.getAttribute('href')?.startsWith('#')) e.preventDefault();
  }, true);

  window.addEventListener('beforeunload', e => {
    if (editorState.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  saveBtn.addEventListener('click', save);
  bar.querySelector('#edCancel').addEventListener('click', () => {
    if (editorState.dirty && !confirm('保存していない変更を取り消して、元に戻しますか？')) return;
    editorState.dirty = false;
    location.reload();
  });

  updateCount();
}

let started = false;
export function startEditor() {
  // 管理者としてログインしているときだけ編集できる（保存の可否は Firebase のルールでも判定）
  watchAuth(adminUser => {
    if (started || !adminUser) return;
    started = true;
    buildBar();
    enable();
  });
}
