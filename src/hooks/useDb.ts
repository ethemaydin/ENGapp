/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AppDatabase üzerinde yapılan tekrarlayan (boilerplate) güncellemeleri
 * tek yerde toplayan yardımcı hook. App.tsx'in içinde dağınık hâlde
 * bulunan "findIndex → kopya dizi → setState" kalıplarını değiştirir.
 */

import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Student, Topic, Homework, LessonSchedule, SubTopic } from '../types.ts';
import type { AppDatabase } from '../utils/storage.ts';

export interface DbActions {
  /** Öğrenciyi stabil id'si üzerinden günceller; öğrenci yoksa db'yi değiştirmeden bırakır. */
  updateStudent: (studentId: string, fn: (s: Student) => Student) => void;
  /** Bir konuyu (id) günceller. */
  updateTopic: (topicId: string, fn: (t: Topic) => Topic) => void;
  /** Konunun bir alt konusunu (sid) günceller. */
  updateSubTopic: (topicId: string, subId: string, fn: (sub: SubTopic) => SubTopic) => void;
  /** Bir ödevi (id) günceller. */
  updateHomework: (hwId: number, fn: (h: Homework) => Homework) => void;
  /** Bir ders planını (id) günceller. */
  updateLesson: (lessonId: number, fn: (l: LessonSchedule) => LessonSchedule) => void;
  /** Id tabanlı kayıt ekleme/kaldırma gibi serbest güncellemeler için escape hatch. */
  patch: (fn: (prev: AppDatabase) => AppDatabase) => void;
}

export function useDbActions(setDb: Dispatch<SetStateAction<AppDatabase>>): DbActions {
  const patch = useCallback((fn: (prev: AppDatabase) => AppDatabase) => setDb(fn), [setDb]);

  const updateStudent = useCallback(
    (studentId: string, fn: (s: Student) => Student) => {
      setDb((prev) => {
        const idx = prev.students.findIndex((x) => x.id === studentId);
        if (idx < 0) return prev;
        const students = [...prev.students];
        students[idx] = fn(students[idx]);
        return { ...prev, students };
      });
    },
    [setDb],
  );

  const updateTopic = useCallback(
    (topicId: string, fn: (t: Topic) => Topic) => {
      setDb((prev) => ({
        ...prev,
        topics: prev.topics.map((t) => (t.id === topicId ? fn(t) : t)),
      }));
    },
    [setDb],
  );

  const updateSubTopic = useCallback(
    (topicId: string, subId: string, fn: (sub: SubTopic) => SubTopic) => {
      setDb((prev) => ({
        ...prev,
        topics: prev.topics.map((t) =>
          t.id === topicId
            ? { ...t, subs: (t.subs || []).map((s) => (s.id === subId ? fn(s) : s)) }
            : t,
        ),
      }));
    },
    [setDb],
  );

  const updateHomework = useCallback(
    (hwId: number, fn: (h: Homework) => Homework) => {
      setDb((prev) => ({
        ...prev,
        homeworks: prev.homeworks.map((h) => (h.id === hwId ? fn(h) : h)),
      }));
    },
    [setDb],
  );

  const updateLesson = useCallback(
    (lessonId: number, fn: (l: LessonSchedule) => LessonSchedule) => {
      setDb((prev) => ({
        ...prev,
        lessons: prev.lessons.map((l) => (l.id === lessonId ? fn(l) : l)),
      }));
    },
    [setDb],
  );

  return { updateStudent, updateTopic, updateSubTopic, updateHomework, updateLesson, patch };
}
