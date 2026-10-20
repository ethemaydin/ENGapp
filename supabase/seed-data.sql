-- ============================================================================
-- ENGLISH BOARD — ORNEK VERI (seed)
-- ============================================================================
-- ONCE supabase/schema.sql CALISTIRILMIS OLMALI. Bu dosya tekrar tekrar
-- calistirilabilir (on conflict do nothing ile idempotent).
-- Dashboard > SQL Editor > yapistir > RUN  VEYA
-- supabase db execute --linked --file supabase/seed-data.sql
-- ============================================================================

-- Siniflar
insert into public.classes (name) values
  ('7-A'), ('7-B'), ('8-A')
on conflict (name) do nothing;

-- Konular (data jsonb: icon, aciklama, kelime ciftleri, ornekler)
insert into public.topics (id, title, level, sort_order, data) values
  ('11111111-1111-1111-1111-111111111101', 'Greetings', 'A1', 1,
   '{"icon":"👋","desc":"Selamlasma kaliplari","exp":"Merhaba deme yollari: Hello, Hi, Good morning...","level":"A1","words":[["hello","merhaba"],["good morning","gunaydin"],["how are you","nasil sin"],["nice to meet you","tanismak guzel"]],"examples":[["Hello, how are you?","Merhaba, nasilsin?"],["Im fine, thanks.","Iyiyim, tesekkurler."]]}'::jsonb),
  ('11111111-1111-1111-1111-111111111102', 'Family', 'A1', 2,
   '{"icon":"👨‍👩‍👧","desc":"Aile uyesi kelimeleri","exp":"mother, father, brother, sister...","level":"A1","words":[["mother","anne"],["father","baba"],["brother","erkek kardes"],["sister","kiz kardes"]],"examples":[["This is my mother.","Bu benim annem."]]}'::jsonb),
  ('11111111-1111-1111-1111-111111111103', 'Present Simple', 'A1', 3,
   '{"icon":"⏰","desc":"Genis zaman","exp":"I/you/we/they + V ; he/she/it + V-s","level":"A1","words":[["always","her zaman"],["usually","genellikle"],["never","asla"]],"examples":[["She works every day.","O her gun calisir."]]}'::jsonb)
on conflict (id) do nothing;

-- Alt konular
insert into public.subtopics (id, topic_id, title, sort_order, data) values
  ('22222222-2222-2222-2222-222222222201',
   '11111111-1111-1111-1111-111111111101', 'Formal greetings', 1,
   '{"exp":"Good morning / Good afternoon / Good evening kullanimi","imgs":[]}'::jsonb),
  ('22222222-2222-2222-2222-222222222202',
   '11111111-1111-1111-1111-111111111101', 'Informal greetings', 2,
   '{"exp":"Hi / Hey / Whats up? kullanimi","imgs":[]}'::jsonb),
  ('22222222-2222-2222-2222-222222222203',
   '11111111-1111-1111-1111-111111111103', 'Affirmative sentences', 1,
   '{"exp":"He plays football. I play football.","imgs":[]}'::jsonb)
on conflict (id) do nothing;

-- Sorular (mc = data jsonb formati; fill/order duz kolon formati ornegi)
insert into public.questions (id, topic_id, kind, sort_order, data, question, options, correct, hint, answer) values
  ('33333333-3333-3333-3333-333333333301',
   '11111111-1111-1111-1111-111111111101', 'mc', 1,
   '{}'::jsonb,
   '"___ are you?" - What?', '["How","What","Where","Who"]'::jsonb, 'How', null, null),
  ('33333333-3333-3333-3333-333333333302',
   '11111111-1111-1111-1111-111111111101', 'mc', 2,
   '{"k":"mc","q":"Good ___ (sabah 10da)","o":["morning","evening","night"],"c":"morning"}'::jsonb,
   null, null, null, null, null),
  ('33333333-3333-3333-3333-333333333303',
   '11111111-1111-1111-1111-111111111103', 'fill', 1,
   '{}'::jsonb,
   'She ___ (work) every day.', null, null, '-fiil -s alır', 'works'),
  ('33333333-3333-3333-3333-333333333304',
   '11111111-1111-1111-1111-111111111103', 'order', 2,
   '{"k":"order","q":"Cümleyi sırala","w":["She","plays","football","every","day"]}'::jsonb,
   null, null, null, null, null)
on conflict (id) do nothing;

-- Kelimeler
insert into public.words (en, tr, phonetic, example, level) values
  ('hello',      'merhaba',       'həˈloʊ',   'Hello, how are you?', 'A1'),
  ('good',       'iyi',           'ɡʊd',      'Good morning!',       'A1'),
  ('morning',    'sabah',         'ˈmɔːrnɪŋ', 'I wake up in the morning.', 'A1'),
  ('family',     'aile',          'ˈfæməli',  'I love my family.',   'A1'),
  ('mother',     'anne',          'ˈmʌðər',   'My mother cooks well.','A1'),
  ('father',     'baba',          'ˈfɑːðər',  'My father reads news.','A1'),
  ('brother',    'erkek kardes',  'ˈbrʌðər',  'I have one brother.', 'A1'),
  ('sister',     'kiz kardes',    'ˈsɪstər',  'My sister is a teacher.','A1'),
  ('always',     'her zaman',     'ˈɔːlweɪz', 'I always study.',     'A1'),
  ('never',      'asla',          'ˈnevər',   'She never lies.',     'A1')
on conflict (en, level) do nothing;

-- Odev/test ornegi (questions jsonb: uygulama ic formati)
insert into public.homework (id, title, body, due_date, hw_type, topic_id, pass, questions) values
  ('44444444-4444-4444-4444-444444444401',
   'Greetings Testi', 'Selamlasma konusundan 3 soruluk kisa test',
   current_date + interval '7 days', 'test',
   '11111111-1111-1111-1111-111111111101', 60,
   '[{"k":"mc","q":"___ are you?","o":["How","What","Where"],"c":"How"},
     {"k":"mc","q":"Good ___ (gece yarisi)","o":["morning","night","afternoon"],"c":"night"},
     {"k":"fill","q":"Nice to ___ you.","a":["meet"]}]'::jsonb)
on conflict (id) do nothing;

-- Not: homework_targets satirlari ogrenci profilleri olusturulunca eklenir.
-- Ornek: panelde ogrenci uuid'sunu bilerek asagidaki sekilde atayabilirsin:
--   insert into public.homework_targets (homework_id, student_id)
--   values ('44444444-4444-4444-4444-444444444401', '<ogrenci-uuid>');

-- ============================================================================
-- KULLANICI HESABI ACMA ORNEGI (SQL ile; dashboard'dan da yapilabilir)
-- auth.users'a dogrudan insert yerine Supabase yönetim API'si önerilir:
--   Dashboard > Authentication > Add user  (en güvenlisi)
-- veya CLI:
--   supabase users invite <email>   /   supabase users create ...
-- Kullanici olusturulurken User metadata olarak:
--   {"full_name":"Ali Veli","role":"student","level":"A1","must_change_password":true}
-- verilirse handle_new_user trigger'i profiles satirini otomatik olusturur.
-- Sinif atamasi:
--   update public.profiles set class_id = (select id from public.classes where name='7-A')
--   where email = 'ali@example.com';
-- ============================================================================
