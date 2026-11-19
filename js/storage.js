// 데이터 저장소
// 지금은 이 브라우저 안에만 저장해요.
//  - 일정·소모임 글자 데이터 → localStorage (작고 빠른 저장 공간)
//  - 사진                   → IndexedDB    (사진처럼 큰 파일용 저장 공간)
// 나중에 "링크만 알면 누구나 수정" 단계(예: Firebase, Supabase)로 갈 때는
// 이 파일의 함수 내용만 서버 통신으로 바꾸면 되고, 화면 코드(app.js)는 그대로 둘 수 있어요.
// 그래서 모든 함수를 async(비동기)로 만들어 두었어요. 서버 통신도 같은 모양이거든요.

const DataStore = (() => {
  const KEY = 'p63-archive:v1';
  const CATEGORIES = ['all', 'group', 'personal'];
  const MAX_PHOTOS = 20;

  const empty = () => ({ version: 1, events: [], groups: [], birthdays: [] });

  function read() {
    try {
      const db = JSON.parse(localStorage.getItem(KEY));
      if (!db || !Array.isArray(db.events)) return empty();
      if (!Array.isArray(db.groups)) db.groups = [];
      if (!Array.isArray(db.birthdays)) db.birthdays = [];
      return db;
    } catch (e) {
      return empty();
    }
  }

  function write(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
  }

  const str = (v, max) => String(v ?? '').slice(0, max);
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isColor = (v) => /^#[0-9a-f]{6}$/i.test(v);

  // 누가 언제 만들고 고쳤는지 + 삭제 표시 (일정·소모임 공통)
  function stamps(raw) {
    return {
      createdAt: str(raw.createdAt, 30),
      createdBy: str(raw.createdBy, 20),  // 처음 만든 사람
      updatedAt: str(raw.updatedAt, 30),  // 동기화할 때 "누가 더 최신인지" 비교하는 데 써요
      updatedBy: str(raw.updatedBy, 20),  // 마지막으로 고친 사람
      deleted: !!raw.deleted,             // 지워도 표시만 해두면 다른 기기에도 삭제를 전달할 수 있어요
    };
  }

  // 일정 한 개의 모양을 항상 똑같이 맞춰요 (가져온 파일이 이상해도 안전하게)
  function normalize(raw) {
    const time = (v, fallback) => (/^\d{2}:\d{2}$/.test(v) ? v : fallback);
    const r = raw.record || {};
    const record = {
      participants: str(r.participants, 200),
      content: str(r.content, 5000),
      photos: (Array.isArray(r.photos) ? r.photos : []).filter((id) => /^ph_[a-z0-9]+$/.test(id)).slice(0, MAX_PHOTOS),
      nextDate: isDate(r.nextDate) ? r.nextDate : '',
    };
    const hasRecord = record.participants || record.content || record.photos.length || record.nextDate;
    return {
      id: str(raw.id, 40),
      title: str(raw.title, 60),
      category: CATEGORIES.includes(raw.category) ? raw.category : 'all',
      groupId: raw.category === 'group' ? str(raw.groupId, 40) : '', // 어느 소모임 일정인지
      // 참석 체크를 받는 일정인지 (예전 일정은 소모임이면 받는 걸로)
      rsvp: typeof raw.rsvp === 'boolean' ? raw.rsvp : raw.category === 'group',
      // [참석]을 누른 사람 이름 목록 (같은 이름은 한 번만)
      attendees: [...new Set((Array.isArray(raw.attendees) ? raw.attendees : []).map((n) => str(n, 20).trim()).filter(Boolean))].slice(0, 200),
      date: isDate(raw.date) ? raw.date : todayKST(),
      start: time(raw.start, '09:00'),
      end: time(raw.end, '10:00'),
      color: isColor(raw.color) ? raw.color : '#3b6fe0',
      location: str(raw.location, 60),
      memo: str(raw.memo, 500),
      record: hasRecord ? record : null,
      ...stamps(raw),
    };
  }

  // 소모임 한 개의 모양
  function normalizeGroup(raw) {
    return {
      id: str(raw.id, 40),
      name: str(raw.name, 30),
      color: isColor(raw.color) ? raw.color : '#2fa36b',
      ...stamps(raw),
    };
  }

  // 생일 한 개의 모양 (연도 없이 월·일만)
  function normalizeBirthday(raw) {
    const num = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v)) || min));
    return {
      id: str(raw.id, 40),
      name: str(raw.name, 20),
      month: num(raw.month, 1, 12),
      day: num(raw.day, 1, 31),
      ...stamps(raw),
    };
  }

  // 목록에 추가하거나(새것) 고치기(있던 것). 고친 사람·시각을 함께 남겨요.
  function upsertIn(list, input, by, norm) {
    const now = new Date().toISOString();
    const i = list.findIndex((x) => x.id === input.id);
    if (i >= 0) {
      list[i] = norm({ ...list[i], ...input, updatedAt: now, updatedBy: by });
      return list[i].id;
    }
    const item = norm({ ...input, id: uid(), createdAt: now, createdBy: by, updatedAt: now, updatedBy: by });
    list.push(item);
    return item.id;
  }

  function markDeleted(item, by) {
    item.deleted = true;
    item.updatedAt = new Date().toISOString();
    item.updatedBy = by;
  }

  // 가져온 목록을 합치기: 같은 것이면 더 최근에 고친 쪽을 남겨요
  function mergeInto(list, incoming, norm) {
    let added = 0;
    let updated = 0;
    (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
      if (!raw || !raw.id) return;
      const item = norm(raw);
      const i = list.findIndex((x) => x.id === item.id);
      if (i < 0) {
        list.push(item);
        added++;
      } else if (item.updatedAt > (list[i].updatedAt || '')) {
        list[i] = item;
        updated++;
      }
    });
    return { added, updated };
  }

  /* ---------- 사진 저장 (IndexedDB) ---------- */

  let photoDB = null;
  function openPhotoDB() {
    photoDB = photoDB || new Promise((resolve, reject) => {
      const req = indexedDB.open('p63-photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return photoDB;
  }

  async function photoTx(mode, fn) {
    const db = await openPhotoDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', mode);
      const req = fn(tx.objectStore('photos'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  const getPhoto = (id) => photoTx('readonly', (s) => s.get(id));
  const putPhoto = (id, blob) => photoTx('readwrite', (s) => s.put(blob, id));
  const deletePhoto = (id) => photoTx('readwrite', (s) => s.delete(id));

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(url) {
    const [head, data] = url.split(',');
    const type = (head.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  return {
    MAX_PHOTOS,

    /* 일정 */
    async list() {
      return read().events.map(normalize).filter((e) => !e.deleted);
    },

    // by: 지금 작업하는 사람 이름
    async upsert(input, by) {
      const db = read();
      const id = upsertIn(db.events, input, by, normalize);
      write(db);
      return id;
    },

    async remove(id, by) {
      const db = read();
      const e = db.events.find((x) => x.id === id);
      if (!e) return;
      for (const pid of e.record?.photos || []) await deletePhoto(pid).catch(() => {});
      markDeleted(e, by);
      write(db);
    },

    /* 소모임 */
    async listGroups() {
      return read().groups.map(normalizeGroup).filter((g) => !g.deleted)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async upsertGroup(input, by) {
      const db = read();
      const id = upsertIn(db.groups, input, by, normalizeGroup);
      write(db);
      return id;
    },

    // 소모임을 지워도 일정은 남아요 (소모임 표시만 사라짐)
    async removeGroup(id, by) {
      const db = read();
      const g = db.groups.find((x) => x.id === id);
      if (!g) return;
      markDeleted(g, by);
      write(db);
    },

    /* 생일 */
    async listBirthdays() {
      return read().birthdays.map(normalizeBirthday).filter((b) => !b.deleted)
        .sort((a, b) => a.month - b.month || a.day - b.day);
    },

    async upsertBirthday(input, by) {
      const db = read();
      const id = upsertIn(db.birthdays, input, by, normalizeBirthday);
      write(db);
      return id;
    },

    async removeBirthday(id, by) {
      const db = read();
      const b = db.birthdays.find((x) => x.id === id);
      if (!b) return;
      markDeleted(b, by);
      write(db);
    },

    /* 사진 */
    async savePhoto(blob) {
      const id = 'ph_' + uid();
      await putPhoto(id, blob);
      return id;
    },
    getPhoto,
    deletePhoto,

    /* 백업 */
    // 일정 + 소모임 + 생일 + 사진을 파일 하나로 내보내요
    async exportData() {
      const db = read();
      const photos = {};
      for (const e of db.events) {
        if (e.deleted) continue;
        for (const pid of e.record?.photos || []) {
          const blob = await getPhoto(pid).catch(() => null);
          if (blob) photos[pid] = await blobToDataURL(blob);
        }
      }
      return JSON.stringify({ ...db, photos, exportedAt: new Date().toISOString() });
    },

    async importData(text) {
      const incoming = JSON.parse(text);
      if (!incoming || !Array.isArray(incoming.events)) throw new Error('형식이 맞지 않아요');
      const db = read();
      const { added, updated } = mergeInto(db.events, incoming.events, normalize);
      const groups = mergeInto(db.groups, incoming.groups, normalizeGroup);
      const birthdays = mergeInto(db.birthdays, incoming.birthdays, normalizeBirthday);
      write(db);
      let photos = 0;
      for (const [pid, url] of Object.entries(incoming.photos || {})) {
        if (!/^ph_[a-z0-9]+$/.test(pid) || typeof url !== 'string' || !url.startsWith('data:image/')) continue;
        if (await getPhoto(pid)) continue;
        await putPhoto(pid, dataURLToBlob(url));
        photos++;
      }
      return { added, updated, photos, groups: groups.added, birthdays: birthdays.added };
    },
  };
})();
