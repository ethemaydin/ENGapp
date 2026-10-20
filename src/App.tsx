/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Uygulama kök bileşeni. Yeniden düzenleme notları:
 * - 1350 satırlık tek dosya; router tipleri (navigation.ts), veritabanı
 *   güncelleme yardımcıları (hooks/useDb.ts) ve içerik senkronizasyonu
 *   (hooks/useContentSync.ts) ayrı modüllere ayrıştırıldı.
 * - İç içe ternary zinciri okunabilir bir `renderScreen()` switch'ine dönüştürüldü.
 * - Tekrarlayan "findIndex → kopya dizi → setDb" kalıpları db.updateStudent vb.
 *   helper'larla değiştirildi; davranış birebir korundu.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  User,
  Student,
  Topic,
  WordItem,
  Homework,
  LessonSchedule,
  NotificationItem,
  BroadcastMessage,
  Question,
} from './types.ts';
import { loadDatabase, saveDatabase, genId } from './utils/storage.ts';
import { syncStudentProgress, loadIdMap } from './utils/supabaseSync.ts';
import { supabase } from './lib/supabase.ts';
import { shuf, today, wstat, psize, pn, setHwRecord, dedupeOptions } from './utils/logic.ts';
import { AndroidFrame } from './components/AndroidFrame.tsx';
import { Navigation } from './components/Navigation.tsx';
import { Toast, ToastData } from './components/Toast.tsx';
import { CelebrationModal, CelebrationData } from './components/CelebrationModal.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { useDbActions } from './hooks/useDb.ts';
import { useContentSync } from './hooks/useContentSync.ts';
import type { ScreenState } from './navigation.ts';

// Öğrenci görünümleri
import { LoginView } from './views/LoginView.tsx';
import { ForcePasswordView } from './views/ForcePasswordView.tsx';
import { HomeView } from './views/HomeView.tsx';
import { TopicView } from './views/TopicView.tsx';
import { SubTopicView } from './views/SubTopicView.tsx';
import { QuizView } from './views/QuizView.tsx';
import { QuizResultView } from './views/QuizResultView.tsx';
import { FlashcardsView } from './views/FlashcardsView.tsx';
import { HomeworkView } from './views/HomeworkView.tsx';
import { WritingHomeworkView } from './views/WritingHomeworkView.tsx';
import { CalendarView } from './views/CalendarView.tsx';
import { NotificationsView } from './views/NotificationsView.tsx';
import { AccountView } from './views/AccountView.tsx';

// Öğretmen görünümleri
import { StudentsView } from './views/StudentsView.tsx';
import { StudentDetailView } from './views/StudentDetailView.tsx';
import { ClassesEditorView } from './views/ClassesEditorView.tsx';
import { TeacherCalendarView } from './views/TeacherCalendarView.tsx';
import { LessonEditorView } from './views/LessonEditorView.tsx';
import { AttendanceView } from './views/AttendanceView.tsx';
import { TeacherCoursesView } from './views/TeacherCoursesView.tsx';
import { TopicEditorView } from './views/TopicEditorView.tsx';
import { SubTopicEditorView } from './views/SubTopicEditorView.tsx';
import { HomeworkEditorView } from './views/HomeworkEditorView.tsx';
import { TeacherNotificationsView } from './views/TeacherNotificationsView.tsx';

/** Referans alınan içerik bulunamadığında gösterilen güvenli ara ekran. */
const MissingScreen: React.FC<{ label: string; onBack: () => void }> = ({ label, onBack }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
    <span className="text-5xl">🧭</span>
    <h2 className="text-lg font-black text-[var(--ink)]">{label} bulunamadı</h2>
    <p className="text-xs text-[var(--mute)] max-w-xs">
      Bu içerik silinmiş olabilir ya da henüz cihazına ulaşmadı. Ana ekrandan tekrar deneyebilirsin.
    </p>
    <button
      type="button"
      onClick={onBack}
      className="py-3 px-6 rounded-xl font-extrabold text-sm text-white cursor-pointer shadow-md"
      style={{ backgroundColor: 'var(--pri)' }}
    >
      ‹ Ana ekran
    </button>
  </div>
);

