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
export async function addException({ date, kind, hours = '', note = '' }) {
  const item = { date, kind, hours, note };
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
    let gotTexts = false, gotImages = false;
    const emit = () => { if (gotTexts && gotImages) cb({ texts: { ...state.texts }, images: { ...state.images }, menu: { ...state.menu } }); };
    fs.onSnapshot(fs.doc(db, 'site', 'content'), snap => {
      const data = snap.exists() ? snap.data() : {};
      state.texts = data.texts || {};
      state.menu = data.menu || {};
      gotTexts = true; emit();
    }, err => onError?.(err));
    fs.onSnapshot(fs.collection(db, 'images'), snap => {
      state.images = Object.fromEntries(snap.docs.map(d => [d.id, d.data().data]));
      gotImages = true; emit();
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
export const isAdminEmail = email => ADMIN_EMAILS.map(e => e.toLowerCase()).includes(String(email || '').toLowerCase());

export async function watchAuth(cb) {
  if (isDemo) {
    let on = false;
    try { on = sessionStorage.getItem(DEMO_SESSION) === '1'; } catch (e) {}
    cb(on ? { email: 'デモ管理者' } : null);
    return;
  }
  const { au, auth } = await firebase();
  au.onAuthStateChanged(auth, user => cb(user));
}

export async function login(email, password) {
  if (isDemo) {
    try { sessionStorage.setItem(DEMO_SESSION, '1'); } catch (e) {}
    return { email: 'デモ管理者' };
  }
  const { au, auth } = await firebase();
  const cred = await au.signInWithEmailAndPassword(auth, email, password);
  if (!isAdminEmail(cred.user.email)) {
    await au.signOut(auth);
    throw Object.assign(new Error('not-admin'), { code: 'not-admin' });
  }
  return cred.user;
}

export async function logout() {
  if (isDemo) {
    try { sessionStorage.removeItem(DEMO_SESSION); } catch (e) {}
    return;
  }
  const { au, auth } = await firebase();
  await au.signOut(auth);
}
