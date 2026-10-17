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

export function getDay(date, ctx) {
  const wd = weekday(date);
  const regular = regularPeriods(date, ctx);
  const day = {
    date, wd, isHoliday: !!ctx.holidays[date], holidayName: ctx.holidays[date] || '',
    periods: regular, reason: regular.length ? '' : '定休日',
    tag: '', notes: [], irregular: false, soldout: false, entries: ctx.ex[date] || [],
  };

  for (const e of day.entries) {
    day.irregular = true;
    if (e.note) day.notes.push(e.note);
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
  const nxt = () => { const n = nextOpen(now.date, now.min, ctx); return n ? `次の営業：${n}` : ''; };
  const base = { hours, d, notes: d.notes };

  if (d.soldout) return { ...base, cls: 'is-closed', pill: '本日終了', head: '本日の営業は終了しました', sub: ['スープが売り切れました。ありがとうございました。', nxt()].filter(Boolean).join('\n') };
  if (!d.periods.length) {
    const alert = d.reason !== '定休日';
    return { ...base, cls: alert ? 'is-alert' : 'is-closed', pill: d.reason, head: `本日は${closedText(d)}です`, sub: nxt() };
  }
  for (let i = 0; i < d.periods.length; i++) {
    const [s, e] = d.periods[i];
    if (now.min < s) {
      return i === 0
        ? { ...base, cls: 'is-prep', pill: `${fmt(s)}〜営業`, head: `本日は ${fmt(s)} から営業します`, sub: '' }
        : { ...base, cls: 'is-prep', pill: '準備中', head: `準備中（${fmt(s)} から営業）`, sub: '' };
    }
    if (now.min < e) {
      const later = i < d.periods.length - 1 ? `（次は ${fmt(d.periods[i + 1][0])}〜）` : '';
      return { ...base, cls: 'is-open', pill: '営業中', head: '営業中', sub: `本日は ${fmt(e)} まで${later}` };
    }
  }
  return { ...base, cls: 'is-closed', pill: '本日終了', head: '本日の営業は終了しました', sub: nxt() };
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
  return { label: dayLabel(date), text, extra, irregular: d.irregular };
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
    const d = getDay(date, ctx);
    const past = date < now.date;
    let st, lb;
    if (d.soldout && date === now.date) { st = 'st-off'; lb = '終了'; }
    else if (!d.periods.length) {
      if (d.reason === '定休日') { st = 'st-off'; lb = '定休'; }
      else { st = 'st-alert'; lb = d.reason === '貸切' ? '貸切' : '休業'; }
    } else if (d.irregular) { st = 'st-change'; lb = d.tag === '臨時営業' ? '営業' : '変更'; }
    else { st = d.periods.length > 1 ? 'st-full' : 'st-lunch'; lb = d.periods.length > 1 ? '昼夜' : '昼'; }

    const cls = [
      'cell', st,
      past ? 'past' : '',
      date === now.date ? 'is-today' : '',
      d.wd === 6 ? 'sat' : (d.wd === 0 || d.isHoliday) ? 'sun' : '',
    ].join(' ');
    const det = dayDetail(date, ctx, now);
    const aria = `${det.label} ${det.text}${det.extra ? ' ' + det.extra : ''}`;
    cells.push(`<td><button type="button" class="${cls}" data-date="${date}" aria-label="${esc(aria)}"><span class="num">${day}</span><span class="lb">${past ? '' : lb}</span></button></td>`);
  }
  while (cells.length % 7) cells.push('<td class="blank"></td>');

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
  const head = WD.map((w, i) => `<th class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</th>`).join('');
  return `<table class="month"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// 月送り付きカレンダーを root に組み立てる（お客様画面・管理画面共通）
export function mountMonthCalendar(root, getState, monthsAhead = 2) {
  let offset = 0, selected = null;
  root.innerHTML = `
    <div class="month-nav">
      <button type="button" class="mprev" aria-label="前の月">‹</button>
      <h3 class="mtitle"></h3>
      <button type="button" class="mnext" aria-label="次の月">›</button>
    </div>
    <div class="mgrid"></div>
    <div class="legend">
      <span><i class="st-lunch"></i>昼＝ランチのみ</span>
      <span><i class="st-full"></i>昼夜＝ランチ・ディナー</span>
      <span><i class="st-off"></i>定休日</span>
      <span><i class="st-alert"></i>臨時休業・貸切</span>
      <span><i class="st-change"></i>時間変更など</span>
    </div>
    <p class="day-detail" aria-live="polite"></p>`;

  const render = () => {
    const { now, ctx } = getState();
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
      out.textContent = '日付をタップすると、その日の営業時間が表示されます';
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
    items.push(`<li><b>${esc(dayLabel(date))} ${esc(d.tag)}</b>${hours}${memo}</li>`);
  }
  return items.join('');
}
