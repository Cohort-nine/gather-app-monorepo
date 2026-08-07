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

  async function signup(payload) {
    const res = await authApi.signup(payload);
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data.user;
  }

  async function login(payload) {
    const res = await authApi.login(payload);
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data.user;
  }

  function logout() {
    clearToken();
    setUser(null);
    authApi.logout().catch(() => {});
  }

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
}
