// 화면을 그리고, 클릭·입력을 처리하는 파일

// Pinterest Palette 2026 (Cool Blue · Jade · Plum Noir · Persimmon · Wasabi) 계열 색
const COLORS = ['#5b8fc7', '#6f8a6a', '#7a4a66', '#f25a2c', '#c5d12a', '#3b2531', '#a3b18f', '#9cc3e8'];
// 소모임은 만들어질 때 이 순서대로, 아직 안 쓴 색을 자동으로 받아요
const GROUP_COLORS = ['#6f8a6a', '#f25a2c', '#c5d12a', '#7a4a66', '#5b8fc7', '#e8956b', '#3b2531', '#a3b18f', '#9cc3e8', '#b0436a'];
const CATEGORY = {
  all: { label: '63기 전체', color: '#5b8fc7' },
  group: { label: '소모임', color: '#6f8a6a' },
  personal: { label: '개인', color: '#7a4a66' },
};
// 예전 색으로 저장된 일정·소모임은 새 팔레트의 비슷한 색으로 보여줘요
const LEGACY_COLORS = {
  '#3b6fe0': '#5b8fc7', '#2fa36b': '#6f8a6a', '#8a5cd6': '#7a4a66', '#e0663b': '#f25a2c',
  '#d9488f': '#b0436a', '#c9a227': '#c5d12a', '#1f9eb3': '#9cc3e8', '#6b7280': '#3b2531',
  '#a855f7': '#a3b18f', '#0f766e': '#6f8a6a', '#b45309': '#e8956b', '#4f46e5': '#5b8fc7', '#be123c': '#b0436a',
};
const newColor = (c) => LEGACY_COLORS[c.toLowerCase()] || c;

const $ = (sel) => document.querySelector(sel);
const viewEl = $('#view');
const dlg = $('#event-dialog');
const form = $('#event-form');
const f = form.elements;

// 마지막으로 보던 탭, 내 이름 등은 기억해요 (실패해도 문제없게 try/catch)
function loadPref(key, fallback) {
  try { return localStorage.getItem('p63-pref:' + key) || fallback; } catch (e) { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem('p63-pref:' + key, value); } catch (e) { /* 무시 */ }
}

const state = {
  view: loadPref('view', 'month'),  // 'month' | 'week' | 'records'
  month: shiftMonth(todayKST(), 0), // 월간에서 보고 있는 달 (1일)
  date: todayKST(),                 // 선택한 날짜 (주간은 이 날짜가 속한 주)
  events: [],
  groups: [],
  birthdays: [],
  filter: '',                       // '' 전체 | 'cat:all' | 'cat:personal' | 'g:<소모임 id>'
  user: loadPref('name', ''),
};
if (!['month', 'week', 'records'].includes(state.view)) state.view = 'month';

const byTime = (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);
const hasRecord = (e) => !!e.record;
const author = () => state.user || '익명';

/* ---------- 소모임 · 필터 도우미 ---------- */

const groupById = (id) => state.groups.find((g) => g.id === id);
const groupOf = (e) => (e.category === 'group' ? groupById(e.groupId) : null);
const colorOf = (e) => groupOf(e)?.color || e.color; // 소모임 일정은 소모임 색을 따라가요
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// 일정 옆에 붙는 소모임 이름표 (제목이 소모임 이름과 같으면 생략)
function groupTag(e) {
  const g = groupOf(e);
  return g && !sameName(g.name, e.title) ? `<span class="tag" style="--c:${g.color}">${esc(g.name)}</span>` : '';
}

function nextGroupColor() {
  const used = state.groups.map((g) => g.color);
  return GROUP_COLORS.find((c) => !used.includes(c)) || GROUP_COLORS[state.groups.length % GROUP_COLORS.length];
}

// 내가 [참석]을 누른 일정인지 (참석 체크를 받는 일정만)
const isAttending = (e) => !!state.user && e.rsvp && e.category !== 'personal' && e.attendees.includes(state.user);

function matchFilter(e, filter = state.filter) {
  const [kind, value] = filter.split(':');
  if (filter === 'cat:all') return e.category === 'all' || e.category === 'group'; // 소모임 일정도 63기 전체에 보여요
  if (filter === 'cat:personal') return e.category === 'personal' || isAttending(e); // 참석하는 소모임도 개인에 보여요
  if (kind === 'cat') return e.category === value;
  if (kind === 'g') return e.category === 'group' && e.groupId === value;
  return true;
}

const visibleEvents = () => state.events.filter((e) => matchFilter(e));

function filterLabel() {
  const [kind, value] = state.filter.split(':');
  if (kind === 'cat') return CATEGORY[value]?.label;
  if (kind === 'g') return groupById(value)?.name;
  return '';
}

function setFilter(filter) {
  state.filter = filter;
  render();
}

/* ---------- 공통 ---------- */

function setDate(d) {
  state.date = d;
  state.month = shiftMonth(d, 0);
}

function goView(v) {
  state.view = v;
  savePref('view', v);
  render();
}

async function refresh() {
  [state.events, state.groups, state.birthdays] = await Promise.all([
    DataStore.list(), DataStore.listGroups(), DataStore.listBirthdays(),
  ]);
  state.events.forEach((e) => { e.color = newColor(e.color); });
  state.groups.forEach((g) => { g.color = newColor(g.color); });
  if (state.filter.startsWith('g:') && !groupById(state.filter.slice(2))) state.filter = '';
  render();
}

function render() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === state.view));
  $('#date-nav').hidden = state.view === 'records';
  const label = filterLabel();
  $('#filter-chip').hidden = !label;
  $('#filter-chip').textContent = `${label}만 보는 중  ✕`;
  renderIndex();
  renderLegend();
  if (state.view === 'month') renderHome();
  else if (state.view === 'week') renderWeek();
  else renderRecords();
  hydratePhotos(viewEl);
}

function rangeTitle(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [, m2, d2] = b.split('-').map(Number);
  return m1 === m2 ? `${y1}년 ${m1}월 ${d1}일 – ${d2}일` : `${y1}년 ${m1}월 ${d1}일 – ${m2}월 ${d2}일`;
}

const eventsOn = (d) => visibleEvents().filter((e) => e.date === d).sort(byTime);

