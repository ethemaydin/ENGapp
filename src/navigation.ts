/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Uygulama yönlendirme (router) tipleri ve yardımcıları.
 * App.tsx içindeki uzun nested-ternary zinciri bu modülle birlikte
 * okunabilir bir switch yönlendiricisine dönüştü.
 */

import type { WordItem, Question } from './types.ts';

export type ScreenState =
  | { screen: 'main' }
  | { screen: 'topic'; id: string }
  | { screen: 'sub'; id: string; sid: string }
  | { screen: 'quiz'; key: string; name: string; qs: Question[]; hwId?: number }
  | { screen: 'res'; key: string; name: string; score: number; total: number; hwId?: number }
  | { screen: 'cards'; deck: WordItem[] }
  | { screen: 'write'; hwId: number }
  | { screen: 'stu-detail'; studentId: string }
  | { screen: 'cls' }
  | { screen: 'ted'; id: string }
  | { screen: 'sed'; id: string; sid: string }
  | { screen: 'hed'; hwId: number }
  | { screen: 'led'; lid: number; oc?: number | null };

/** Ekran geçişleri için sabit üreticiler — her çağrıda yeni nesne üretmek yerine tek seferlik. */
export const goMainScreen = (): ScreenState => ({ screen: 'main' });
