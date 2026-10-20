-- ============================================================================
-- ENGLISH BOARD — SUPABASE SIFIRDAN KURULUM (tek dosya, tam schema)
-- ============================================================================
-- NEREYE CALISTIRILIR:
--   Secenek A: Supabase Dashboard > SQL Editor > New query > yapistir > RUN
--   Secenek B: supabase db execute --linked --file supabase/schema.sql (CLI)
--
-- BU DOSYA TAM VE SIRFIRDAN KURULUMDUR:
--   Once mevcut uygulama tablolarini DROP edip hepsini bastan olusturur.
--   auth.users tablosuna DOKUNMAZ (Supabase yonetir); kullanici hesaplarini
--   Dashboard > Authentication > Users kismindan acin (asagidaki trigger
--   her yeni kullanici icin profiles satirini otomatik olusturur).
--
-- GEREKLI ORTAM DEGISKENLERI (.env):
--   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
--   VITE_SUPABASE_ANON_KEY=<anon public key>
--
-- UYGULAMANIN BEKLEDIGI TABLOLAR (src/utils/supabaseSync.ts,
-- src/lib/supabase.ts, src/views/LoginView.tsx, src/hooks/useContentSync.ts):
--   profiles, classes, topics, subtopics, questions, words, homework,
--   homework_targets, homework_submissions, topic_access, topic_complete,
--   topic_pass, subtopic_done, words_learned, daily_words, test_attempts,
--   notifications, app_settings
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. TEMIZLIK — eski/bozuk kurulumu tamamen kaldir (FK zinciri ters sirasi)
-- ---------------------------------------------------------------------------
drop table if exists
  homework_submissions,
  homework_targets,
  homework,
  test_attempts,
  daily_words,
  words_learned,
  subtopic_done,
  topic_pass,
  topic_complete,
  topic_access,
  notifications,
  questions,
  subtopics,
  topics,
  words,
  classes,
  app_settings,
  profiles cascade;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.is_teacher(uuid);
drop function if exists public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 1. EXTENSIONS & YARDIMCI FONKSIYONLAR
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 2. PROFILES — auth.users ile 1:1. LoginView okur: role, full_name, level,
--    class_id, active, must_change_password, email. App.tsx gunceller:
--    must_change_password. Sync: email -> uuid cozumu yapiyor.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text unique not null,
  full_name             text,
  role                  text not null default 'student'
                        check (role in ('student', 'teacher', 'admin')),
  level                 text not null default 'A1',
  class_id              uuid,
  phone                 text,
  active                boolean not null default true,
  must_change_password  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- class_id -> classes FK'si, classes olusunca asagida ekleniyor.

