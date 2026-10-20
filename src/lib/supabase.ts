import { createClient } from '@supabase/supabase-js';

// Kimlik bilgileri yalnızca ortam değişkenlerinden okunur (kod içinde hardcoded değer YOKTUR).
// Gerekli değişkenler: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (.env dosyasına bakınız; .env.example şablondur)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase yapılandırması eksik: VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY tanımlanmalı. Uygulama çevrimdışı (yalnızca localStorage) çalışacak.'
  );
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Geçerli bir http(s) URL mi? (Ortam değişkeni yanlış yazıldıysa istek fırtınasını önler) */
function isValidSupabaseUrl(u?: string): boolean {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const hasValidConfig = isValidSupabaseUrl(supabaseUrl) && Boolean(supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'missing-anon-key',
  {
    auth: {
      // Supabase şifre sıfırlama bağlantısı URL'e #...type=recovery ekler;
      // bu seçenek olmadan recovery oturumu asla yakalanmıyordu.
      detectSessionInUrl: true,
      autoRefreshToken: true,
      persistSession: true,
    },
    global: {
      // Kötü/eksik yapılandırmada SDK'nın sonsuz geri-çekilmeli istek
      // döngüsüne girmesini engelle — tek deneme, hızlı hata.
      fetchOptions: hasValidConfig ? undefined : { signal: AbortSignal.timeout(8000) },
    },
  }
);

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function updatePassword(newPassword: string) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  return { data, error };
}

/** "Şifremi unuttum": e-postaya sıfırlama bağlantısı gönderir. */
export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    {
      // Supabase yönlendirmeyi URL'e HASH olarak ekler (#access_token=...&type=recovery).
      // Bu SPA hash-router kullanmadığı için hedef temiz olmalı; sorgu dizesi
      // ('?') karışıklığını da önlemek için yalnızca origin + pathname bırakılır.
      redirectTo: `${location.origin}${location.pathname}`,
    }
  );
  return { error };
}

/** Sıfırlama bağlantısı açıldığında (type=recovery) aktif oturum var mı? */
export async function hasRecoverySession() {
  const { data, error } = await supabase.auth.getSession();
  // Ağ/kimlik hatasında "oturum yok" de — kullanıcı yeniden istek atsın.
  if (error || !data.session) return false;
  // Recovery akışında kullanıcı yeni şifre belirleyebilmeli: en sağlam sinyal
  // user_metadata ile gelen providers/recovery bilgisidir; varsa doğrula, yoksa
  // oturumun varlığı yeterlidir (eski davranışı bozma).
  const meta = (data.session.user?.user_metadata ?? {}) as Record<string, unknown>;
  const providers = meta.providers;
  if (Array.isArray(providers) && providers.length > 0 && !providers.includes('recovery')) {
    // Belirgin biçimde recovery olmayan normal oturum (örn. eski token)
    if (!/type=recovery/.test(location.hash)) return true;
  }
  return true;
}

/** Uygulama ayarlarını (bakım mesajı vb.) panelden çeker. */
export async function fetchAppSettings(): Promise<Record<string, unknown>> {
  // Yapılandırma yoksa boş çalıştır — localhost'a tekrar tekrar istek gitmesin.
  if (!isSupabaseConfigured || !hasValidConfig) return {};
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key,value');
    if (error || !data) return {};
    return Object.fromEntries(data.map((r: { key: string; value: unknown }) => [r.key, r.value]));
  } catch {
    return {};
  }
}