export default function App() {
  const [db, setDb] = useState(loadDatabase);
  const dbActions = useDbActions(setDb);
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('eb_session_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState<string>('home');
  const [screenState, setScreenState] = useState<ScreenState>({ screen: 'main' });
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [lastScores, setLastScores] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<ToastData | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);

  // ---- Temel efektler ----
  useEffect(() => {
    saveDatabase(db);
  }, [db]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('eb_session_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('eb_session_user');
    }
  }, [user]);

  useEffect(() => {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const showToast = useCallback((title: string, message: string) => {
    setToast({ title, message });
    setTimeout(() => {
      setToast((cur) => (cur?.title === title ? null : cur));
    }, 6000);
  }, []);

  const showCelebration = useCallback((title: string, message: string, puzzleId?: number) => {
    setCelebration({ title, message, puzzleId });
  }, []);

  // Planlanan duyuruları zamanı gelince teslim et (15 sn'de bir kontrol)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setDb((prev) => {
        let changed = false;
        let allNewNotifs: NotificationItem[] = [];
        const updatedBroadcasts = prev.broadcasts.map((b) => {
          if (!b.sent && b.when && b.when <= now) {
            changed = true;
            const newNotifs: NotificationItem[] = b.to.map((sid) => ({
              si: sid,
              t: `🔔 ${b.t}`,
              m: b.m,
              at: new Date(),
            }));
            allNewNotifs = [...allNewNotifs, ...newNotifs];
            return { ...b, sent: true, sentAt: new Date() };
          }
          return b;
        });

        if (changed) {
          // prev mutasyonu kaldırıldı: çift bildirim gönderimine yol açıyordu
          return {
            ...prev,
            broadcasts: updatedBroadcasts,
            notifications: [...allNewNotifs, ...prev.notifications],
          };
        }
        return prev;
      });
    }, 15000);

    return () => clearInterval(timer);
  }, [setDb]);

  // Otomatik içerik yenileme (polling + realtime) — ayrı hook
  useContentSync(user, setDb);

  // ---- Öğrenci ilerleme handler'ları ----
  const addPuzzlePiece = (studentId: string) => {
    dbActions.updateStudent(studentId, (prev) => {
      const s = { ...prev };

      // NOT: s, prev'in yüzeysel kopyasıdır; nxt'i doğrudan artırmak
      // state updater içinde önceki nesneyi mutasyona uğratır.
      // Bu yüzden güncel değeri local bir değişken üzerinden takip ediyoruz.
      let nextNxt = s.nxt;
      s.act = s.act ? { ...s.act } : { id: nextNxt + 1, n: 0 };
      nextNxt = s.act.id; // yeni aktif yapboz id'si de sayaçtır
      s.nxt = nextNxt;
      s.act.n++;

      const targetPieces = psize(s.act.id);
      if (s.act.n >= targetPieces) {
        s.cp = [...s.cp, s.act.id];
        const completedId = s.act.id;
        s.act = null;
        showCelebration('🧩 Yapboz tamamlandı!', pn(completedId), completedId);
      } else {
        showToast('🧩 Yeni yapboz parçası!', `${pn(s.act.id)} · ${s.act.n}/${targetPieces}`);
      }

      return s;
    });
  };

  const handleWordLearned = (wordId: number) => {
    if (!user || user.role !== 's' || !user.si) return;
    const sid = user.si;

    dbActions.updateStudent(sid, (prev) => {
      const s = { ...prev };

      if (!s.kn.includes(wordId)) {
        s.kn = [...s.kn, wordId];
        s.wl = (s.wl || 0) + 1;
        if (s.wl % 10 === 0) {
          setTimeout(() => addPuzzlePiece(sid), 500);
        }
      }

      const d = wstat({ ...s });
      s.day = { d: d.d, n: d.n + 1 };

      return s;
    });
  };

  const handleCompleteTopic = (topicId: string) => {
    if (!user || user.role !== 's' || !user.si) return;
    const sid = user.si;

    dbActions.updateStudent(sid, (prev) => {
      const topic = db.topics.find((t) => t.id === topicId);
      if (!topic || prev.td[topicId]) return prev;

      const s = { ...prev };
      s.td = { ...s.td, [topicId]: true };
      // prev'i mutasyona uğratmadan yeni yapboz id'si üret
      const nextId = s.nxt + 1;
      s.nxt = nextId;
      s.cp = [...s.cp, nextId];

      showCelebration('🎉 Konu tamamlandı!', topic.t, nextId);
      return s;
    });
  };

  const handleSubTopicDone = (topicId: string, subId: string) => {
    if (!user || user.role !== 's' || !user.si) return;
    const sid = user.si;

    dbActions.updateStudent(sid, (prev) => {
      const s = { ...prev };
      s.sd = { ...s.sd, [subId]: true };

      const topic = db.topics.find((t) => t.id === topicId);
      if (topic) {
        const subs = topic.subs || [];
        const allSubsDone = subs.length > 0 && subs.every((sub) => s.sd[sub.id]);
        const testPassed = !topic.q.length || (s.tpass && s.tpass[topicId]);
        if (allSubsDone && testPassed && !s.td[topicId]) {
          setTimeout(() => handleCompleteTopic(topicId), 300);
        }
      }

      return s;
    });
  };

  const handleQuizFinish = (key: string, name: string, score: number, total: number, hwId?: number) => {
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    setLastScores((prev) => ({ ...prev, [key]: pct }));

    if (user && user.role === 's' && user.si) {
      const sid = user.si;
      dbActions.updateStudent(sid, (prev) => {
        let s = { ...prev };

        // Konu testi geçildi mi?
        const topic = db.topics.find((t) => t.id === key);
        if (topic && pct >= 60) {
          s.tpass = { ...s.tpass, [topic.id]: true };
          const subs = topic.subs || [];
          const allSubsDone = subs.every((sub) => s.sd[sub.id]);
          if (allSubsDone && !s.td[topic.id]) {
            setTimeout(() => handleCompleteTopic(topic.id), 500);
          }
        }

        // Yapboz parçası için test sayacı (her 5 başarılı testte bir)
        s.cnt = s.cnt || {};
        const countKey = `${key}|${today()}`;
        if (pct >= 60 && !s.cnt[countKey]) {
          s.cnt = { ...s.cnt, [countKey]: 1 };
          s.tc = (s.tc || 0) + 1;
          if (s.tc % 5 === 0) {
            setTimeout(() => addPuzzlePiece(sid), 500);
          }
        }

        // Ödevle ilişkiliyse — immütatif güncelleme
        if (hwId && db.homeworks.some((h) => h.id === hwId)) {
          const curHw = s.h?.[hwId] || { score: null, text: '' };
          s = setHwRecord(s, hwId, { score: Math.max(curHw.score || 0, pct) });
        }

        return s;
      });
    }

    setScreenState({ screen: 'res', key, name, score, total, hwId });
  };

  // ---- Test sorusu üretimi ----
  const currentStudent =
    user && user.role === 's' && user.si ? db.students.find((s) => s.id === user.si) || null : null;

  const getQuizQuestions = useCallback(
    (key: string, hwId?: number): { name: string; qs: Question[] } => {
      if (key.startsWith('hw') || hwId) {
        const id = hwId || Number(key.replace('hw', ''));
        const h = db.homeworks.find((x) => x.id === id);
        return { name: h?.t || 'Ödev Testi', qs: shuf(h?.q || []) };
      }
      if (key === 'mix') {
        const allQs = db.topics.flatMap((t) => t.q);
        return { name: 'Karışık deneme', qs: shuf(allQs).slice(0, 10) };
      }
      if (key === 'word') {
        const currentLevel = currentStudent?.lv || 'A1';
        const words = db.words.filter((w) => w.lv === currentLevel);
        const generatedQs: Question[] = shuf(words)
          .slice(0, 8)
          .map((w) => {
            const wrongOptions = shuf(words.filter((x) => x.id !== w.id))
              .slice(0, 3)
              .map((x) => x.tr);
            const allOptions = dedupeOptions(shuf([w.tr, ...wrongOptions]));
            return { k: 'mc' as const, q: `“${w.e}” ne demek?`, o: allOptions, c: w.tr };
          });
        return { name: 'Kelime avcısı', qs: generatedQs };
      }

      const topic = db.topics.find((t) => t.id === key);
      return { name: topic ? `${topic.t} testi` : 'Test', qs: shuf(topic?.q || []) };
    },
    [db.homeworks, db.topics, db.words, currentStudent],
  );

  const startQuiz = (key: string, hwId?: number) => {
    const quiz = getQuizQuestions(key, hwId);
    if (!quiz.qs.length) {
      showToast('Test hazır değil', 'Bu konuda henüz soru yok.');
      return;
    }
    setScreenState({ screen: 'quiz', key, name: quiz.name, qs: quiz.qs, hwId });
  };

  // ---- Güvenli ekran yardımcıları ----
  const goMain = () => setScreenState({ screen: 'main' });
  const topicOf = (id: string) => db.topics.find((t) => t.id === id);
  const homeworkOf = (id: number) => db.homeworks.find((h) => h.id === id);

  // Konu erişim yetkisini Supabase topic_access tablosuna kalıcı yaz (best-effort)
  const persistTopicAccess = (studentId: string, localTopicIds: string[]) => {
    (async () => {
      try {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (!authUser) return;
        const map = loadIdMap();
        // local topic id -> supabase uuid
        const sbTopicIds = localTopicIds
          .map((lid) => Object.entries(map.topics).find(([_, l]) => l === lid)?.[0])
          .filter(Boolean) as string[];
        // Öğrencinin supabase profil id'sini e-posta üzerinden bul
        const stu = db.students.find((x) => x.id === studentId);
        if (!stu?.e) return;
        const { data: prof } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', stu.e.toLowerCase())
          .maybeSingle();
        if (!prof) return;
        await supabase.from('topic_access').delete().eq('student_id', prof.id);
        if (sbTopicIds.length) {
          await supabase
            .from('topic_access')
            .insert(sbTopicIds.map((tid) => ({ student_id: prof.id, topic_id: tid })));
        }
      } catch (err) {
        console.warn('topic_access senkronu başarısız (çevrimdışı olabilir):', err);
      }
    })();
  };

  // Öğrenci ilerlemesini Supabase'e kaydet (debounce) — state updater içinde yan etki yerine temiz effect
  useEffect(() => {
    if (!currentStudent) return;
    const t = setTimeout(() => syncStudentProgress(currentStudent), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentStudent?.kn,
    currentStudent?.td,
    currentStudent?.sd,
    currentStudent?.cp,
    currentStudent?.h,
    currentStudent?.wl,
    currentStudent?.tc,
  ]);

  // ---- Ortak hesap handler'ları (öğrenci/öğretmen AccountView) ----
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* çevrimdışı */
    }
    setUser(null);
    setScreenState({ screen: 'main' });
  };

  // ---- Alt router'lar ----

  /** Öğrencinin ana sekme içerikleri */
  const renderStudentTabs = () => {
    if (!currentStudent) return null;
    const sid = user!.si!;
    switch (activeTab) {
      case 'home':
        return (
          <HomeView
            student={currentStudent}
            allTopics={db.topics}
            allWords={db.words}
            lastScores={lastScores}
            onOpenTopic={(id) => setScreenState({ screen: 'topic', id })}
            onStartQuiz={(key) => startQuiz(key)}
            onStartCards={() => {
              const levelWords = db.words.filter((w) => w.lv === currentStudent.lv);
              const targetCount = currentStudent.goal;
              const pool = [
                ...shuf(levelWords.filter((w) => !currentStudent.kn.includes(w.id))),
                ...shuf(levelWords.filter((w) => currentStudent.kn.includes(w.id))),
              ];
              // Havuz boşsa deck'i undefined elemanlarla doldurmak FlashcardsView'da çökmeye yol açıyordu.
              if (!pool.length) {
                showToast('Kelime yok', 'Seviyene uygun kelime henüz eklenmemiş.');
                return;
              }
              const deck = Array.from(
                { length: Math.min(targetCount, pool.length) },
                (_, i) => pool[i % pool.length],
              ).filter(Boolean);
              setScreenState({ screen: 'cards', deck });
            }}
            onUpdateGoal={(newGoal) =>
              dbActions.updateStudent(sid, (s) => ({ ...s, goal: newGoal }))
            }
            onUpdateReminder={(on, time) => {
              dbActions.updateStudent(sid, (s) => ({ ...s, rem: { on, time } }));
              if (on) showToast('Hatırlatıcı Açıldı', `Her gün saat ${time} için hatırlandı.`);
            }}
          />
        );
      case 'cal':
        return (
          <CalendarView
            student={currentStudent}
            allLessons={db.lessons}
            sessions={db.sessions}
          />
        );
      case 'hw':
        return (
          <HomeworkView
            student={currentStudent}
            allHomeworks={db.homeworks}
            allTopics={db.topics}
            onStartWriting={(hwId) => setScreenState({ screen: 'write', hwId })}
            onStartQuiz={(key, hwId) => startQuiz(key, hwId)}
          />
        );
      case 'news':
        return <NotificationsView notifications={db.notifications} studentId={user!.si} />;
      case 'acc':
        return (
          <AccountView
            user={user!}
            students={db.students}
            classes={db.classes}
            theme={theme}
            onUpdateUser={(updated) => {
              setUser((cur) => (cur ? { ...cur, ...updated } : null));
              if ((updated.name || updated.email) && user!.si) {
                dbActions.updateStudent(user!.si, (s) => ({
                  ...s,
                  n: updated.name || s.n,
                  e: updated.email || s.e,
                }));
              }
              showToast('Güncellendi', 'Hesap bilgileri kaydedildi.');
            }}
            onUpdateStudentAvatar={(av) =>
              dbActions.updateStudent(sid, (s) => ({ ...s, av }))
            }
            onSetTheme={setTheme}
            onLogout={handleLogout}
            onDeleteAccount={() => {
              dbActions.patch((prev) => ({
                ...prev,
                students: prev.students.filter((x) => x.id !== user!.si),
              }));
              setUser(null);
              setScreenState({ screen: 'main' });
            }}
          />
        );
      default:
        return null;
    }
  };

  /** Öğretmenin ana sekme içerikleri */
  const renderTeacherTabs = () => {
    switch (activeTab) {
      case 'stu':
        return (
          <StudentsView
            students={db.students}
            classes={db.classes}
            allTopics={db.topics}
            sessions={db.sessions}
            onOpenClassEditor={() => setScreenState({ screen: 'cls' })}
            onSelectStudent={(studentId) => setScreenState({ screen: 'stu-detail', studentId })}
            onCreateStudent={(newStudent) => {
              dbActions.patch((prev) => ({
                ...prev,
                students: [
                  ...prev.students,
                  { ...(newStudent as Student), id: (newStudent as Student).id || genId() },
                ],
              }));
              showToast('Hesap Hazır', `${newStudent.n} hesabı başarıyla oluşturuldu.`);
            }}
          />
        );
      case 'cal':
        return (
          <TeacherCalendarView
            lessons={db.lessons}
            notifications={db.notifications}
            onOpenLesson={(lid, oc) => setScreenState({ screen: 'led', lid, oc })}
            onNewLesson={() => {
              const newLesson: LessonSchedule = {
                id: Date.now(),
                t: 'Yeni ders',
                d: new Date().toISOString().split('T')[0],
                h: '18:00',
                rep: false,
                stu: [],
              };
              dbActions.patch((prev) => ({ ...prev, lessons: [...prev.lessons, newLesson] }));
              setScreenState({ screen: 'led', lid: newLesson.id });
            }}
          />
        );
      case 'home':
        return (
          <TeacherCoursesView
            topics={db.topics}
            words={db.words}
            homeworks={db.homeworks}
            students={db.students}
            onOpenTopicEditor={(id) => setScreenState({ screen: 'ted', id })}
            onNewTopic={() => {
              const newTopic: Topic = {
                id: `x${Date.now()}`,
                ic: '📘',
                t: 'Yeni konu',
                d: 'Kısa açıklama',
                exp: '',
                lv: 'A1',
                ex: [],
                words: [],
                q: [],
                subs: [],
              };
              dbActions.patch((prev) => ({ ...prev, topics: [...prev.topics, newTopic] }));
              setScreenState({ screen: 'ted', id: newTopic.id });
            }}
            onSaveWord={(word) => {
              dbActions.patch((prev) => {
                if (word.id) {
                  return {
                    ...prev,
                    words: prev.words.map((w) =>
                      w.id === word.id ? ({ ...w, ...word } as WordItem) : w,
                    ),
                  };
                }
                const newWord: WordItem = {
                  id: Date.now(),
                  e: word.e!,
                  tr: word.tr!,
                  ph: word.ph || '',
                  ex: word.ex || '',
                  lv: word.lv || 'A1',
                };
                return { ...prev, words: [...prev.words, newWord] };
              });
              showToast('Kelime Kaydedildi', `${word.e} listeye eklendi.`);
            }}
            onDeleteWord={(wid) => {
              dbActions.patch((prev) => ({
                ...prev,
                words: prev.words.filter((w) => w.id !== wid),
              }));
              showToast('Silindi', 'Kelime silindi.');
            }}
            onOpenHomeworkEditor={(hwId) => setScreenState({ screen: 'hed', hwId })}
            onNewHomework={() => {
              const newHw: Homework = {
                id: Date.now(),
                t: 'Yeni ödev',
                d: '',
                due: '',
                type: 'write',
                topic: '',
                q: [],
                to: db.students.map((s) => s.id),
              };
              dbActions.patch((prev) => ({ ...prev, homeworks: [newHw, ...prev.homeworks] }));
              setScreenState({ screen: 'hed', hwId: newHw.id });
            }}
          />
        );
      case 'roll':
        return (
          <AttendanceView
            students={db.students}
            classes={db.classes}
            sessions={db.sessions}
            sessionClasses={db.sessionClasses}
            onSaveAttendance={(classId, sessionKey, attendanceMap) => {
              const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
              const now = new Date();
              const todayLabel = `${now.getDate()} ${months[now.getMonth()]}`;

              dbActions.patch((prev) => {
                let newSessions = [...prev.sessions];
                let newSessionClasses = [...prev.sessionClasses];

                if (sessionKey === 'new') {
                  newSessions.push(todayLabel);
                  newSessionClasses.push(classId);
                }

                // Id tabanlı, immütatif güncelleme (yerinde mutasyon yerine)
                const attMap = attendanceMap as Record<string, string>;
                const updatedStudents = prev.students.map((s) => {
                  if (sessionKey === 'new') {
                    if (s.c === classId && !s.off) {
                      return { ...s, a: s.a + (attMap[s.id] || 'g') };
                    }
                    return { ...s, a: s.a + '-' };
                  }
                  if (s.c === classId && attMap[s.id]) {
                    const k = Number(sessionKey);
                    return { ...s, a: s.a.slice(0, k) + attMap[s.id] + s.a.slice(k + 1) };
                  }
                  return s;
                });

                return {
                  ...prev,
                  sessions: newSessions,
                  sessionClasses: newSessionClasses,
                  students: updatedStudents,
                };
              });

              showToast('Yoklama Kaydedildi', 'Katılım durumları deftere işlendi.');
            }}
          />
        );
      case 'news':
        return (
          <TeacherNotificationsView
            students={db.students}
            classes={db.classes}
            broadcasts={db.broadcasts}
            onSendMessage={(t, m, to, when) => {
              const targetIds = to as string[];
              const newBroadcast: BroadcastMessage = {
                id: Date.now(),
                t,
                m,
                to: targetIds,
                when,
                sent: when === null,
                sentAt: when === null ? new Date() : undefined,
              };

              dbActions.patch((prev) => {
                const newNotifs: NotificationItem[] =
                  when === null
                    ? targetIds.map((si: string) => ({ si, t: `🔔 ${t}`, m, at: new Date() }))
                    : [];
                return {
                  ...prev,
                  broadcasts: [newBroadcast, ...prev.broadcasts],
                  notifications: [...newNotifs, ...prev.notifications],
                };
              });

              showToast(
                when === null ? 'Gönderildi' : 'Planlandı',
                `${to.length} öğrenciye ${when === null ? 'iletildi' : 'planlandı'}.`,
              );
            }}
            onDeliverNow={(msgId) => {
              dbActions.patch((prev) => {
                const targetBroadcast = prev.broadcasts.find((b) => b.id === msgId);
                if (!targetBroadcast) return prev;

                const newNotifs: NotificationItem[] = targetBroadcast.to.map((si) => ({
                  si,
                  t: `🔔 ${targetBroadcast.t}`,
                  m: targetBroadcast.m,
                  at: new Date(),
                }));

                return {
                  ...prev,
                  notifications: [...newNotifs, ...prev.notifications],
                  broadcasts: prev.broadcasts.map((b) =>
                    b.id === msgId ? { ...b, sent: true, sentAt: new Date() } : b,
                  ),
                };
              });
              showToast('İletildi', 'Bildirim öğrencilere anında ulaştırıldı.');
            }}
            onDeleteBroadcast={(msgId) => {
              dbActions.patch((prev) => ({
                ...prev,
                broadcasts: prev.broadcasts.filter((b) => b.id !== msgId),
              }));
              showToast('Kaldırıldı', 'Bildirim silindi.');
            }}
          />
        );
      case 'acc':
        return (
          <AccountView
            user={user!}
            students={db.students}
            classes={db.classes}
            theme={theme}
            onUpdateUser={(updated) => {
              setUser((cur) => (cur ? { ...cur, ...updated } : null));
              showToast('Güncellendi', 'Öğretmen profili güncellendi.');
            }}
            onUpdateStudentAvatar={() => {}}
            onSetTheme={setTheme}
            onLogout={handleLogout}
            onDeleteAccount={() => {
              setUser(null);
              setScreenState({ screen: 'main' });
            }}
          />
        );
      default:
        return null;
    }
  };

  /** Detay/düzenleme ekranlarını güvenli şekilde çözümler. */
  const renderDetailScreen = (): React.ReactNode => {
    switch (screenState.screen) {
      case 'quiz':
        return (
          <QuizView
            quizKey={screenState.key}
            name={screenState.name}
            questions={screenState.qs}
            onExit={goMain}
            onFinish={(score, total) =>
              handleQuizFinish(screenState.key, screenState.name, score, total, screenState.hwId)
            }
          />
        );
      case 'res':
        return (
          <QuizResultView
            name={screenState.name}
            score={screenState.score}
            total={screenState.total}
            isTopicTest={db.topics.some((t) => t.id === screenState.key)}
            isHomework={!!screenState.hwId}
            onRetry={() => startQuiz(screenState.key, screenState.hwId)}
            onBack={goMain}
          />
        );
      case 'cards':
        return currentStudent && screenState.deck.length > 0 ? (
          <FlashcardsView
            deck={screenState.deck}
            student={currentStudent}
            onExit={goMain}
            onWordKnown={handleWordLearned}
          />
        ) : (
          <MissingScreen onBack={goMain} label="Kelime kartları" />
        );
      case 'topic': {
        const t = topicOf(screenState.id);
        return t && currentStudent ? (
          <TopicView
            topic={t}
            student={currentStudent}
            onBack={goMain}
            onOpenSubTopic={(sid) => setScreenState({ screen: 'sub', id: screenState.id, sid })}
            onStartQuiz={(topicId) => startQuiz(topicId)}
          />
        ) : (
          <MissingScreen onBack={goMain} label="Konu" />
        );
      }
      case 'sub': {
        const t = topicOf(screenState.id);
        const sub = t?.subs?.find((x) => x.id === screenState.sid);
        return t && sub && currentStudent ? (
          <SubTopicView
            topic={t}
            subTopic={sub}
            student={currentStudent}
            onBack={() => setScreenState({ screen: 'topic', id: screenState.id })}
            onMarkComplete={() => {
              handleSubTopicDone(screenState.id, screenState.sid);
              setScreenState({ screen: 'topic', id: screenState.id });
            }}
          />
        ) : (
          <MissingScreen onBack={goMain} label="Alt konu" />
        );
      }
      case 'write': {
        const hw = homeworkOf(screenState.hwId);
        return hw && currentStudent ? (
          <WritingHomeworkView
            homework={hw}
            student={currentStudent}
            onBack={goMain}
            onSubmit={(text) => {
              dbActions.updateStudent(user!.si!, (s) => ({
                ...s,
                h: { ...s.h, [screenState.hwId]: { score: null, text } },
              }));
              showToast('Ödev Teslim Edildi', 'Yazılı ödeviniz öğretmeninize iletildi.');
              setScreenState({ screen: 'main' });
            }}
          />
        ) : (
          <MissingScreen onBack={goMain} label="Ödev" />
        );
      }
      case 'ted': {
        const t = topicOf(screenState.id);
        return t ? (
          <TopicEditorView
            topic={t}
            classes={db.classes}
            students={db.students}
            onBack={goMain}
            onSave={(updated) => {
              dbActions.updateTopic(updated.id, () => updated);
              showToast('Kaydedildi', 'Konu içeriği güncellendi.');
            }}
            onDelete={(tid) => {
              dbActions.patch((prev) => ({
                ...prev,
                topics: prev.topics.filter((t2) => t2.id !== tid),
              }));
              setScreenState({ screen: 'main' });
              showToast('Silindi', 'Konu başarıyla silindi.');
            }}
            onOpenSubTopicEditor={(sid) =>
              setScreenState({ screen: 'sed', id: screenState.id, sid })
            }
            onAddSubTopic={() => {
              const newSub = { id: `s${Date.now()}`, t: 'Yeni alt konu', exp: '', imgs: [] };
              dbActions.updateTopic(screenState.id, (t2) => ({
                ...t2,
                subs: [...(t2.subs || []), newSub],
              }));
              setScreenState({ screen: 'sed', id: screenState.id, sid: newSub.id });
            }}
            onUpdateStudentPermissions={(studentId, newTopics) => {
              dbActions.updateStudent(studentId, (s) => ({ ...s, tp: newTopics }));
              // Yetkiyi Supabase topic_access tablosuna da yaz — sadece localStorage'a
              // yazmak öğretmenin verdiği erişimi öğrencinin diğer cihazına/paneline taşımıyordu.
              persistTopicAccess(studentId, newTopics);
            }}
          />
        ) : (
          <MissingScreen onBack={goMain} label="Konu düzenleme" />
        );
      }
      case 'sed': {
        const t = topicOf(screenState.id);
        const sub = t?.subs?.find((x) => x.id === screenState.sid);
        return t && sub ? (
          <SubTopicEditorView
            topic={t}
            subTopic={sub}
            onBack={() => setScreenState({ screen: 'ted', id: screenState.id })}
            onSave={(updated) => {
              dbActions.updateSubTopic(screenState.id, updated.id, () => updated);
              showToast('Kaydedildi', 'Alt konu güncellendi.');
            }}
            onDelete={(sid) => {
              dbActions.updateTopic(screenState.id, (t2) => ({
                ...t2,
                subs: (t2.subs || []).filter((s2) => s2.id !== sid),
              }));
              setScreenState({ screen: 'ted', id: screenState.id });
              showToast('Silindi', 'Alt konu silindi.');
            }}
          />
        ) : (
          <MissingScreen onBack={goMain} label="Alt konu düzenleme" />
        );
      }
      case 'hed': {
        const hw = homeworkOf(screenState.hwId);
        return hw ? (
          <HomeworkEditorView
            homework={hw}
            students={db.students}
            classes={db.classes}
            allTopics={db.topics}
            onBack={goMain}
            onSave={(updated) => {
              dbActions.updateHomework(updated.id, () => updated);
              showToast('Kaydedildi', 'Ödev güncellendi.');
            }}
            onDelete={(hid) => {
              dbActions.patch((prev) => ({
                ...prev,
                homeworks: prev.homeworks.filter((h) => h.id !== hid),
              }));
              setScreenState({ screen: 'main' });
              showToast('Silindi', 'Ödev silindi.');
            }}
          />
        ) : (
          <MissingScreen onBack={goMain} label="Ödev düzenleme" />
        );
      }
      case 'led': {
        const lesson = db.lessons.find((l) => l.id === screenState.lid);
        return lesson ? (
          <LessonEditorView
            lesson={lesson}
            occurrenceTime={screenState.oc}
            students={db.students}
            classes={db.classes}
            onBack={goMain}
            onSave={(updated) => {
              dbActions.updateLesson(updated.id, () => updated);
              showToast('Kaydedildi', 'Ders programı güncellendi.');
            }}
            onDelete={(lid) => {
              dbActions.patch((prev) => ({
                ...prev,
                lessons: prev.lessons.filter((l) => l.id !== lid),
              }));
              setScreenState({ screen: 'main' });
              showToast('Silindi', 'Ders silindi.');
            }}
          />
        ) : (
          <MissingScreen onBack={goMain} label="Ders düzenleme" />
        );
      }
      case 'stu-detail': {
        const stu = db.students.find((x) => x.id === screenState.studentId);
        return stu ? (
          <StudentDetailView
            student={stu}
            classes={db.classes}
            allTopics={db.topics}
            allWords={db.words}
            sessions={db.sessions}
            onBack={goMain}
            onUpdateStudent={(updated) => {
              dbActions.updateStudent(updated.id, () => updated);
              showToast('Güncellendi', `${updated.n} bilgileri kaydedildi.`);
            }}
          />
        ) : (
          <MissingScreen onBack={goMain} label="Öğrenci detayı" />
        );
      }
      case 'cls':
        return (
          <ClassesEditorView
            classes={db.classes}
            students={db.students}
            onBack={goMain}
            onSaveClassNames={(updated) => {
              dbActions.patch((prev) => ({ ...prev, classes: updated }));
              showToast('Kaydedildi', 'Sınıf adları güncellendi.');
            }}
            onAddClass={(name) => {
              dbActions.patch((prev) => ({
                ...prev,
                classes: [...prev.classes, { id: `c${Date.now()}`, n: name }],
              }));
              showToast('Eklendi', `${name} sınıfı oluşturuldu.`);
            }}
            onDeleteClass={(cid) => {
              dbActions.patch((prev) => ({
                ...prev,
                classes: prev.classes.filter((c) => c.id !== cid),
              }));
              showToast('Silindi', 'Sınıf silindi.');
            }}
          />
        );
      default:
        return null;
    }
  };

  // ---- Ana render ----
  const renderAuthGate = () => {
    if (!user) {
      return (
        <LoginView
          students={db.students}
          onDbUpdate={(newDb) => setDb(newDb)}
          onLogin={(newUser) => {
            const fullUser: User = {
              ...newUser,
              phone: '',
              nf: { lesson: true, hw: true, news: true },
            };
            setUser(fullUser);
            setActiveTab(newUser.role === 't' ? 'stu' : 'home');
            setScreenState({ screen: 'main' });
          }}
        />
      );
    }
    if (user.role === 's' && currentStudent?.must) {
      return (
        <ForcePasswordView
          currentPassword={user.pw}
          onSubmit={(newPw) => {
            dbActions.updateStudent(user.si!, (s) => ({ ...s, pw: newPw, must: false }));
            setUser({ ...user, pw: newPw });
            // Şifre değişikliğini Supabase profiline de işle (tek yönlü lokal güncelleme veri kaybına yol açıyordu)
            (async () => {
              try {
                const {
                  data: { user: authUser },
                } = await supabase.auth.getUser();
                if (authUser) {
                  await supabase
                    .from('profiles')
                    .update({ must_change_password: false })
                    .eq('id', authUser.id);
                }
              } catch {
                /* çevrimdışı */
              }
            })();
            showToast('Şifre Belirlendi', 'Yeni şifreniz başarıyla kaydedildi.');
          }}
        />
      );
    }
    return null;
  };

  const authGate = renderAuthGate();

  return (
    <ErrorBoundary>
      <AndroidFrame theme={theme}>
        <Toast toast={toast} onClose={() => setToast(null)} />
        <CelebrationModal data={celebration} onClose={() => setCelebration(null)} />

        <main id="view" className="flex-1 flex flex-col overflow-hidden" aria-live="polite">
          {authGate ? (
            authGate
          ) : screenState.screen !== 'main' ? (
            renderDetailScreen()
          ) : user!.role === 's' ? (
            renderStudentTabs()
          ) : (
            renderTeacherTabs()
          )}
        </main>

        {user && screenState.screen === 'main' && (
          <Navigation
            role={user.role}
            currentTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setScreenState({ screen: 'main' });
            }}
            unreadCount={
              user.role === 's' ? db.notifications.filter((n) => n.si === user.si).length : 0
            }
          />
        )}
      </AndroidFrame>
    </ErrorBoundary>
  );
}
