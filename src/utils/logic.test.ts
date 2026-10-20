import { test, expect } from 'vitest';
import { rate, miss, ans, psize, pn, hwDone, hsh, setHwRecord } from './logic.ts';
import type { Student, Homework, Question } from '../types.ts';

/** App.tsx'teki addPuzzlePiece güncelleyicisinin saf (React'ten bağımsız) kopyası —
 *  mutasyon regresyonlarını yakalamak için kullanılır. */
const addPuzzlePieceUpdater = (prev: Student): Student => {
  const s = { ...prev };
  let nextNxt = s.nxt;
  s.act = s.act ? { ...s.act } : { id: nextNxt + 1, n: 0 };
  nextNxt = s.act.id;
  s.nxt = nextNxt;
  s.act.n++;
  if (s.act.n >= psize(s.act.id)) {
    s.cp = [...s.cp, s.act.id];
    s.act = null;
  }
  return s;
};

test('addPuzzlePiece never mutates the previous student object', () => {
  const base: Student = {
    id: 's1', n: 'Test', lv: 'A1', p: 0, a: '', c: undefined as any, e: 't@t.com', pw: '1',
    h: {}, goal: 10, kn: [], cp: [], td: {}, sd: {}, nxt: 3, tc: 0, wl: 0, tpass: {}, act: null,
  };
  const frozen = JSON.parse(JSON.stringify(base));

  const s1 = addPuzzlePieceUpdater(base);
  // prev nesnesi değişmemiş olmalı (yüzeysel ++s.nxt mutasyonunu yakalar)
  expect(base.nxt).toBe(frozen.nxt);
  expect(s1.nxt).toBe(4);
  expect(s1.act).toEqual({ id: 4, n: 1 });

  // aktif yapboz varken parça eklemek nxt'yi/değişmezliği korumalı
  const s2 = addPuzzlePieceUpdater(s1);
  expect(s1.act).toEqual({ id: 4, n: 1 }); // s1 mutasyona uğramadı
  expect(s2.act).toEqual({ id: 4, n: 2 });
});

test('completing a topic assigns fresh puzzle ids without mutating prev', () => {
  const prev: Student = {
    id: 's1', n: 'Test', lv: 'A1', p: 0, a: '', c: undefined as any, e: 't@t.com', pw: '1',
    h: {}, goal: 10, kn: [], cp: [1], td: {}, sd: {}, nxt: 1, tc: 0, wl: 0, tpass: {},
  };
  // App.tsx handleCompleteTopic mantığı (nxt+1, mutasyonsuz)
  const s = { ...prev };
  const nextId = s.nxt + 1;
  s.nxt = nextId;
  s.cp = [...s.cp, nextId];

  expect(prev.nxt).toBe(1); // prev mutasyona uğramadı
  expect(s.cp).toEqual([1, 2]); // çakışan id yok
});

test('setHwRecord is immutable and preserves other homework records', () => {
  const s: Student = {
    id: 's1', n: 'Test', lv: 'A1', p: 0, a: '', c: undefined as any, e: 't@t.com', pw: '1',
    h: { 5: { score: 80, text: '' } }, goal: 10, kn: [], cp: [], td: {}, sd: {},
    nxt: 0, tc: 0, wl: 0, tpass: {},
  };
  const updated = setHwRecord(s, 7, { score: 90, text: '' });
  expect(s.h[7]).toBeUndefined(); // orijinal bozulmadı
  expect(updated.h[5].score).toBe(80); // diğer kayıt korundu
  expect(updated.h[7].score).toBe(90);
});

test('rate and miss calculations work correctly for attendance', () => {
  const student: Student = {
    id: 's1',
    n: 'Elif Yılmaz',
    lv: 'A1',
    p: 40,
    a: 'gggygg',
    c: 'c1',
    e: 'elif@ornek.com',
    pw: '1234',
    h: {},
    goal: 10,
    kn: [],
    cp: [],
    td: {},
    sd: {},
    nxt: 0,
    tc: 0,
    wl: 0,
    tpass: {},
  };

  expect(miss(student)).toBe(1);
  expect(rate(student)).toBe(83); // 5/6 = 83.33% -> 83%

  const perfectStudent = { ...student, a: 'gggggg' };
  expect(miss(perfectStudent)).toBe(0);
  expect(rate(perfectStudent)).toBe(100);

  const studentWithExcluded = { ...student, a: 'g-gy-g' };
  expect(miss(studentWithExcluded)).toBe(1);
  expect(rate(studentWithExcluded)).toBe(75); // 3 out of 4 counted = 75%
});

test('ans resolves correct answer string for all question kinds', () => {
  const mc1: Question = { k: 'mc', q: 'Sample', o: ['A', 'B', 'C'], c: 'B' };
  expect(ans(mc1)).toBe('B');

  const mc2: Question = { k: 'mc', q: 'Sample', o: ['A', 'B', 'C'], a: 0 };
  expect(ans(mc2)).toBe('A');

  const fill: Question = { k: 'fill', q: 'Sample ___', a: 'am' };
  expect(ans(fill)).toBe('am');

  const order: Question = { k: 'order', q: 'Sample', w: ['I', 'am', 'here'] };
  expect(ans(order)).toBe('I am here');

  const listen: Question = { k: 'listen', s: 'Nice to meet you', o: ['Nice', 'Thank you'] };
  expect(ans(listen)).toBe('Nice to meet you');
});

test('psize returns 4 for small puzzle IDs and 10 for larger ones', () => {
  expect(psize(1)).toBe(4);
  expect(psize(10)).toBe(4);
  expect(psize(11)).toBe(10);
});

test('pn generates deterministic titles for puzzle art', () => {
  const title1 = pn(1);
  const title2 = pn(1);
  expect(title1).toBe(title2);
  expect(title1.includes('#1')).toBe(true);
});

test('hwDone handles writing and test homework requirements', () => {
  const s: Student = {
    id: 's1',
    n: 'Test',
    lv: 'A1',
    p: 0,
    a: 'g',
    c: 'c1',
    e: 't@e.com',
    pw: '123',
    h: {},
    goal: 10,
    kn: [],
    cp: [],
    td: {},
    sd: {},
    nxt: 0,
    tc: 0,
    wl: 0,
    tpass: {},
  };

  const writeHw: Homework = {
    id: 101,
    t: 'Write intro',
    due: 'Tomorrow',
    type: 'write',
    topic: '',
    to: ['s1'],
    q: [],
  };

  expect(hwDone(writeHw, s)).toBe(false);
  s.h[101] = { score: null, text: 'Hello, I am student.' };
  expect(hwDone(writeHw, s)).toBe(true);

  const testHw: Homework = {
    id: 102,
    t: 'Quiz HW',
    due: 'Friday',
    type: 'test',
    topic: '',
    pass: 70,
    to: ['s1'],
    q: [],
  };

  expect(hwDone(testHw, s)).toBe(false);
  s.h[102] = { score: 65, text: '' };
  expect(hwDone(testHw, s)).toBe(false);
  s.h[102] = { score: 70, text: '' };
  expect(hwDone(testHw, s)).toBe(true);
});

test('hsh creates consistent hash codes', () => {
  expect(hsh('1234')).toBe(hsh('1234'));
  expect(hsh('1234')).not.toBe(hsh('5678'));
});
