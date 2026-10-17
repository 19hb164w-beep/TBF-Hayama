// Firebase の設定（admin-guide.md の「初期設定」を参照）
// apiKey が空のあいだは「デモモード」：管理画面の操作はこのブラウザの中だけに保存されます。
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCVyFt_iXQ0QQbAsGz0C-XhSNzS9GUXvQg',
  authDomain: 'tbf-hayama.firebaseapp.com',
  projectId: 'tbf-hayama',
  storageBucket: 'tbf-hayama.firebasestorage.app',
  messagingSenderId: '804527479812',
  appId: '1:804527479812:web:f739cd561f6ade105de951',
};

// 管理画面にログインできるメールアドレス（firestore.rules にも同じものを書く）
export const ADMIN_EMAILS = [
  '19hb164w@gmail.com',
];
