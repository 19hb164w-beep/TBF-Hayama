// 臨時休業などの「例外」データの読み書きと、管理者ログイン
// Firebase 未設定ならデモモード（localStorage）で動く
import { FIREBASE_CONFIG, ADMIN_EMAILS } from './config.js';

export const isDemo = !FIREBASE_CONFIG.apiKey;

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const DEMO_KEY = 'tbf-hayama-demo-exceptions';
const DEMO_SESSION = 'tbf-hayama-demo-login';
const COLLECTION = 'exceptions';

let fbPromise = null;
function firebase() {
  fbPromise ||= (async () => {
    const [{ initializeApp }, fs, au] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-firestore.js`),
      import(`${SDK}/firebase-auth.js`),
    ]);
    const app = initializeApp(FIREBASE_CONFIG);
    return { fs, au, db: fs.getFirestore(app), auth: au.getAuth(app) };
  })();
  return fbPromise;
}

/* ---------- お客様画面用の軽い読み込み ----------
   お客様画面では Firebase のプログラム一式（数百KB）を読み込まず、
   データだけを直接取りに行く（スマホの回線でも速く表示するため）。書き込みは管理画面のみ。 */
const DOC_ROOT = `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const REST = `https://firestore.googleapis.com/v1/${DOC_ROOT}`;
const KEY = `key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;

function decodeValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields);
  return null;
}
const decodeFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, decodeValue(v)]));
const docId = name => decodeURIComponent(name.split('/').pop());

async function restJSON(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { code: r.status });
  return r.json();
}

// 文言・メニュー（写真以外）と、構成・色をまとめて1回で取得
export async function fetchSite() {
  if (isDemo) {
    const c = demoReadContent();
    return { content: { texts: c.texts, menu: c.menu }, layout: demoReadLayout() };
  }
  const res = await restJSON(`https://firestore.googleapis.com/v1/${DOC_ROOT}:batchGet?${KEY}`, {
    documents: [`${DOC_ROOT}/site/content`, `${DOC_ROOT}/site/layout`],
  });
  const out = { content: { texts: {}, menu: {} }, layout: null };
  for (const r of res) {
    if (!r.found) continue;
    const data = decodeFields(r.found.fields);
    if (r.found.name.endsWith('/site/content')) out.content = { texts: data.texts || {}, menu: data.menu || {} };
    else out.layout = { order: data.order, hidden: data.hidden, theme: data.theme };
  }
  return out;
}

