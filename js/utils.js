// 여러 파일에서 함께 쓰는 작은 도구 함수 모음
// 날짜는 'YYYY-MM-DD', 시간은 'HH:MM'(24시간) 글자로 다뤄요.

const TZ = 'Asia/Seoul';        // 대한민국 시간대
const DAY_START = 8 * 60;       // 하루 시작: 08:00 (분 단위)
const DAY_END = 24 * 60;        // 하루 끝: 24:00
const SLOT = 30;                // 30분 단위
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

function pad(n) {
  return String(n).padStart(2, '0');
}

// '09:30' → 570(분)
function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 570 → '09:30'
function toHHMM(min) {
  return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
}

// 날짜 계산은 UTC 기준 Date로 해서, 컴퓨터 시간대 설정과 상관없이 정확하게 동작해요.
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDate(d) {
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function addDays(s, n) {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}

// 요일 번호: 월=0 … 일=6
function weekday(s) {
  return (parseDate(s).getUTCDay() + 6) % 7;
}

function mondayOf(s) {
  return addDays(s, -weekday(s));
}

// 월 이동: ('2026-11-14', 1) → '2026-12-01'
function shiftMonth(s, n) {
  const [y, m] = s.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return Math.floor(t / 12) + '-' + pad((t % 12) + 1) + '-01';
}

// 한국 시간 기준 오늘 날짜
function todayKST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// 한국 시간 기준 지금 시각(분)
function nowMinKST() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get('hour') * 60 + get('minute');
}

// '2026-11-14' → '11월 14일 (토)'
function dateLabel(s) {
  const [, m, d] = s.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEKDAYS[weekday(s)]})`;
}

// 저장 시각(ISO) → '11/14 13:20' (한국 시간)
function fmtStamp(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

// 사진을 적당한 크기로 줄여요 (긴 쪽 최대 1600px, JPEG)
async function resizeImage(file, max = 1600, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 겹치지 않는 고유 번호 만들기
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 사용자가 입력한 글자를 화면에 안전하게 넣기 위한 변환
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 배경색에 따라 잘 보이는 글자색(흰색/검정) 고르기
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#1d2433' : '#ffffff';
}