function birthdaysOn(d) {
  const [, m, day] = d.split('-').map(Number);
  return state.birthdays.filter((b) => b.month === m && b.day === day);
}

/* ---------- 왼쪽 인덱스 ---------- */

function renderIndex() {
  const count = (fn) => state.events.filter(fn).length;
  const item = (filter, dot, label, n) =>
    `<button class="idx-item${state.filter === filter ? ' active' : ''}" data-filter="${filter}">${dot}<span class="idx-name">${label}</span><span class="idx-n">${n}</span></button>`;
  const dot = (c) => `<span class="dot" style="--c:${c}"></span>`;

  const groups = state.groups.map((g) => `
    <div class="idx-row">
      ${item('g:' + g.id, dot(g.color), esc(g.name), count((e) => e.category === 'group' && e.groupId === g.id))}
      <button class="idx-act" data-add-group="${g.id}" title="${esc(g.name)} 일정 추가" aria-label="${esc(g.name)} 일정 추가">+</button>
      <button class="idx-act" data-edit-group="${g.id}" title="이름·색 바꾸기" aria-label="${esc(g.name)} 편집">⋯</button>
    </div>`).join('');

  $('#index').innerHTML = `
    <div class="idx-section">
      <div class="idx-label">보기</div>
      ${item('', '<span class="idx-icon">▦</span>', '전체 일정', state.events.length)}
      ${item('cat:all', dot(CATEGORY.all.color), '63기 전체', count((e) => matchFilter(e, 'cat:all')))}
      ${item('cat:personal', dot(CATEGORY.personal.color), '개인', count((e) => matchFilter(e, 'cat:personal')))}
    </div>
    <div class="idx-section">
      <div class="idx-label">소모임 <button class="idx-new" data-new-group title="소모임 만들기">+ 새 소모임</button></div>
      ${groups || '<p class="idx-empty">일정을 추가할 때 분류를 “소모임”으로 고르고 이름을 적으면 여기에 자동으로 생겨요.</p>'}
    </div>`;
}

$('#index').addEventListener('click', (e) => {
  const t = e.target.closest('[data-filter],[data-add-group],[data-edit-group],[data-new-group]');
  if (!t) return;
  const ds = t.dataset;
  if (ds.addGroup) return openModal({ date: state.date, category: 'group', groupId: ds.addGroup });
  if (ds.editGroup) return openGroupDialog(groupById(ds.editGroup));
  if ('newGroup' in ds) return openGroupDialog(null);
  setFilter(state.filter === ds.filter ? '' : ds.filter); // 한 번 더 누르면 해제
});

$('#filter-chip').addEventListener('click', () => setFilter(''));

/* ---------- 월간 제목 옆 색깔 인덱스 ---------- */

function renderLegend() {
  const show = state.view === 'month';
  const legend = $('#legend');
  legend.hidden = !show;
  $('.toolbar').classList.toggle('has-legend', show);
  if (!show) return;
  const items = [
    ['cat:all', CATEGORY.all.color, CATEGORY.all.label],
    ['cat:personal', CATEGORY.personal.color, CATEGORY.personal.label],
    ...state.groups.map((g) => ['g:' + g.id, g.color, g.name]),
  ];
  legend.classList.toggle('filtering', !!state.filter);
  legend.innerHTML = items.map(([filter, color, label]) =>
    `<button class="lg-item${state.filter === filter ? ' active' : ''}" data-filter="${filter}" style="--c:${color}"><span class="dot"></span>${esc(label)}</button>`
  ).join('');
}

$('#legend').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (b) setFilter(state.filter === b.dataset.filter ? '' : b.dataset.filter); // 한 번 더 누르면 해제
});

/* ---------- 첫 화면: 월간 달력 + 이번 주(월~금) ---------- */

function monthHTML() {
  const [y, m] = state.month.split('-').map(Number);
  const daysInMonth = Number(addDays(shiftMonth(state.month, 1), -1).slice(8));
  const weeks = Math.ceil((weekday(state.month) + daysInMonth) / 7);
  const start = mondayOf(state.month);
  const today = todayKST();
  const selMon = mondayOf(state.date);
  const selSun = addDays(selMon, 6);
  $('#range-title').textContent = `${y}년 ${m}월`;

  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const cls = [
      'mo-cell',
      Number(d.slice(5, 7)) !== m && 'out',
      d === today && 'is-today',
      d === state.date && 'is-selected',
      d >= selMon && d <= selSun && 'in-week',
      i % 7 >= 5 && 'is-weekend',
    ].filter(Boolean).join(' ');
    const evs = eventsOn(d); // 시간 순서로 정렬돼 있어요
    // 월간에는 소모임 이름을, 소모임이 아닌 일정은 제목을 보여줘요 (제목은 주간에서 확인)
    const chips = evs.slice(0, 3).map((e) =>
      `<button class="mo-chip" data-id="${e.id}" style="--c:${colorOf(e)}" aria-label="${esc(`${e.start} ${e.title}`)}"><span class="dot"></span><span class="chip-text">${e.start} ${esc(groupOf(e)?.name || e.title)}</span></button>`
    ).join('');
    const more = evs.length > 3 ? `<button class="mo-more" data-more="${d}">+${evs.length - 3}개</button>` : '';
    const bds = birthdaysOn(d);
    const cake = bds.length ? `<span class="bday-mark" title="${esc(bds.map((b) => b.name).join(', '))} 생일">🎂</span>` : '';
    cells += `<div class="${cls}" data-date="${d}">
      <div class="mo-top"><span class="mo-dwrap"><span class="mo-date">${Number(d.slice(8))}</span>${cake}</span><button class="mo-add" data-add="${d}" aria-label="${dateLabel(d)} 일정 추가">+</button></div>
      <div class="mo-chips">${chips}${more}</div>
    </div>`;
  }

  return `<section class="month">
    <div class="mo-head">${WEEKDAYS.map((w, i) => `<div class="${i >= 5 ? 'is-weekend' : ''}">${w}</div>`).join('')}</div>
    <div class="mo-grid" style="--weeks:${weeks}">${cells}</div>
  </section>`;
}

/* ---------- 참석 체크 ---------- */