-- Her yeni auth.users icin otomatik profil satiri.
-- Dashboard'da kullanici eklerken "User metadata" alanina yazin:
--   { "full_name": "Ali", "role": "student|teacher|admin",
--     "level": "A1", "phone": "...", "must_change_password": true }
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  md jsonb := new.raw_user_meta_data;
begin
  insert into public.profiles (id, email, full_name, role, level, phone, must_change_password)
  values (
    new.id,
    new.email,
    coalesce(md->>'full_name', split_part(new.email, '@', 1)),
    case when md->>'role' in ('teacher','admin') then md->>'role' else 'student' end,
    coalesce(md->>'level', 'A1'),
    md->>'phone',
    coalesce((md->>'must_change_password')::boolean, true)
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(excluded.full_name, profiles.full_name),
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS policy'lerinde kullanilir; SECURITY DEFINER sayesinde recursive RLS
-- (profiles okurken kendine takilma) sorunu olmaz. profiles tablosu artik
-- var oldugu icin burada olusturuluyor.
create function public.is_teacher(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role in ('teacher', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. CLASSES — sinif gruplari (uygulama name'e gore siralayarak cekiyor)
-- ---------------------------------------------------------------------------
create table public.classes (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_class_id_fkey
  foreign key (class_id) references public.classes (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. TOPICS — konular. data jsonb icinden tolere edilerek okunur:
--    icon/ic, desc/d/description, exp/content, level/lv, examples/ex,
--    words/pairs ([en,tr][] ya da {en,tr}[] ya da "en|tr"[])
-- ---------------------------------------------------------------------------
create table public.topics (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  level       text not null default 'A1',
  sort_order  integer not null default 0,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index topics_level_idx on public.topics (level);
create index topics_sort_idx  on public.topics (sort_order);

-- ---------------------------------------------------------------------------
-- 5. SUBTOPICS — alt basliklar. data jsonb: exp/content/text, imgs[]
-- ---------------------------------------------------------------------------
create table public.subtopics (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.topics (id) on delete cascade,
  title      text not null,
  sort_order integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index subtopics_topic_idx on public.subtopics (topic_id);

-- ---------------------------------------------------------------------------
-- 6. QUESTIONS — konu sorulari. Iki format birden tolere edilir:
--    a) data jsonb: {k:'mc|fill|order|listen', q, o[], c|a, h, w[], s}
--    b) duz kolonlar: question/options/answer/correct/answer_index/hint/...
-- ---------------------------------------------------------------------------
create table public.questions (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null references public.topics (id) on delete cascade,
  kind         text not null default 'mc'
               check (kind in ('mc','fill','cloze','order','arrange','listen')),
  question     text,
  options      jsonb,           -- string[] secenekler
  answer       text,            -- metin dogru cevap (mc/fill)
  answer_index integer,         -- indeks tabanli dogru cevap (mc)
  correct      text,            -- panel formati: dogru secenek METNI
  hint         text,            -- fill bosluk ipucu
  words        jsonb,           -- order sorusu kelime listesi (string[])
  audio        text,            -- listen sorusu ses URL'si
  sort_order   integer not null default 0,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index questions_topic_idx on public.questions (topic_id);

-- ---------------------------------------------------------------------------
-- 7. WORDS — kelime havuzu (level, en sirasiyla cekiliyor)
-- ---------------------------------------------------------------------------
create table public.words (
  id         uuid primary key default gen_random_uuid(),
  en         text not null,
  tr         text not null,
  phonetic   text default '',
  example    text default '',
  level      text not null default 'A1',
  image      text,
  created_at timestamptz not null default now(),
  unique (en, level)
);
create index words_level_idx on public.words (level);

-- ---------------------------------------------------------------------------
-- 8. HOMEWORK — odevler/testler (created_at desc cekiliyor)
-- ---------------------------------------------------------------------------
create table public.homework (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text default '',
  due_date   date,
  hw_type    text not null default 'write'
             check (hw_type in ('write','ex','test')),
  topic_id   uuid references public.topics (id) on delete set null,
  pass       integer,                              -- gecis yuzdesi (onerilen 60)
  questions  jsonb not null default '[]'::jsonb,   -- [{k,q,o,c,...}] uygulama formati
  data       jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index homework_due_idx     on public.homework (due_date desc);
create index homework_created_idx on public.homework (created_at desc);

create table public.homework_targets (
  homework_id uuid not null references public.homework (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (homework_id, student_id)
);

create table public.homework_submissions (
  homework_id  uuid not null references public.homework (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  text         text default '',
  score        numeric(5,2),
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (homework_id, student_id)
);

-- ---------------------------------------------------------------------------
-- 9. ERISIM & ILERLEME
-- ---------------------------------------------------------------------------
create table public.topic_access (
  student_id uuid not null references public.profiles (id) on delete cascade,
  topic_id   uuid not null references public.topics (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (student_id, topic_id)
);

create table public.topic_complete (
  student_id   uuid not null references public.profiles (id) on delete cascade,
  topic_id     uuid not null references public.topics (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (student_id, topic_id)
);

create table public.topic_pass (
  student_id uuid not null references public.profiles (id) on delete cascade,
  topic_id   uuid not null references public.topics (id) on delete cascade,
  passed     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (student_id, topic_id)
);

create table public.subtopic_done (
  student_id  uuid not null references public.profiles (id) on delete cascade,
  subtopic_id uuid not null references public.subtopics (id) on delete cascade,
  done_at     timestamptz not null default now(),
  primary key (student_id, subtopic_id)
);

create table public.words_learned (
  student_id uuid not null references public.profiles (id) on delete cascade,
  word_id    uuid not null references public.words (id) on delete cascade,
  learned_at timestamptz not null default now(),
  primary key (student_id, word_id)
);

create table public.daily_words (
  student_id uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  count      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (student_id, day)
);

create table public.test_attempts (
  student_id uuid not null references public.profiles (id) on delete cascade,
  topic_id   uuid not null references public.topics (id) on delete cascade,
  attempts   integer not null default 0,
  passed     boolean not null default false,
  best_score numeric(5,2),
  updated_at timestamptz not null default now(),
  primary key (student_id, topic_id)
);

-- ---------------------------------------------------------------------------
-- 10. NOTIFICATIONS — panelden uygulamaya bildirim (son 100 cekiliyor)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles (id) on delete cascade,
  title      text not null default 'Bildirim',
  body       text not null default '',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_student_idx
  on public.notifications (student_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 11. APP_SETTINGS — anahtar/deger tema ve uygulama ayarlari
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('app_name',            '"English Board"'::jsonb),
  ('primary_color',       '"#E5484D"'::jsonb),
  ('background_color',    '"#FFF8F0"'::jsonb),
  ('text_color',          '"#1A1A1A"'::jsonb),
  ('custom_css',          '""'::jsonb),
  ('logo_url',            '""'::jsonb),
  ('welcome_text',        '"Ingilizce ogrenme yolculuguna hos geldin!"'::jsonb),
  ('maintenance_message', '""'::jsonb);

-- ---------------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY
--     Tum tablolarda RLS ACIK. service_role (panel/server) policy'leri atlar.
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.classes              enable row level security;
alter table public.topics               enable row level security;
alter table public.subtopics            enable row level security;
alter table public.questions            enable row level security;
alter table public.words                enable row level security;
alter table public.homework             enable row level security;
alter table public.homework_targets     enable row level security;
alter table public.homework_submissions enable row level security;
alter table public.topic_access         enable row level security;
alter table public.topic_complete       enable row level security;
alter table public.topic_pass           enable row level security;
alter table public.subtopic_done        enable row level security;
alter table public.words_learned        enable row level security;
alter table public.daily_words          enable row level security;
alter table public.test_attempts        enable row level security;
alter table public.notifications        enable row level security;
alter table public.app_settings         enable row level security;

-- Icerik: giris yapmis herkese salt-okunur (sync bu satirlari topluca cekiyor)
create policy content_read_topics on public.topics
  for select to authenticated using (true);
create policy content_read_subtopics on public.subtopics
  for select to authenticated using (true);
create policy content_read_questions on public.questions
  for select to authenticated using (true);
create policy content_read_words on public.words
  for select to authenticated using (true);
create policy content_read_classes on public.classes
  for select to authenticated using (true);

-- Icerik yazma: yalnizca ogretmen/admin
create policy teacher_write_topics on public.topics
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));
create policy teacher_write_subtopics on public.subtopics
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));
create policy teacher_write_questions on public.questions
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));
create policy teacher_write_words on public.words
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));
create policy teacher_write_classes on public.classes
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));

-- Profiles: kendi profilini oku/guncelle; ogretmen tum profilleri okur.
-- (LoginView e-postadan uuid cozumu ve sync .in('email', ...) sorgusu icin
--  ogretmenin tumunu okuyabilmesi sarttir.)
create policy profile_read on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_teacher(auth.uid()));
create policy profile_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy teacher_write_profiles on public.profiles
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));