// 写真（容量が大きいので、文言を表示したあとに取得）
export async function fetchImages() {
  if (isDemo) return demoReadContent().images;
  const images = {};
  let token = '';
  do {
    const res = await restJSON(`${REST}/images?pageSize=50&${KEY}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    for (const d of res.documents || []) images[docId(d.name)] = decodeFields(d.fields).data;
    token = res.nextPageToken || '';
  } while (token);
  return images;
}

// fromDate 以降の臨時休業など
export async function fetchExceptions(fromDate) {
  if (isDemo) return demoRead().filter(e => e.date >= fromDate);
  const res = await restJSON(`${REST}:runQuery?${KEY}`, {
    structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: fromDate } } },
    },
  });
  return res.filter(r => r.document).map(r => {
    const data = decodeFields(r.document.fields);
    return { ...data, id: docId(r.document.name), createdAt: data.createdAt || 0 };
  });
}

/* ---------- デモモード用 ---------- */
const demoListeners = new Set();
function demoRead() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; }
}
function demoWrite(list) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(list)); } catch (e) { throw new Error('このブラウザでは保存できません'); }
  demoListeners.forEach(fn => fn());
}

/* ---------- 読み込み（お客様画面・管理画面共通） ---------- */
// fromDate 以降の例外を購読し、変更があるたびに cb(list) を呼ぶ
export async function watchExceptions(fromDate, cb, onError) {
  if (isDemo) {
    const emit = () => cb(demoRead().filter(e => e.date >= fromDate));
    demoListeners.add(emit);
    window.addEventListener('storage', e => { if (e.key === DEMO_KEY) emit(); });
    emit();
    return;
  }
  try {
    const { fs, db } = await firebase();
    const q = fs.query(fs.collection(db, COLLECTION), fs.where('date', '>=', fromDate));
    fs.onSnapshot(q, snap => {
      cb(snap.docs.map(d => {
        const data = d.data();
        return { ...data, id: d.id, createdAt: data.createdAt?.toMillis?.() ?? Date.now() };
      }));
    }, err => onError?.(err));
  } catch (err) {
    onError?.(err);
  }
}

/* ---------- 書き込み（管理画面のみ） ---------- */
// icon: カレンダーのマスに出す絵文字 / label: マスに出す短い文字（空なら自動）
export async function addException({ date, kind, hours = '', note = '', icon = '', label = '' }) {
  const item = { date, kind, hours, note, icon, label };
  if (isDemo) {
    demoWrite([...demoRead(), { ...item, id: crypto.randomUUID(), createdAt: Date.now() }]);
    return;
  }
  const { fs, db } = await firebase();
  await fs.addDoc(fs.collection(db, COLLECTION), { ...item, createdAt: fs.serverTimestamp() });
}

export async function removeException(id) {
  if (isDemo) {
    demoWrite(demoRead().filter(e => e.id !== id));
    return;
  }
  const { fs, db } = await firebase();
  await fs.deleteDoc(fs.doc(db, COLLECTION, id));
}

/* ---------- ページの文章・写真 ---------- */
// 文章は site/content の texts に、写真は images/{key} に1枚ずつ保存
const DEMO_CONTENT_KEY = 'tbf-hayama-demo-content';
const contentListeners = new Set();

function demoReadContent() {
  try {
    const c = JSON.parse(localStorage.getItem(DEMO_CONTENT_KEY) || '{}');
    return { texts: c.texts || {}, images: c.images || {}, menu: c.menu || {} };
  } catch (e) { return { texts: {}, images: {}, menu: {} }; }
}

export async function watchContent(cb, onError) {
  if (isDemo) {
    const emit = () => cb(demoReadContent());
    contentListeners.add(emit);
    window.addEventListener('storage', e => { if (e.key === DEMO_CONTENT_KEY) emit(); });
    emit();
    return;
  }
  try {
    const { fs, db } = await firebase();
    const state = { texts: {}, images: {}, menu: {} };
    // 文言が届いた時点でまず知らせ、写真（容量が大きい）は届いたあとにもう一度知らせる
    let gotTexts = false;
    const emit = () => { if (gotTexts) cb({ texts: { ...state.texts }, images: { ...state.images }, menu: { ...state.menu } }); };
    fs.onSnapshot(fs.doc(db, 'site', 'content'), snap => {
      const data = snap.exists() ? snap.data() : {};
      state.texts = data.texts || {};
      state.menu = data.menu || {};
      gotTexts = true; emit();
    }, err => onError?.(err));
    fs.onSnapshot(fs.collection(db, 'images'), snap => {
      state.images = Object.fromEntries(snap.docs.map(d => [d.id, d.data().data]));
      emit();
    }, err => onError?.(err));
  } catch (err) {
    onError?.(err);
  }
}

// texts: { key: 文字列 }、images: { key: dataURL または null（削除） }、menu: { 一覧名: [品目…] }
export async function saveContent({ texts = {}, images = {}, menu = {} }) {
  if (isDemo) {
    const c = demoReadContent();
    Object.assign(c.texts, texts);
    Object.assign(c.menu, menu);
    for (const [k, v] of Object.entries(images)) { if (v) c.images[k] = v; else delete c.images[k]; }
    try { localStorage.setItem(DEMO_CONTENT_KEY, JSON.stringify(c)); }
    catch (e) { throw Object.assign(new Error('quota'), { code: 'quota' }); }
    contentListeners.forEach(fn => fn());
    return;
  }
  const { fs, db } = await firebase();
  if (Object.keys(texts).length || Object.keys(menu).length) {
    // merge なので texts は項目ごとに上書き、menu は一覧ごとに丸ごと置き換え
    await fs.setDoc(fs.doc(db, 'site', 'content'), { texts, menu, updatedAt: fs.serverTimestamp() }, { merge: true });
  }
  for (const [k, v] of Object.entries(images)) {
    if (v) await fs.setDoc(fs.doc(db, 'images', k), { data: v, updatedAt: fs.serverTimestamp() });
    else await fs.deleteDoc(fs.doc(db, 'images', k));
  }
}

/* ---------- 構成（セクションの順番・表示）と色 ---------- */
// site/layout に { order: [...], hidden: [...], theme: { preset, main, accent, paper } } を保存
const DEMO_LAYOUT_KEY = 'tbf-hayama-demo-layout';
const layoutListeners = new Set();

function demoReadLayout() {
  try { return JSON.parse(localStorage.getItem(DEMO_LAYOUT_KEY) || 'null'); } catch (e) { return null; }
}

// 保存された構成を購読する（未保存なら null）
export async function watchLayout(cb, onError) {
  if (isDemo) {
    const emit = () => cb(demoReadLayout());
    layoutListeners.add(emit);
    window.addEventListener('storage', e => { if (e.key === DEMO_LAYOUT_KEY) emit(); });
    emit();
    return;
  }
  try {
    const { fs, db } = await firebase();
    fs.onSnapshot(fs.doc(db, 'site', 'layout'), snap => {
      if (!snap.exists()) { cb(null); return; }
      const { order, hidden, theme } = snap.data();
      cb({ order, hidden, theme });
    }, err => onError?.(err));
  } catch (err) {
    onError?.(err);
  }
}

export async function saveLayout({ order, hidden, theme }) {
  const data = { order, hidden, theme };
  if (isDemo) {
    try { localStorage.setItem(DEMO_LAYOUT_KEY, JSON.stringify(data)); } catch (e) { throw Object.assign(new Error('quota'), { code: 'quota' }); }
    layoutListeners.forEach(fn => fn());
    return;
  }
  const { fs, db } = await firebase();
  await fs.setDoc(fs.doc(db, 'site', 'layout'), { ...data, updatedAt: fs.serverTimestamp() });
}

// 写真を縮小して JPEG の dataURL にする（スマホの大きな写真もそのまま選べるように）
export const IMAGE_LIMIT = isDemo ? 450_000 : 900_000; // dataURL の文字数（Firestore の1件 1MB 制限より小さく）
export function compressImage(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let side = maxSide;
      for (let attempt = 0; attempt < 6; attempt++) {
        const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const q of [0.82, 0.7, 0.58]) {
          const data = canvas.toDataURL('image/jpeg', q);
          if (data.length <= IMAGE_LIMIT) { resolve(data); return; }
        }
        side = Math.round(side * 0.75);
      }
      reject(new Error('too-large'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not-image')); };
    img.src = url;
  });
}

/* ---------- ログイン ---------- */
// 管理者は2種類：
//  ・オーナー：js/config.js の ADMIN_EMAILS（常に管理者。管理画面からは削除できない）
//  ・追加の管理者：管理画面の「管理者」タブで追加（Firestore の admins/{メールアドレス} に保存）
const lower = s => String(s || '').trim().toLowerCase();
export const isOwnerEmail = email => ADMIN_EMAILS.map(lower).includes(lower(email));
export const OWNER_EMAILS = ADMIN_EMAILS.map(lower);

export async function checkAdmin(user) {
  if (!user) return false;
  if (isDemo || isOwnerEmail(user.email)) return true;
  try {
    const { fs, db } = await firebase();
    return (await fs.getDoc(fs.doc(db, 'admins', lower(user.email)))).exists();
  } catch (e) {
    return false; // 管理者でなければ読み取りも許可されない
  }
}

// cb(管理者ならユーザー / それ以外は null, ログイン中のユーザー)
export async function watchAuth(cb) {
  if (isDemo) {
    let on = false;
    try { on = sessionStorage.getItem(DEMO_SESSION) === '1'; } catch (e) {}
    const u = on ? { email: OWNER_EMAILS[0] || 'デモ管理者' } : null;
    cb(u, u);
    return;
  }
  const { au, auth } = await firebase();
  au.onAuthStateChanged(auth, async user => cb(await checkAdmin(user) ? user : null, user));
}

export async function login(email, password) {
  if (isDemo) {
    try { sessionStorage.setItem(DEMO_SESSION, '1'); } catch (e) {}
    return { email: OWNER_EMAILS[0] || 'デモ管理者' };
  }
  const { au, auth } = await firebase();
  const cred = await au.signInWithEmailAndPassword(auth, email, password);
  if (!await checkAdmin(cred.user)) {
    await au.signOut(auth);
    throw Object.assign(new Error('not-admin'), { code: 'not-admin' });
  }
  return cred.user;
}

export async function currentEmail() {
  if (isDemo) return OWNER_EMAILS[0] || 'デモ管理者';
  const { auth } = await firebase();
  return lower(auth.currentUser?.email);
}

/* ---------- 管理者の追加・削除 ---------- */
const DEMO_ADMINS_KEY = 'tbf-hayama-demo-admins';
const adminListeners = new Set();
function demoReadAdmins() {
  try { return JSON.parse(localStorage.getItem(DEMO_ADMINS_KEY) || '[]'); } catch (e) { return []; }
}
function demoWriteAdmins(list) {
  try { localStorage.setItem(DEMO_ADMINS_KEY, JSON.stringify(list)); } catch (e) {}
  adminListeners.forEach(fn => fn());
}

// 追加された管理者の一覧（オーナーは含まない）
export async function watchAdmins(cb, onError) {
  if (isDemo) {
    const emit = () => cb(demoReadAdmins());
    adminListeners.add(emit);
    emit();
    return;
  }
  try {
    const { fs, db } = await firebase();
    fs.onSnapshot(fs.collection(db, 'admins'), snap => {
      cb(snap.docs.map(d => ({ ...d.data(), email: d.id, createdAt: d.data().createdAt?.toMillis?.() ?? Date.now() })));
    }, err => onError?.(err));
  } catch (err) {
    onError?.(err);
  }
}

// ログインできるアカウントを作り、管理者として登録する。
// すでに Firebase にあるメールアドレスのときは code 'exists' のエラーにする（allowExisting で登録だけ行う）
let creatorAuth = null;
export async function addAdmin(email, password, { allowExisting = false } = {}) {
  const key = lower(email);
  if (isDemo) {
    if (demoReadAdmins().some(a => a.email === key) || isOwnerEmail(key)) throw Object.assign(new Error('already-admin'), { code: 'already-admin' });
    demoWriteAdmins([...demoReadAdmins(), { email: key, addedBy: OWNER_EMAILS[0] || 'デモ管理者', createdAt: Date.now() }]);
    return;
  }
  const { fs, au, db, auth } = await firebase();
  if (isOwnerEmail(key) || (await fs.getDoc(fs.doc(db, 'admins', key))).exists()) {
    throw Object.assign(new Error('already-admin'), { code: 'already-admin' });
  }
  // 自分のログイン状態を変えないよう、アカウント作成は別の接続で行う
  if (!creatorAuth) {
    const { initializeApp, getApps } = await import(`${SDK}/firebase-app.js`);
    const app2 = getApps().find(a => a.name === 'admin-creator') || initializeApp(FIREBASE_CONFIG, 'admin-creator');
    creatorAuth = au.getAuth(app2);
  }
  try {
    await au.createUserWithEmailAndPassword(creatorAuth, key, password);
    await au.signOut(creatorAuth);
  } catch (e) {
    if (e.code !== 'auth/email-already-in-use') throw e;
    if (!allowExisting) throw Object.assign(new Error('exists'), { code: 'exists' });
  }
  await fs.setDoc(fs.doc(db, 'admins', key), { email: key, addedBy: lower(auth.currentUser?.email), createdAt: fs.serverTimestamp() });
}

export async function removeAdmin(email) {
  const key = lower(email);
  if (isDemo) { demoWriteAdmins(demoReadAdmins().filter(a => a.email !== key)); return; }
  const { fs, db } = await firebase();
  await fs.deleteDoc(fs.doc(db, 'admins', key));
}

export async function logout() {
  if (isDemo) {
    try { sessionStorage.removeItem(DEMO_SESSION); } catch (e) {}
    return;
  }
  const { au, auth } = await firebase();
  await au.signOut(auth);
}