function attendBtn(e) {
  const on = isAttending(e);
  const who = e.attendees.length ? `\n참석 ${e.attendees.length}명: ${e.attendees.join(', ')}` : '';
  return `<button class="att-btn${on ? ' on' : ''}" data-attend="${e.id}" title="${esc((on ? '누르면 참석 취소' : '누르면 참석') + who)}">${on ? '✓ 참석' : '참석'}</button>`;
}

// [참석] 버튼: 누를 때마다 내 이름을 참석자 명단에 넣었다 뺐다 해요
async function toggleAttend(id) {
  if (!state.user) return askName();
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  const names = new Set(ev.attendees);
  if (names.has(state.user)) names.delete(state.user);
  else names.add(state.user);
  await DataStore.upsert({ id, attendees: [...names] }, author());
  refresh();
}

function weekPanelHTML() {
  const mon = mondayOf(state.date);
  const today = todayKST();
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i)); // 월~일
  const MAX = 2; // 7일이 한 칸에 들어가도록 하루 2개까지, 나머지는 "+n개 더 보기"
  const rows = days.map((d, i) => {
    const evs = eventsOn(d);
    const list = evs.length
      ? evs.slice(0, MAX).map((e) => `<div class="wp-row">
        <button class="wp-ev" data-id="${e.id}" style="--c:${colorOf(e)}"><span class="dot"></span><span class="wp-time">${e.start}</span><span class="wp-title">${hasRecord(e) ? '📝 ' : ''}${esc(e.title)}</span>${groupTag(e)}</button>
        ${e.rsvp ? attendBtn(e) : ''}
      </div>`).join('') + (evs.length > MAX ? `<button class="mo-more" data-more="${d}">+${evs.length - MAX}개 더 보기</button>` : '')
      : `<button class="wp-empty" data-add="${d}">+ 일정 추가</button>`;
    return `<div class="wp-day${d === today ? ' is-today' : ''}${i >= 5 ? ' is-weekend' : ''}">
      <button class="wp-label" data-open-week="${d}" title="주간 크게 보기"><b>${WEEKDAYS[i]}</b><span>${Number(d.slice(5, 7))}/${Number(d.slice(8))}</span></button>
      <div class="wp-events">${list}</div>
    </div>`;
  }).join('');

  return `<section class="wk-panel">
    <header class="panel-head">
      <button class="btn icon small" data-wk="-1" aria-label="지난주">‹</button>
      <button class="panel-title" data-open-week="${state.date}">
        <span>${rangeTitle(days[0], days[6])}</span>
        <em>주간 크게 보기 →</em>
      </button>
      <button class="btn icon small" data-wk="1" aria-label="다음주">›</button>
    </header>
    <div class="wp-days">${rows}</div>
  </section>`;
}

// 보고 있는 달의 생일 목록 (오늘이면 🎉, 다가오면 D-day)
function birthdayHTML() {
  const [y, m] = state.month.split('-').map(Number);
  const today = todayKST();
  const list = state.birthdays.filter((b) => b.month === m);
  const items = list.map((b) => {
    const diff = Math.round((parseDate(`${y}-${pad(m)}-${pad(b.day)}`) - parseDate(today)) / 86400000);
    const badge = diff === 0 ? '<span class="bd-badge today">오늘 🎉</span>' : diff > 0 ? `<span class="bd-badge">D-${diff}</span>` : '';
    return `<button class="bd-item${diff < 0 ? ' past' : ''}${diff === 0 ? ' is-today' : ''}" data-bday="${b.id}" title="눌러서 고치기">
      <span class="bd-date">${m}/${b.day}</span><span class="bd-name">${esc(b.name)}</span>${badge}
    </button>`;
  }).join('');
  return `<section class="bday-panel">
    <header class="bd-head">
      <h3>🎂 ${m}월 생일 <span class="count">${list.length}</span></h3>
      <button class="idx-new" data-new-bday>+ 등록</button>
    </header>
    <div class="bd-list">${items || '<p class="bd-empty">이번 달 생일이 없어요.</p>'}</div>
  </section>`;
}

// 최근 소모임 사진 모음: 사진을 누르면 크게, 제목을 누르면 그 기록으로 이동
function photoStripHTML() {
  const recs = visibleEvents().filter((e) => e.record?.photos.length).sort((a, b) => byTime(b, a)).slice(0, 12);
  const cards = recs.map((e) => {
    const g = groupOf(e);
    const [first] = e.record.photos;
    const n = e.record.photos.length;
    return `<article class="ps-card">
      <button class="ps-photo" data-photo-view="${first}" aria-label="사진 크게 보기">
        <img data-photo="${first}" alt="${esc(e.title)} 사진">
        ${n > 1 ? `<span class="ps-count">+${n - 1}</span>` : ''}
      </button>
      <button class="ps-title" data-record="${e.id}" style="--c:${colorOf(e)}" title="기록 보러 가기"><span class="dot"></span>${esc(e.title)}</button>
      <span class="ps-meta">${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8))}${g && !sameName(g.name, e.title) ? ' · ' + esc(g.name) : ''}</span>
    </article>`;
  }).join('');
  return `<section class="photo-strip">
    <header class="ps-head">
      <h3>📷 소모임 사진</h3>
      <button class="link" data-goto-records>기록 전체 보기 →</button>
    </header>
    <div class="ps-list">${cards || '<p class="ps-empty">소모임 기록에 사진을 올리면 여기에 모여요. 제목을 누르면 그 기록으로 이동해요.</p>'}</div>
  </section>`;
}

function renderHome() {
  viewEl.innerHTML = `<div class="home">
    ${monthHTML()}
    <div class="side-col">${weekPanelHTML()}${birthdayHTML()}</div>
    ${photoStripHTML()}
  </div>`;
}

/* ---------- 주간 크게 보기 (스크롤 없이 한 화면) ---------- */

// 같은 시간에 겹치는 일정은 옆으로 나란히 놓아요
function layoutDay(events) {
  const evs = events.map((e) => ({ ...e })).sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    cluster.forEach((e) => {
      let i = lanes.findIndex((end) => end <= toMin(e.start));
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = toMin(e.end);
      e.lane = i;
    });
    cluster.forEach((e) => { e.lanes = lanes.length; out.push(e); });
    cluster = [];
  };
  evs.forEach((e) => {
    if (cluster.length && toMin(e.start) >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, toMin(e.end));
  });
  flush();
  return out;
}