-- Homework: ogrenci yalnizca kendine atanani gorur; ogretmen her seyi
create policy hw_read on public.homework
  for select to authenticated using (
    public.is_teacher(auth.uid())
    or exists (
      select 1 from public.homework_targets t
      where t.homework_id = homework.id and t.student_id = auth.uid()
    )
  );
create policy teacher_write_hw on public.homework
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));
create policy hw_targets_read on public.homework_targets
  for select to authenticated using (
    public.is_teacher(auth.uid()) or student_id = auth.uid()
  );
create policy teacher_write_hw_targets on public.homework_targets
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));

-- Odev teslimleri: ogrenci kendi satirini yazar, ogretmen hepsini gorur
create policy submission_read on public.homework_submissions
  for select to authenticated using (
    student_id = auth.uid() or public.is_teacher(auth.uid())
  );
create policy submission_write_own on public.homework_submissions
  for insert to authenticated with check (student_id = auth.uid());
create policy submission_update_own on public.homework_submissions
  for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy teacher_grade_submissions on public.homework_submissions
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));

-- topic_access: ogrenci kendi yetkisini okur (sync .in(student_id,...)
-- sorgusu yalnizca kendi uuid'sunu gonderir); ogretmen yönetir
create policy access_read on public.topic_access
  for select to authenticated using (
    student_id = auth.uid() or public.is_teacher(auth.uid())
  );
create policy teacher_manage_access on public.topic_access
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));

