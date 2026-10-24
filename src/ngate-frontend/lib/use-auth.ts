import { useCallback, useEffect, useState } from "react";

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/user", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Auth status ${response.status}`);
        return (await response.json()) as { user: AuthUser | null };
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setLoadError(false);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setLoadError(true);
          setIsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(() => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.assign(`/api/login?returnTo=${encodeURIComponent(returnTo || "/")}`);
  }, []);
  const logout = useCallback(() => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.assign(`/api/logout?returnTo=${encodeURIComponent(returnTo || "/")}`);
  }, []);

  return { user, isLoading, loadError, isAuthenticated: !!user, login, logout };
}
