import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabaseSignIn, supabaseRefresh, supabaseSignOut } from '../services/supabaseAdmin';

// Sesion de administrador de Supabase (separada de la sesion de LaLiga Fantasy).
// Solo quien tenga esta sesion puede escribir/refrescar los mapeos.
export const useAdminAuthStore = create(
  persist(
    (set, get) => ({
      session: null, // { access_token, refresh_token, user }
      isAdmin: false,
      error: null,
      loading: false,

      login: async (email, password) => {
        set({ loading: true, error: null });
        try {
          const session = await supabaseSignIn(email, password);
          set({ session, isAdmin: true, loading: false });
          return true;
        } catch (e) {
          set({
            error: e.message || 'No se pudo iniciar sesión',
            loading: false,
            isAdmin: false,
            session: null,
          });
          return false;
        }
      },

      logout: async () => {
        const s = get().session;
        if (s?.access_token) await supabaseSignOut(s.access_token);
        set({ session: null, isAdmin: false, error: null });
      },

      // Devuelve un access_token valido, refrescandolo si hiciera falta o si expiró.
      getAccessToken: () => get().session?.access_token || null,

      ensureValidToken: async () => {
        const s = get().session;
        if (!s) return null;

        // Comprobar si el access_token actual sigue valido (no expirado).
        if (s.access_token) {
          try {
            const payload = JSON.parse(atob(s.access_token.split('.')[1]));
            const marginSec = 60; // margen de 60s para renovar antes de que expire
            if (payload.exp && payload.exp * 1000 > Date.now() + marginSec * 1000) {
              return s.access_token;
            }
          } catch {
            // token malformado: refrescar
          }
        }

        // Token expirado o ausente: refrescar con refresh_token.
        if (s.refresh_token) {
          try {
            const ns = await supabaseRefresh(s.refresh_token);
            set({ session: { ...s, ...ns } });
            return ns.access_token;
          } catch {
            set({ session: null, isAdmin: false });
            return null;
          }
        }

        // Sin refresh_token: sesión inválida.
        set({ session: null, isAdmin: false });
        return null;
      },
    }),
    {
      name: 'admin-supabase-auth',
      partialize: (state) => ({ session: state.session, isAdmin: state.isAdmin }),
    },
  ),
);