-- Ilerleme tablolari: ogrenci YALNIZCA kendi satirlarini yazar
-- (with check'te student_id = auth.uid() zorunlu — baskasinin ilerlemesi
--  tutulamaz), ogretmen istatistik icin okur.
create policy progress_read_complete on public.topic_complete
  for select to authenticated using (
    student_id = auth.uid() or public.is_teacher(auth.uid()));
create policy progress_write_complete on public.topic_complete
  for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

create policy progress_read_pass on public.topic_pass
  for select to authenticated using (
    student_id = auth.uid() or public.is_teacher(auth.uid()));
create policy progress_write_pass on public.topic_pass
  for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

create policy progress_read_subtopic on public.subtopic_done
  for select to authenticated using (
    student_id = auth.uid() or public.is_teacher(auth.uid()));
create policy progress_write_subtopic on public.subtopic_done
  for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

create policy progress_read_words on public.words_learned
  for select to authenticated using (
    student_id = auth.uid() or public.is_teacher(auth.uid()));
create policy progress_write_words on public.words_learned
  for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

create policy progress_read_daily on public.daily_words
  for select to authenticated using (
    student_id = auth.uid() or public.is_teacher(auth.uid()));
create policy progress_write_daily on public.daily_words
  for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

create policy progress_read_attempts on public.test_attempts
  for select to authenticated using (
    student_id = auth.uid() or public.is_teacher(auth.uid()));
create policy progress_write_attempts on public.test_attempts
  for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- Bildirimler: ogrenci kendi bildirimi okur/isaretler; ogretmen gonderir
create policy notif_read on public.notifications
  for select to authenticated using (
    student_id = auth.uid() or public.is_teacher(auth.uid()));
create policy notif_update_own on public.notifications
  for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy teacher_send_notif on public.notifications
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));

-- app_settings: oturum acik herkese okuma (tema/bakis mesaji), yazma ogretmene
create policy settings_read on public.app_settings
  for select to authenticated using (true);
create policy teacher_write_settings on public.app_settings
  for all to authenticated
  using (public.is_teacher(auth.uid())) with check (public.is_teacher(auth.uid()));

-- GRANT'lar: Supabase projelerinde public schema'da default privileges
-- tanimlidir; SQL Editor postgres superadmin calisir. Bu blok, seemanin
-- baska bir Postgres'e (local/ornek DB) tasinmasinda authenticated rolunun
-- "permission denied" almasini engeller.
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. REALTIME — useContentSync.ts bu 8 tabloya abone; publication'a
--     eklenmezse realtime sessiz kalir, sadece 60 sn polling calisir.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'topics','subtopics','questions','words','homework','homework_targets',
    'topic_access','notifications'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then
        execute 'create publication supabase_realtime';
        execute format('alter publication supabase_realtime add table public.%I', t);
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 14. updated_at TRIGGER'LARI
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger trg_topics_updated
  before update on public.topics
  for each row execute function public.set_updated_at();
create trigger trg_app_settings_updated
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ============================================================================
-- KURULUM BITTI. Sonraki adimlar:
--   1) Dashboard > Authentication > Add user: ogrenci/ogretmen hesaplari
--      (User metadata: {"full_name":"...","role":"student","level":"A1",
--       "must_change_password":true}) — trigger profili otomatik uretir.
--   2) .env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
--   3) Icerik ekle: topics/subtopics/questions/words/homework
--      Hizi icin ornek veri: supabase/seed-data.sql
-- ============================================================================
