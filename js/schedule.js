// 営業日・営業時間の判定（お客様画面と管理画面で共通）

export const REGULAR = {
  lunch: ['11:30', '14:30'],
  dinner: ['17:30', '20:30'],
  closedWeekday: 2, // 0=日 … 2=火
};

export const KIND_LABEL = {
  closed: '臨時休業',
  private: '貸切',
  hours: '時間変更',
  open: '臨時営業',
  soldout: '売り切れ終了',
  mark: 'アイコン・文字だけ',
};

const HOLIDAYS_URL = 'https://holidays-jp.github.io/api/v1/date.json';

export const WD = ['日', '月', '火', '水', '木', '金', '土'];
export const toMin = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
export const fmt = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const LUNCH = REGULAR.lunch.map(toMin);
const DINNER = REGULAR.dinner.map(toMin);

export const ymd = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const parts = s => s.split('-').map(Number);
export const addDays = (s, n) => { const [y, m, d] = parts(s); return ymd(y, m, d + n); };
export const weekday = s => { const [y, m, d] = parts(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const dayLabel = s => { const [, m, d] = parts(s); return `${m}/${d}（${WD[weekday(s)]}）`; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 全角数字・記号を半角に
export const norm = s => String(s || '')
  .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/[：]/g, ':').replace(/[－〜～~–—]/g, '-')
  .trim();

// "11:30-13:30, 17:30-20:30" → [[690, 810], [1050, 1230]]
export const parseHours = s => [...norm(s).matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)]
  .map(m => [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);

// 日本時間の現在。?now=2026-10-20T12:00 で動作確認用に時刻を指定可能
export function jstNow() {
  const q = new URLSearchParams(location.search).get('now');
  const d = q ? new Date(q + '+09:00') : new Date();
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = t => p.find(x => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, min: Number(g('hour')) * 60 + Number(g('minute')) };
}

export async function loadHolidays() {
  try {
    const r = await fetch(HOLIDAYS_URL);
    return r.ok ? await r.json() : {};
  } catch (e) {
    return {};
  }
}

// 例外（臨時休業など）の一覧を日付ごとにまとめる
export function makeContext(holidays, list) {
  const ex = {};
  const sorted = [...(list || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const e of sorted) {
    if (!e.date || !KIND_LABEL[e.kind]) continue;
    (ex[e.date] ||= []).push({ ...e, hoursList: parseHours(e.hours) });
  }
  return { holidays: holidays || {}, ex };
}

// 時間帯 periods から blocks（貸切時間）を差し引く
function subtract(periods, blocks) {
  let out = periods;
  for (const [bs, be] of blocks) {
    out = out.flatMap(([s, e]) => {
      if (be <= s || bs >= e) return [[s, e]];
      const r = [];
      if (s < bs) r.push([s, bs]);
      if (be < e) r.push([be, e]);
      return r;
    });
  }
  return out;
}

export function regularPeriods(date, ctx) {
  const wd = weekday(date);
  if (wd === REGULAR.closedWeekday) return [];
  return (wd === 0 || wd === 6 || ctx.holidays[date]) ? [LUNCH, DINNER] : [LUNCH];
}

/* ---------- お客様に表示する文言（管理画面の「表示する文言」で変更できる） ---------- */
// {start} {end} {next} は時刻などに置き換わる
export const MESSAGES = {
  'msg-open':          { label: '営業中（見出し）',             def: '営業中' },
  'msg-open-sub':      { label: '営業中（補足）',               def: '本日は {end} まで' },
  'msg-prep-first':    { label: '開店前',                       def: '本日は {start} から営業します' },
  'msg-prep-between':  { label: 'ランチとディナーの間',          def: '準備中（{start} から営業）' },
  'msg-ended':         { label: '営業終了後',                   def: '本日の営業は終了しました' },
  'msg-regular-off':   { label: '定休日',                       def: '本日は定休日です' },
  'msg-closed':        { label: '臨時休業の日',                 def: '本日は臨時休業です' },
  'msg-private':       { label: '貸切の日',                     def: '本日は貸切のため休業です' },
  'msg-soldout':       { label: '売り切れで終了したとき',        def: 'スープが売り切れました。ありがとうございました。' },
  'msg-next':          { label: '次の営業日の案内',              def: '次の営業：{next}' },
  'pill-open':         { label: '右上の表示：営業中',            def: '営業中' },
  'pill-prep':         { label: '右上の表示：準備中',            def: '準備中' },
  'pill-ended':        { label: '右上の表示：営業終了後',        def: '本日終了' },
  'pill-off':          { label: '右上の表示：定休日',            def: '定休日' },
  'pill-closed':       { label: '右上の表示：臨時休業',          def: '臨時休業' },
  'pill-private':      { label: '右上の表示：貸切',              def: '貸切' },
  'cal-lunch':         { label: 'カレンダー：ランチのみの日',     def: '昼' },
  'cal-full':          { label: 'カレンダー：ランチ・ディナーの日', def: '昼夜' },
  'cal-off':           { label: 'カレンダー：定休日',            def: '定休' },
  'cal-closed':        { label: 'カレンダー：臨時休業',          def: '休業' },
  'cal-private':       { label: 'カレンダー：貸切',              def: '貸切' },
  'cal-change':        { label: 'カレンダー：時間変更',          def: '変更' },
  'cal-open':          { label: 'カレンダー：臨時営業',          def: '営業' },
};
let custom = {};
export function setMessages(texts) {
  custom = {};
  for (const k of Object.keys(MESSAGES)) if (texts?.[k]) custom[k] = texts[k];
}
export function msg(key, vars = {}) {
  const t = custom[key] ?? MESSAGES[key]?.def ?? '';
  return t.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
}

// カレンダーのマスに選べるアイコン
export const DAY_ICONS = ['🍜', '🐚', '🎉', '🎄', '🎍', '🌸', '🎆', '🏖️', '🐟', '⭐', '❤️', '🎵', '📢', '🛠️', '🧒', '🍙'];

export function getDay(date, ctx) {
  const wd = weekday(date);
  const regular = regularPeriods(date, ctx);
  const day = {
    date, wd, isHoliday: !!ctx.holidays[date], holidayName: ctx.holidays[date] || '',
    periods: regular, reason: regular.length ? '' : '定休日',
    tag: '', notes: [], irregular: false, soldout: false, entries: ctx.ex[date] || [],
    icon: '', label: '',
  };

  for (const e of day.entries) {
    if (e.note) day.notes.push(e.note);
    if (e.icon) day.icon = e.icon;
    if (e.label) day.label = e.label;
    if (e.kind === 'mark') continue; // 目印だけ（営業時間は変えない）
    day.irregular = true;
    if (e.kind === 'closed') { day.periods = []; day.reason = day.tag = '臨時休業'; }
    else if (e.kind === 'private') {
      if (e.hoursList.length) {
        day.periods = subtract(day.periods, e.hoursList);
        day.tag = '一部貸切';
        if (!day.periods.length) day.reason = '貸切';
      } else { day.periods = []; day.reason = day.tag = '貸切'; }
    }
    else if (e.kind === 'hours' || e.kind === 'open') {
      day.periods = e.hoursList.length ? e.hoursList : (regular.length ? regular : [LUNCH, DINNER]);
      day.tag = regular.length ? '時間変更' : '臨時営業';
      day.reason = '';
    }
    else if (e.kind === 'soldout') { day.soldout = true; day.tag = '売り切れ終了'; }
  }
  return day;
}

export const periodText = ps => ps.map(([s, e]) => `${fmt(s)}〜${fmt(e)}`).join(' / ');
export const closedText = d => d.reason === '貸切' ? '貸切のため休業' : (d.reason || '休業');

export function nextOpen(from, min, ctx) {
  for (let i = 0; i <= 45; i++) {
    const date = addDays(from, i), d = getDay(date, ctx);
    if (i === 0) {
      if (d.soldout) continue;
      const p = d.periods.find(([s]) => s > min);
      if (p) return `本日 ${fmt(p[0])}〜`;
      continue;
    }
    if (d.periods.length) return `${i === 1 ? '明日 ' : ''}${dayLabel(date)} ${fmt(d.periods[0][0])}〜`;
  }
  return '';
}

// 今この瞬間の状態
export function todayStatus(now, ctx) {
  const d = getDay(now.date, ctx);
  const hours = d.soldout ? '売り切れのため終了' : (d.periods.length ? periodText(d.periods) : closedText(d));
  const nxt = () => { const n = nextOpen(now.date, now.min, ctx); return n ? msg('msg-next', { next: n }) : ''; };
  const base = { hours, d, notes: d.notes };

  if (d.soldout) return { ...base, cls: 'is-closed', pill: msg('pill-ended'), head: msg('msg-ended'), sub: [msg('msg-soldout'), nxt()].filter(Boolean).join('\n') };
  if (!d.periods.length) {
    const kind = d.reason === '定休日' ? 'off' : d.reason === '貸切' ? 'private' : 'closed';
    return {
      ...base, cls: kind === 'off' ? 'is-closed' : 'is-alert',
      pill: msg(`pill-${kind}`), head: msg(kind === 'off' ? 'msg-regular-off' : `msg-${kind}`), sub: nxt(),
    };
  }
  for (let i = 0; i < d.periods.length; i++) {
    const [s, e] = d.periods[i];
    if (now.min < s) {
      return i === 0
        ? { ...base, cls: 'is-prep', pill: `${fmt(s)}〜営業`, head: msg('msg-prep-first', { start: fmt(s) }), sub: '' }
        : { ...base, cls: 'is-prep', pill: msg('pill-prep'), head: msg('msg-prep-between', { start: fmt(s) }), sub: '' };
    }
    if (now.min < e) {
      const later = i < d.periods.length - 1 ? `（次は ${fmt(d.periods[i + 1][0])}〜）` : '';
      return { ...base, cls: 'is-open', pill: msg('pill-open'), head: msg('msg-open'), sub: msg('msg-open-sub', { end: fmt(e) }) + later };
    }
  }
  return { ...base, cls: 'is-closed', pill: msg('pill-ended'), head: msg('msg-ended'), sub: nxt() };
}

// 2週間カレンダーの <li> 群
export function calendarHTML(now, ctx, days = 14) {
  const rows = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(now.date, i), d = getDay(date, ctx);
    const text = d.soldout ? '売り切れのため終了' : (d.periods.length ? periodText(d.periods) : closedText(d));
    const cls = [
      i === 0 ? 'today-row' : '',
      d.wd === 6 ? 'sat' : (d.wd === 0 || d.isHoliday) ? 'sun' : '',
      d.periods.length && !d.soldout ? '' : 'off',
      d.irregular ? 'irregular' : '',
    ].join(' ');
    const tag = d.irregular && d.tag && d.periods.length && !d.soldout ? `【${d.tag}】` : '';
    const memo = d.notes.length ? `<span class="memo">${esc(d.notes.join(' / '))}</span>` : '';
    const hol = d.isHoliday ? `<span class="memo hol">${esc(d.holidayName)}</span>` : '';
    rows.push(`<li class="${cls}"><span class="d">${esc(dayLabel(date))}</span><span class="h">${esc(tag + text)}${memo}${hol}</span></li>`);
  }
  return rows.join('');
}

// 1日分の説明文（カレンダーのマスをタップしたときに表示）
export function dayDetail(date, ctx, now) {
  const d = getDay(date, ctx);
  let text;
  if (d.soldout && date === now?.date) text = '売り切れのため本日の営業は終了しました';
  else if (!d.periods.length) text = closedText(d);
  else text = `${d.irregular && d.tag ? `【${d.tag}】` : ''}営業 ${periodText(d.periods)}`;
  const extra = [d.holidayName, ...d.notes].filter(Boolean).join(' / ');
  return { label: `${dayLabel(date)}${d.icon ? ' ' + d.icon : ''}`, text, extra, irregular: d.irregular };
}

// マスに出す色の種類と短い文字
export function cellLabel(date, ctx, now) {
  const d = getDay(date, ctx);
  let st, lb;
  if (d.soldout && date === now.date) { st = 'st-off'; lb = msg('pill-ended'); }
  else if (!d.periods.length) {
    if (d.reason === '定休日') { st = 'st-off'; lb = msg('cal-off'); }
    else { st = 'st-alert'; lb = msg(d.reason === '貸切' ? 'cal-private' : 'cal-closed'); }
  } else if (d.irregular) { st = 'st-change'; lb = msg(d.tag === '臨時営業' ? 'cal-open' : 'cal-change'); }
  else { st = d.periods.length > 1 ? 'st-full' : 'st-lunch'; lb = msg(d.periods.length > 1 ? 'cal-full' : 'cal-lunch'); }
  return { st, lb: d.label || lb, icon: d.icon, d };
}

// 1か月分のカレンダー（横：曜日、縦：週）
export function monthHTML(year, month, now, ctx) {
  const first = ymd(year, month, 1);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = weekday(first);
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<td class="blank"></td>');

  for (let day = 1; day <= days; day++) {
    const date = ymd(year, month, day);
    const { st, lb, icon, d } = cellLabel(date, ctx, now);
    const past = date < now.date;

    const cls = [
      'cell', st,
      past ? 'past' : '',
      date === now.date ? 'is-today' : '',
      d.wd === 6 ? 'sat' : (d.wd === 0 || d.isHoliday) ? 'sun' : '',
    ].join(' ');
    const det = dayDetail(date, ctx, now);
    const aria = `${det.label} ${det.text}${det.extra ? ' ' + det.extra : ''}`;
    const ic = !past && icon ? `<span class="ic" aria-hidden="true">${esc(icon)}</span>` : '';
    cells.push(`<td><button type="button" class="${cls}" data-date="${date}" aria-label="${esc(aria)}"><span class="num">${day}${ic}</span><span class="lb">${past ? '' : esc(lb)}</span></button></td>`);
  }
  while (cells.length % 7) cells.push('<td class="blank"></td>');

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
  const head = WD.map((w, i) => `<th class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</th>`).join('');
  return `<table class="month"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// 月送り付きカレンダーを root に組み立てる（お客様画面・管理画面共通）
// onSelect(date) を渡すと、日付をタップしたときに呼ばれる（管理画面でその日を編集する用）
export function mountMonthCalendar(root, getState, monthsAhead = 2, { onSelect, hint } = {}) {
  let offset = 0, selected = null;
  root.innerHTML = `
    <div class="month-nav">
      <button type="button" class="mprev" aria-label="前の月">‹</button>
      <h3 class="mtitle"></h3>
      <button type="button" class="mnext" aria-label="次の月">›</button>
    </div>
    <div class="mgrid"></div>
    <div class="legend"></div>
    <p class="day-detail" aria-live="polite"></p>`;

  const render = () => {
    const { now, ctx } = getState();
    root.querySelector('.legend').innerHTML = `
      <span><i class="st-lunch"></i>${esc(msg('cal-lunch'))}＝ランチのみ</span>
      <span><i class="st-full"></i>${esc(msg('cal-full'))}＝ランチ・ディナー</span>
      <span><i class="st-off"></i>${esc(msg('cal-off'))}＝定休日</span>
      <span><i class="st-alert"></i>臨時休業・貸切</span>
      <span><i class="st-change"></i>時間変更など</span>`;
    const [y0, m0] = now.date.split('-').map(Number);
    const t = new Date(Date.UTC(y0, m0 - 1 + offset, 1));
    const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
    root.querySelector('.mtitle').textContent = `${y}年${m}月`;
    root.querySelector('.mprev').disabled = offset <= 0;
    root.querySelector('.mnext').disabled = offset >= monthsAhead;
    root.querySelector('.mgrid').innerHTML = monthHTML(y, m, now, ctx);
    if (!selected || selected.slice(0, 7) !== `${y}-${String(m).padStart(2, '0')}`) {
      selected = offset === 0 ? now.date : null;
    }
    root.querySelectorAll('.cell').forEach(c => c.classList.toggle('selected', c.dataset.date === selected));
    const out = root.querySelector('.day-detail');
    if (selected) {
      const det = dayDetail(selected, ctx, now);
      out.innerHTML = `<b>${esc(det.label)}</b> ${esc(det.text)}${det.extra ? `<small>${esc(det.extra)}</small>` : ''}`;
      out.classList.toggle('irregular', det.irregular);
    } else {
      out.textContent = hint || '日付をタップすると、その日の営業時間が表示されます';
      out.classList.remove('irregular');
    }
  };

  root.querySelector('.mprev').addEventListener('click', () => { offset--; selected = null; render(); });
  root.querySelector('.mnext').addEventListener('click', () => { offset++; selected = null; render(); });
  root.querySelector('.mgrid').addEventListener('click', e => {
    const c = e.target.closest('.cell');
    if (!c) return;
    selected = c.dataset.date;
    render();
    onSelect?.(selected);
  });
  return render;
}

// 明日以降の臨時変更のお知らせ
export function alertsHTML(now, ctx, days = 14, max = 3) {
  const items = [];
  for (let i = 1; i < days && items.length < max; i++) {
    const date = addDays(now.date, i), d = getDay(date, ctx);
    if (!d.irregular || !d.tag || d.soldout) continue;
    const hours = d.periods.length ? esc(`（営業時間 ${periodText(d.periods)}）`) : '';
    const memo = d.notes.length ? `<br>${esc(d.notes.join(' / '))}` : '';
    items.push(`<li><b>${esc(dayLabel(date))}${d.icon ? ' ' + esc(d.icon) : ''} ${esc(d.label || d.tag)}</b>${hours}${memo}</li>`);
  }
  return items.join('');
}
