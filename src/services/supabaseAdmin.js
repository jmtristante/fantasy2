// Auth de administrador contra Supabase usando la Auth REST (sin SDK extra).
// El rol anon inicia la sesion; las escrituras en mapeo_jugadores exigen el
// access_token del usuario (rol authenticated) para pasar la RLS.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const isSupabaseAuthConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON);

async function postAuth(grantType, body, signal) {
  const url = `${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error_description || j?.msg || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function supabaseSignIn(email, password, signal) {
  const data = await postAuth('password', { email, password }, signal);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: data.user,
  };
}

export async function supabaseRefresh(refresh_token, signal) {
  const data = await postAuth('refresh_token', { refresh_token }, signal);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refresh_token,
    user: data.user,
  };
}

export async function supabaseSignOut(access_token, signal) {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
      signal,
    });
  } catch { /* ignore */ }
}
