/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Otomatik içerik yenileme: öğretmenin/panelin eklediği veriler oturum açıkken
 * de görünsün (60 sn polling + Supabase realtime). App.tsx'ten ayrıştırıldı.
 */

import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { User } from '../types.ts';
import type { AppDatabase } from '../utils/storage.ts';
import { loadDatabase, saveDatabase } from '../utils/storage.ts';
import { syncFromSupabase } from '../utils/supabaseSync.ts';
import { supabase } from '../lib/supabase.ts';

const REALTIME_TABLES = [
  'topics',
  'subtopics',
  'questions',
  'words',
  'homework',
  'homework_targets',
  'topic_access',
  'notifications',
];

export function useContentSync(user: User | null, setDb: Dispatch<SetStateAction<AppDatabase>>) {
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const refreshContent = async () => {
      try {
        const fresh = await syncFromSupabase(loadDatabase());
        if (cancelled) return;
        setDb((prev) => {
          // Öğrenci ilerlemesi lokalde tutulur; içerik tabloları sunucudan gelir
          const merged = {
            ...prev,
            classes: fresh.classes,
            words: fresh.words,
            topics: fresh.topics,
            homeworks: fresh.homeworks,
            notifications: fresh.notifications,
            students: prev.students.map((ps) => {
              const fs = fresh.students.find((x) => x.id === ps.id);
              return fs ? { ...ps, tp: fs.tp } : ps; // sadece erişim listesi senkronlanır
            }),
          };
          saveDatabase(merged);
          return merged;
        });
      } catch (err) {
        console.warn('İçerik yenileme başarısız (çevrimdışı olabilir):', err);
      }
    };

    const poll = setInterval(refreshContent, 60_000);
    refreshContent();

    // Realtime: panelde bir içerik değiştiği anda debounce ile çek
    let rtCleanup: (() => void) | null = null;
    (async () => {
      if (cancelled) return;
      try {
        let debounce: ReturnType<typeof setTimeout> | null = null;
        const onChange = () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(refreshContent, 1500);
        };
        REALTIME_TABLES.forEach((table) => {
          supabase
            .channel(`rt-${table}`)
            .on('postgres_changes', { schema: 'public', event: '*', table }, onChange)
            .subscribe();
        });
        rtCleanup = () => {
          if (debounce) clearTimeout(debounce);
          supabase.removeAllChannels();
        };
      } catch {
        /* realtime yoksa polling zaten çalışıyor */
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(poll);
      if (rtCleanup) rtCleanup();
    };
  }, [user, setDb]);
}
