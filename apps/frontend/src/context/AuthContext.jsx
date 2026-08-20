import { createContext, useContext, useEffect, useState } from "react";
import * as authApi from "../api/auth.js";
import { clearToken, getToken, setToken } from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Starts true whenever a token is already on disk, so routes can wait for
  // the /auth/me check instead of flashing a signed-out UI for a beat.
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;

    authApi
      .fetchMe()
      .then((res) => setUser(res.data))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  // signup/login return a trimmed publicUser() with no reliability/reputation
  // data — fine for most of the app, but the nav badge needs the full profile
  // immediately rather than waiting for a reload to trigger the /auth/me
  // hydration above. The trimmed user still goes in first so nothing renders
  // blank while this second call is in flight.
  async function hydrateFullProfile() {
    try {
      const full = await authApi.fetchMe();
      setUser(full.data);
    } catch {
      /* Non-fatal — the trimmed user from signup/login is still usable. */
    }
  }

  async function signup(payload) {
    const res = await authApi.signup(payload);
    setToken(res.data.token);
    setUser(res.data.user);
    hydrateFullProfile();
    return res.data.user;
  }

  async function login(payload) {
    const res = await authApi.login(payload);
    setToken(res.data.token);
    setUser(res.data.user);
    hydrateFullProfile();
    return res.data.user;
  }

  function logout() {
    clearToken();
    setUser(null);
    authApi.logout().catch(() => {});
  }

  // For flows that update the current user server-side (avatar upload, later
  // a profile-edit form) and get the fresh object back — patches the cached
  // user in place instead of making every caller re-fetch /auth/me.
  function updateUser(patch) {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
}