const SLOTS = (DAY_END - DAY_START) / SLOT;
const pct = (slots) => (slots / SLOTS) * 100;

function eventBlock(e) {
  const s = Math.max(toMin(e.start), DAY_START);
  const en = Math.min(Math.max(toMin(e.end), s + SLOT), DAY_END);
  const h = (en - s) / SLOT;
  const w = 100 / e.lanes;
  const color = colorOf(e);
  const g = groupOf(e);
  return `<button class="ev${h <= 1 ? ' short' : ''}" data-id="${e.id}" style="top:${pct((s - DAY_START) / SLOT)}%;height:calc(${pct(h)}% - 2px);left:calc(${w * e.lane}% + 2px);width:calc(${w}% - 4px);background:${color};color:${textOn(color)}">
    <span class="ev-title">${isAttending(e) ? '✓ ' : ''}${hasRecord(e) ? '📝 ' : ''}${esc(e.title)}</span>
    <span class="ev-time">${e.start}–${e.end}</span>
    ${g && !sameName(g.name, e.title) ? `<span class="ev-loc">#${esc(g.name)}</span>` : ''}
    ${e.location ? `<span class="ev-loc">${esc(e.location)}</span>` : ''}
  </button>`;
}

function nowLineTop() {
  const n = nowMinKST();
  return n >= DAY_START && n < DAY_END ? pct((n - DAY_START) / SLOT) + '%' : null;
}

function renderWeek() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(mondayOf(state.date), i));
  const today = todayKST();
  $('#range-title').textContent = rangeTitle(days[0], days[6]);

  const head = '<div class="wk-corner"></div>' + days.map((d, i) =>
    `<div class="wk-day-head${d === today ? ' is-today' : ''}${i >= 5 ? ' is-weekend' : ''}"><span>${WEEKDAYS[i]}</span><b>${Number(d.slice(5, 7))}/${Number(d.slice(8))}</b></div>`
  ).join('');

  let times = '';
  for (let m = DAY_START; m < DAY_END; m += 60) times += `<div class="wk-hour"><span>${toHHMM(m)}</span></div>`;

  const cols = days.map((d) => {
    let cells = '';
    for (let i = 0; i < SLOTS; i++) {
      const t = toHHMM(DAY_START + i * SLOT);
      cells += `<button class="slot${i % 2 ? ' half' : ''}" data-date="${d}" data-time="${t}" aria-label="${dateLabel(d)} ${t} 일정 추가"></button>`;
    }
    const evs = layoutDay(eventsOn(d)).map(eventBlock).join('');
    const top = d === today ? nowLineTop() : null;
    const now = top ? `<div class="now-line" style="top:${top}"></div>` : '';
    return `<div class="wk-col${d === today ? ' is-today' : ''}">${cells}${evs}${now}</div>`;
  }).join('');

  viewEl.innerHTML = `<div class="week-wrap"><div class="week" style="--slots:${SLOTS};--hours:${SLOTS / 2}">${head}<div class="wk-times">${times}</div>${cols}</div></div>`;
}

/* ---------- 소모임 기록 화면 ---------- */

function recCard(e, mode) {
  const r = e.record;
  const label = { upcoming: '일정 보기', pending: '기록 작성하기', done: '기록 보기 · 수정' }[mode];
  let body = '';
  if (mode === 'done') {
    const photos = r.photos.length
      ? `<div class="rec-photos">${r.photos.slice(0, 4).map((id) =>
        `<button class="thumb" data-photo-view="${id}"><img data-photo="${id}" alt="모임 사진"></button>`
      ).join('')}${r.photos.length > 4 ? `<span class="more-photos">+${r.photos.length - 4}</span>` : ''}</div>`
      : '';
    body = `${r.participants ? `<p class="rec-people">👥 ${esc(r.participants)}</p>` : ''}
      ${r.content ? `<p class="rec-content">${esc(r.content)}</p>` : ''}
      ${photos}
      ${r.nextDate ? `<p class="rec-next">📅 다음 모임: ${dateLabel(r.nextDate)} <button class="link" data-next="${e.id}">일정으로 추가</button></p>` : ''}`;
  }
  if (mode === 'upcoming' && e.rsvp) {
    body = `<p class="rec-people">✋ 참석 ${e.attendees.length}명${e.attendees.length ? ': ' + esc(e.attendees.join(', ')) : ''}</p>`;
  }
  const by = e.updatedBy ? `<span class="rec-by">마지막 수정 ${esc(e.updatedBy)} · ${fmtStamp(e.updatedAt)}</span>` : '';
  const g = groupOf(e);
  return `<article class="rec-card" style="--c:${colorOf(e)}">
    ${g ? `<span class="tag" style="--c:${g.color}">${esc(g.name)}</span>` : ''}
    <div class="rec-meta">${dateLabel(e.date)} · ${e.start}–${e.end}${e.location ? ' · ' + esc(e.location) : ''}</div>
    <h4>${esc(e.title)}</h4>
    ${body}
    <div class="rec-foot">
      <button class="btn small${mode === 'pending' ? ' primary' : ''}" data-record="${e.id}">${label}</button>
      ${mode === 'upcoming' && e.rsvp ? attendBtn(e) : ''}
      ${by}
    </div>
  </article>`;
}

function renderRecords() {
  $('#range-title').textContent = filterLabel() ? `소모임 기록 · ${filterLabel()}` : '소모임 기록';
  const today = todayKST();
  const nowM = nowMinKST();
  const isPast = (e) => e.date < today || (e.date === today && toMin(e.end) <= nowM);
  const groups = visibleEvents().filter((e) => e.category === 'group' || hasRecord(e));
  const desc = (a, b) => byTime(b, a);

  const sections = [
    ['다가오는 소모임', groups.filter((e) => !isPast(e) && !hasRecord(e)).sort(byTime), 'upcoming', '예정된 소모임이 없어요. 일정 추가에서 분류를 “소모임”으로 골라보세요.'],
    ['기록 대기', groups.filter((e) => isPast(e) && !hasRecord(e)).sort(desc), 'pending', '기록할 소모임이 없어요.'],
    ['기록 보관함', groups.filter(hasRecord).sort(desc), 'done', '아직 작성한 기록이 없어요.'],
  ];

  viewEl.innerHTML = `<div class="records">${sections.map(([title, list, mode, emptyMsg]) => `
    <section class="rec-section">
      <h3>${title} <span class="count">${list.length}</span></h3>
      ${list.length ? `<div class="rec-list">${list.map((e) => recCard(e, mode)).join('')}</div>` : `<p class="empty">${emptyMsg}</p>`}
    </section>`).join('')}</div>`;
}

/* ---------- 사진 표시 ---------- */

const photoURLs = new Map(); // 사진 번호 → 화면에 띄울 주소 (한 번 읽으면 기억)

async function photoURL(id) {
  if (!photoURLs.has(id)) {
    const blob = await DataStore.getPhoto(id).catch(() => null);
    photoURLs.set(id, blob ? URL.createObjectURL(blob) : '');
  }
  return photoURLs.get(id);
}

function forgetPhoto(id) {
  if (photoURLs.get(id)) URL.revokeObjectURL(photoURLs.get(id));
  photoURLs.delete(id);
}

// 화면에 그려진 <img data-photo="..."> 들에 실제 사진을 채워 넣어요
function hydratePhotos(root) {
  root.querySelectorAll('img[data-photo]').forEach(async (img) => {
    const url = await photoURL(img.dataset.photo);
    if (url) img.src = url;
    else img.closest('.thumb')?.classList.add('missing');
  });
}

const photoDlg = $('#photo-dialog');
function showPhoto(url) {
  if (!url) return;
  $('#photo-view').src = url;
  photoDlg.showModal();
}
photoDlg.addEventListener('click', () => photoDlg.close());

/* ---------- 색 고르기 (일정 창·소모임 창 공통) ---------- */

function buildSwatches(container, colors) {
  container.innerHTML = colors.map((c) =>
    `<label class="swatch" title="${c}"><input type="radio" name="color" value="${c}"><span style="background:${c}"></span></label>`
  ).join('') + `<label class="swatch custom" title="직접 고르기"><input type="radio" name="color" value="custom"><span></span><input type="color" name="customColor" value="#ff7a00" aria-label="직접 색 고르기"></label>`;
}

function setColorIn(frm, c) {
  const preset = frm.querySelector(`input[name="color"][value="${c}"]`);
  if (preset) {
    preset.checked = true;
  } else {
    frm.querySelector('input[name="color"][value="custom"]').checked = true;
    frm.elements.customColor.value = c;
  }
}

function getColorIn(frm) {
  const v = frm.elements.color.value;
  return v === 'custom' ? frm.elements.customColor.value : v;
}

// 직접 고르기(무지개) 색을 바꾸면 그 동그라미가 선택되게
function watchCustomColor(frm, onPick) {
  frm.addEventListener('input', (e) => {
    if (e.target.name !== 'customColor') return;
    frm.querySelector('input[name="color"][value="custom"]').checked = true;
    onPick?.();
  });
}

/* ---------- 일정 추가·수정 창 ---------- */

let editingId = null;
let colorTouched = false;    // 사용자가 직접 색을 골랐는지
let draftPhotos = [];        // 창에 올라와 있는 사진들: 저장된 것 {id} / 새로 고른 것 {blob, url}
let removedPhotoIds = [];    // 창에서 지운 (이미 저장돼 있던) 사진들
let draftAttendees = [];     // 창을 열었을 때의 참석자 명단
let rsvpTouched = false;     // 사용자가 "참석 체크 받기"를 직접 켜고 껐는지

function setupForm() {
  for (let m = DAY_START; m < DAY_END; m += SLOT) f.start.add(new Option(toHHMM(m), toHHMM(m)));
  for (let m = DAY_START + SLOT; m <= DAY_END; m += SLOT) f.end.add(new Option(toHHMM(m), toHHMM(m)));
  buildSwatches($('#swatches'), COLORS);
  buildSwatches($('#group-swatches'), GROUP_COLORS);
}

function showError(msg) {
  const el = $('#form-error');
  el.textContent = msg;
  el.hidden = !msg;
}

function defaultStart(date) {
  const n = nowMinKST();
  if (date === todayKST() && n >= DAY_START && n < DAY_END - SLOT) {
    return toHHMM(Math.ceil((n + 1) / SLOT) * SLOT);
  }
  return '09:00';
}

// 분류에 따라 창 모양 바꾸기: 소모임이면 "소모임 이름" 칸을 보이고, 색은 소모임 색을 따라가요
function syncCategoryUI() {
  const isGroup = f.category.value === 'group';
  $('#group-field').hidden = !isGroup;
  $('#attend-field').hidden = f.category.value === 'personal';
  $('#attend-box').hidden = !f.rsvp.checked;
  $('#color-field').hidden = isGroup;
  $('#title-label').textContent = isGroup ? '제목 (비워두면 소모임 이름으로 저장돼요)' : '제목';
  f.title.placeholder = isGroup ? '예: 3회차 모임, 판례 발표' : '예: 특허법 강의';
  renderGroupPicks();
}

// 이미 있는 소모임을 버튼으로 보여줘요 → 다음 사람은 눌러서 고르기만 하면 돼요
function renderGroupPicks() {
  const current = f.groupName.value;
  $('#group-picks').innerHTML = state.groups.length
    ? state.groups.map((g) =>
      `<button type="button" class="pick${sameName(g.name, current) ? ' active' : ''}" data-pick="${esc(g.name)}" style="--c:${g.color}"><span class="dot"></span>${esc(g.name)}</button>`
    ).join('')
    : '<span class="pick-empty">아직 소모임이 없어요. 아래에 이름을 적으면 새로 만들어져요.</span>';
  $('#group-list').innerHTML = state.groups.map((g) => `<option value="${esc(g.name)}"></option>`).join('');
}

$('#group-picks').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  f.groupName.value = b.dataset.pick;
  renderGroupPicks();
});
f.groupName.addEventListener('input', renderGroupPicks);

function renderDraftPhotos() {
  const grid = $('#photo-grid');
  grid.innerHTML = draftPhotos.map((p, i) =>
    `<div class="thumb"><img ${p.url ? `src="${p.url}"` : `data-photo="${p.id}"`} alt="모임 사진" data-zoom><button type="button" class="thumb-x" data-remove="${i}" aria-label="사진 빼기">×</button></div>`
  ).join('');
  hydratePhotos(grid);
  $('#photo-count').textContent = `${draftPhotos.length}/${DataStore.MAX_PHOTOS}`;
}

function cleanupDraft() {
  draftPhotos.forEach((p) => p.url && URL.revokeObjectURL(p.url));
  draftPhotos = [];
  removedPhotoIds = [];
}

function openModal(ev, opts = {}) {
  const isEdit = !!ev.id;
  editingId = ev.id || null;
  colorTouched = isEdit;
  form.reset();
  showError('');

  // 인덱스에서 하나만 보고 있을 때 새 일정을 만들면 그 분류·소모임으로 미리 골라줘요
  if (!isEdit && !ev.category && state.filter) {
    const [kind, value] = state.filter.split(':');
    ev = kind === 'g' ? { ...ev, category: 'group', groupId: value } : { ...ev, category: value };
  }

  const start = ev.start || defaultStart(ev.date);
  const end = ev.end || toHHMM(Math.min(toMin(start) + 60, DAY_END));
  const category = ev.category || 'all';
  const r = ev.record;

  $('#dialog-title').textContent = isEdit ? '일정 수정' : '일정 추가';
  const meta = $('#meta-line');
  meta.hidden = !isEdit;
  if (isEdit) {
    meta.textContent = `작성 ${ev.createdBy || '알 수 없음'} · ${fmtStamp(ev.createdAt)}`
      + (ev.updatedAt && ev.updatedAt !== ev.createdAt ? `   |   수정 ${ev.updatedBy || '알 수 없음'} · ${fmtStamp(ev.updatedAt)}` : '');
  }

  form.querySelector(`input[name="category"][value="${category}"]`).checked = true;
  f.groupName.value = groupById(ev.groupId)?.name || '';
  f.title.value = ev.title || '';
  f.date.value = ev.date;
  f.start.value = start;
  f.end.value = end;
  setColorIn(form, ev.color || CATEGORY[category].color);
  f.location.value = ev.location || '';
  f.memo.value = ev.memo || '';
  f.participants.value = r?.participants || '';
  f.recordContent.value = r?.content || '';
  f.nextDate.value = r?.nextDate || '';
  draftAttendees = ev.attendees || [];
  f.rsvp.checked = ev.rsvp ?? category === 'group'; // 새 일정: 소모임은 켜고, 63기 전체는 꺼둬요
  rsvpTouched = isEdit;
  f.attend.checked = !!state.user && draftAttendees.includes(state.user);
  $('#attend-me').textContent = state.user || '나';
  $('#attend-list').textContent = draftAttendees.length
    ? `지금 참석 ${draftAttendees.length}명: ${draftAttendees.join(', ')}`
    : '아직 참석한 사람이 없어요. 참석하면 내 "개인"에도 이 일정이 떠요.';
  draftPhotos = (r?.photos || []).map((id) => ({ id }));
  removedPhotoIds = [];
  renderDraftPhotos();
  syncCategoryUI();
  $('#record-box').open = !!opts.focusRecord || hasRecord(ev);
  $('#btn-delete').hidden = !isEdit;

  dlg.showModal();
  if (opts.focusRecord) f.recordContent.focus();
  else if (!isEdit) (category === 'group' && !f.groupName.value ? f.groupName : f.title).focus();
}

function openById(id, opts) {
  const ev = state.events.find((e) => e.id === id);
  if (ev) openModal(ev, opts);
}

// 기록에 적은 "다음 모임 날짜"로 새 일정 만들기 (같은 제목·시간·장소·소모임을 미리 채워줘요)
function openNext(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  const { title, category, groupId, start, end, color, location } = ev;
  openModal({ title, category, groupId, start, end, color, location, date: ev.record.nextDate });
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'category') {
    if (!colorTouched) setColorIn(form, CATEGORY[e.target.value].color);
    if (!rsvpTouched) f.rsvp.checked = e.target.value === 'group';
    syncCategoryUI();
  }
  if (e.target.name === 'rsvp') {
    rsvpTouched = true;
    syncCategoryUI();
  }
  if (e.target.name === 'color') colorTouched = true;
  // 시작을 바꿨는데 종료가 더 이르면, 종료를 1시간 뒤로 맞춰줘요
  if (e.target.name === 'start' && toMin(f.end.value) <= toMin(f.start.value)) {
    f.end.value = toHHMM(Math.min(toMin(f.start.value) + 60, DAY_END));
  }
});
watchCustomColor(form, () => { colorTouched = true; });

$('#photo-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  const room = DataStore.MAX_PHOTOS - draftPhotos.length;
  if (files.length > room) alert(`사진은 한 기록에 ${DataStore.MAX_PHOTOS}장까지 올릴 수 있어요.`);
  for (const file of files.slice(0, Math.max(room, 0))) {
    try {
      const blob = await resizeImage(file);
      draftPhotos.push({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      alert(`"${file.name}" 사진을 불러오지 못했어요. (JPG, PNG 사진을 써주세요)`);
    }
  }
  renderDraftPhotos();
});

$('#photo-grid').addEventListener('click', (e) => {
  const x = e.target.closest('[data-remove]');
  if (x) {
    const [p] = draftPhotos.splice(Number(x.dataset.remove), 1);
    if (p.id) removedPhotoIds.push(p.id);
    if (p.url) URL.revokeObjectURL(p.url);
    return renderDraftPhotos();
  }
  const img = e.target.closest('img[data-zoom]');
  if (img) showPhoto(img.src);
});

// 소모임 이름으로 소모임 찾기. 없으면 새로 만들어서 인덱스에 추가해요.
async function ensureGroup(name) {
  const found = state.groups.find((g) => sameName(g.name, name));
  if (found) return found;
  const color = nextGroupColor();
  const id = await DataStore.upsertGroup({ name, color }, author());
  const group = { id, name, color };
  state.groups.push(group);
  return group;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const isGroup = f.category.value === 'group';
  const groupName = f.groupName.value.trim();
  if (isGroup && !groupName) return showError('소모임 이름을 적거나 위에서 골라 주세요.');
  const title = f.title.value.trim() || (isGroup ? groupName : '');
  if (!title) return showError('제목을 입력해 주세요.');
  if (!f.date.value) return showError('날짜를 골라 주세요.');
  if (toMin(f.end.value) <= toMin(f.start.value)) return showError('종료 시간은 시작 시간보다 늦어야 해요.');

  try {
    const group = isGroup ? await ensureGroup(groupName) : null;
    const photos = [];
    for (const p of draftPhotos) photos.push(p.id || await DataStore.savePhoto(p.blob));
    const attendees = new Set(draftAttendees);
    if (state.user && f.rsvp.checked) {
      if (f.attend.checked) attendees.add(state.user);
      else attendees.delete(state.user);
    }
    await DataStore.upsert({
      id: editingId || undefined,
      title,
      category: f.category.value,
      groupId: group?.id || '',
      rsvp: f.category.value !== 'personal' && f.rsvp.checked,
      attendees: [...attendees],
      date: f.date.value,
      start: f.start.value,
      end: f.end.value,
      color: group ? group.color : getColorIn(form),
      location: f.location.value.trim(),
      memo: f.memo.value.trim(),
      record: {
        participants: f.participants.value.trim(),
        content: f.recordContent.value.trim(),
        photos,
        nextDate: f.nextDate.value,
      },
    }, author());
    for (const id of removedPhotoIds) {
      await DataStore.deletePhoto(id).catch(() => {});
      forgetPhoto(id);
    }
  } catch (err) {
    return showError('저장하지 못했어요. 저장 공간이 부족하거나 브라우저가 저장을 막고 있을 수 있어요.');
  }
  const date = f.date.value;
  dlg.close();
  if (state.view !== 'records') setDate(date); // 저장한 일정이 보이는 곳으로 이동
  refresh();
});

$('#btn-delete').addEventListener('click', async () => {
  if (!editingId || !confirm('이 일정을 삭제할까요? 기록과 사진도 함께 지워져요.')) return;
  await DataStore.remove(editingId, author());
  dlg.close();
  refresh();
});

$('#btn-cancel').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 바깥 클릭 시 닫기
dlg.addEventListener('close', cleanupDraft);

/* ---------- 소모임 만들기·고치기 창 ---------- */

const groupDlg = $('#group-dialog');
const groupForm = $('#group-form');
let editingGroupId = null;

function groupError(msg) {
  $('#group-error').textContent = msg;
  $('#group-error').hidden = !msg;
}

function openGroupDialog(group) {
  editingGroupId = group?.id || null;
  groupForm.reset();
  groupError('');
  $('#group-dialog-title').textContent = group ? '소모임 편집' : '소모임 만들기';
  groupForm.elements.name.value = group?.name || '';
  setColorIn(groupForm, group?.color || nextGroupColor());
  const meta = $('#group-meta');
  meta.hidden = !group;
  if (group) meta.textContent = `만든 사람 ${group.createdBy || '알 수 없음'} · ${fmtStamp(group.createdAt)}`;
  $('#btn-group-delete').hidden = !group;
  groupDlg.showModal();
  groupForm.elements.name.focus();
}

watchCustomColor(groupForm);

groupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = groupForm.elements.name.value.trim();
  if (!name) return groupError('소모임 이름을 적어 주세요.');
  if (state.groups.some((g) => g.id !== editingGroupId && sameName(g.name, name))) {
    return groupError('같은 이름의 소모임이 이미 있어요.');
  }
  await DataStore.upsertGroup({ id: editingGroupId || undefined, name, color: getColorIn(groupForm) }, author());
  groupDlg.close();
  refresh();
});

$('#btn-group-delete').addEventListener('click', async () => {
  const g = groupById(editingGroupId);
  if (!g || !confirm(`"${g.name}" 소모임을 인덱스에서 삭제할까요?\n이 소모임의 일정은 지워지지 않고 그대로 남아요.`)) return;
  await DataStore.removeGroup(g.id, author());
  groupDlg.close();
  refresh();
});

$('#btn-group-cancel').addEventListener('click', () => groupDlg.close());
groupDlg.addEventListener('click', (e) => { if (e.target === groupDlg) groupDlg.close(); });

/* ---------- 생일 등록·수정 창 ---------- */

const bdayDlg = $('#bday-dialog');
const bdayForm = $('#bday-form');
let editingBdayId = null;

for (let m = 1; m <= 12; m++) bdayForm.elements.month.add(new Option(`${m}월`, m));
for (let d = 1; d <= 31; d++) bdayForm.elements.day.add(new Option(`${d}일`, d));

function bdayError(msg) {
  $('#bday-error').textContent = msg;
  $('#bday-error').hidden = !msg;
}

function openBdayDialog(b) {
  editingBdayId = b?.id || null;
  bdayForm.reset();
  bdayError('');
  $('#bday-dialog-title').textContent = b ? '🎂 생일 수정' : '🎂 생일 등록';
  const [, m, d] = state.date.split('-').map(Number); // 새로 등록할 땐 선택한 날짜로 미리 채워요
  bdayForm.elements.name.value = b?.name || '';
  bdayForm.elements.month.value = b?.month || m;
  bdayForm.elements.day.value = b?.day || d;
  $('#btn-bday-delete').hidden = !b;
  bdayDlg.showModal();
  bdayForm.elements.name.focus();
}

bdayForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = bdayForm.elements.name.value.trim();
  if (!name) return bdayError('이름을 적어 주세요.');
  const month = Number(bdayForm.elements.month.value);
  const day = Number(bdayForm.elements.day.value);
  if (day > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return bdayError(`${month}월에는 ${day}일이 없어요.`);
  await DataStore.upsertBirthday({ id: editingBdayId || undefined, name, month, day }, author());
  bdayDlg.close();
  refresh();
});

$('#btn-bday-delete').addEventListener('click', async () => {
  const b = state.birthdays.find((x) => x.id === editingBdayId);
  if (!b || !confirm(`${b.name}님의 생일을 삭제할까요?`)) return;
  await DataStore.removeBirthday(b.id, author());
  bdayDlg.close();
  refresh();
});

$('#btn-bday-cancel').addEventListener('click', () => bdayDlg.close());
bdayDlg.addEventListener('click', (e) => { if (e.target === bdayDlg) bdayDlg.close(); });

/* ---------- 내 이름 ---------- */

const nameDlg = $('#name-dialog');
const nameForm = $('#name-form');

function updateUserChip() {
  $('#btn-user').innerHTML = `<span class="avatar">${esc((state.user || '?').slice(0, 1))}</span>
    <span class="user-text"><b>${esc(state.user || '이름 설정')}</b><small>이름 바꾸기</small></span>`;
}

function askName() {
  nameForm.elements.name.value = state.user;
  nameDlg.showModal();
}

nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameForm.elements.name.value.trim();
  if (!name) return nameForm.elements.name.focus();
  state.user = name;
  savePref('name', name);
  updateUserChip();
  nameDlg.close();
});

$('#btn-user').addEventListener('click', askName);

/* ---------- 마우스를 올리면 뜨는 일정 카드 (제목·시간·참석자 명단) ---------- */

const hoverCard = document.createElement('div');
hoverCard.className = 'hovercard';
hoverCard.hidden = true;
document.body.appendChild(hoverCard);
const HOVER_TARGETS = '.mo-chip, .wp-ev, .ev';

function hoverHTML(e) {
  const g = groupOf(e);
  const where = [g?.name, e.location].filter(Boolean).map(esc).join(' · ');
  let people = '';
  if (e.rsvp) {
    people = e.attendees.length
      ? `<div class="hc-label">✋ 참석 ${e.attendees.length}명</div>
         <div class="hc-names">${e.attendees.map((n) => `<span class="hc-name${n === state.user ? ' me' : ''}">${esc(n)}</span>`).join('')}</div>`
      : '<div class="hc-label">✋ 아직 참석자가 없어요</div>';
  }
  return `<div class="hc-title"><span class="dot" style="--c:${colorOf(e)}"></span>${esc(e.title)}</div>
    <div class="hc-meta">${dateLabel(e.date)} · ${e.start}–${e.end}</div>
    ${where ? `<div class="hc-meta">${where}</div>` : ''}
    ${people}`;
}

function showHover(target) {
  const e = state.events.find((x) => x.id === target.dataset.id);
  if (!e) return hideHover();
  hoverCard.innerHTML = hoverHTML(e);
  hoverCard.hidden = false;
  // 일정 바로 아래에 띄우고, 화면 밖으로 나가면 위쪽/안쪽으로 옮겨요
  const r = target.getBoundingClientRect();
  const w = hoverCard.offsetWidth;
  const h = hoverCard.offsetHeight;
  const top = r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6;
  hoverCard.style.top = Math.max(8, top) + 'px';
  hoverCard.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
}

function hideHover() {
  hoverCard.hidden = true;
}

viewEl.addEventListener('mouseover', (e) => {
  const t = e.target.closest(HOVER_TARGETS);
  if (t) showHover(t);
});
viewEl.addEventListener('mouseout', (e) => {
  const from = e.target.closest(HOVER_TARGETS);
  if (from && !from.contains(e.relatedTarget)) hideHover();
});
addEventListener('scroll', hideHover, true);
viewEl.addEventListener('click', hideHover);

/* ---------- 화면 클릭 처리 ---------- */

viewEl.addEventListener('click', (e) => {
  const t = e.target.closest('[data-attend],[data-photo-view],[data-id],[data-record],[data-next],[data-add],[data-wk],[data-open-week],[data-more],[data-bday],[data-new-bday],[data-goto-records],.slot,.mo-cell');
  if (!t) return;
  const ds = t.dataset;
  if (ds.photoView) return photoURL(ds.photoView).then(showPhoto);
  if (ds.attend) return toggleAttend(ds.attend);
  if (ds.bday) return openBdayDialog(state.birthdays.find((b) => b.id === ds.bday));
  if ('newBday' in ds) return openBdayDialog(null);
  if ('gotoRecords' in ds) return goView('records');
  if (ds.id) return openById(ds.id);
  if (ds.record) return openById(ds.record, { focusRecord: true });
  if (ds.next) return openNext(ds.next);
  if (ds.add) return openModal({ date: ds.add });
  if (ds.wk) { setDate(addDays(state.date, 7 * Number(ds.wk))); return render(); }
  if (ds.openWeek || ds.more) { setDate(ds.openWeek || ds.more); return goView('week'); }
  if (t.matches('.slot')) return openModal({ date: ds.date, start: ds.time });
  if (t.matches('.mo-cell')) { setDate(ds.date); return render(); } // 날짜 선택 → 오른쪽 주간이 그 주로 바뀜
});

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => goView(tab.dataset.view)));

function moveBy(n) {
  if (state.view === 'month') {
    state.month = shiftMonth(state.month, n);
    const today = todayKST();
    state.date = today.slice(0, 7) === state.month.slice(0, 7) ? today : state.month;
  } else {
    setDate(addDays(state.date, 7 * n));
  }
  render();
}

$('#btn-prev').addEventListener('click', () => moveBy(-1));
$('#btn-next').addEventListener('click', () => moveBy(1));
$('#btn-today').addEventListener('click', () => { setDate(todayKST()); render(); });
$('#btn-add').addEventListener('click', () => openModal({ date: state.view === 'records' ? todayKST() : state.date }));

/* ---------- 백업: 내보내기 / 가져오기 ---------- */

$('#btn-export').addEventListener('click', async () => {
  const blob = new Blob([await DataStore.exportData()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `63기-아카이브-${todayKST()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { added, updated, photos, groups, birthdays } = await DataStore.importData(await file.text());
    alert(`가져오기 완료!\n새 일정 ${added}개, 업데이트 ${updated}개, 새 소모임 ${groups}개, 생일 ${birthdays}명, 사진 ${photos}장`);
    refresh();
  } catch (err) {
    alert('파일을 읽지 못했어요. 이 앱에서 "내보내기"한 파일인지 확인해 주세요.');
  }
  e.target.value = '';
});

// 현재 시각 빨간 선을 1분마다 옮겨요
setInterval(() => {
  const line = viewEl.querySelector('.now-line');
  const top = nowLineTop();
  if (line && top) line.style.top = top;
}, 60 * 1000);

/* ---------- 시작 ---------- */
setupForm();
updateUserChip();
refresh();
if (!state.user) askName();
