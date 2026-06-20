import { useEffect, useState } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3218';

export interface JiraSite {
  id: string;
  url: string;
  name: string;
}

export interface User {
  accountId: string;
  name: string;
  email: string;
  picture: string;
  sites: JiraSite[];
  cloudId: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${SERVER_URL}/auth/me`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = () => {
    // Remember the in-app route (e.g. "poker/my-room") so the OAuth callback can
    // send the user back to where they landed instead of the lobby.
    const base = import.meta.env.BASE_URL;
    let returnTo = window.location.pathname;
    if (returnTo.startsWith(base)) returnTo = returnTo.slice(base.length);
    window.location.href = `${SERVER_URL}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  };

  const logout = () => {
    fetch(`${SERVER_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
      .finally(() => setUser(null));
  };

  const switchSite = async (cloudId: string) => {
    const res = await fetch(`${SERVER_URL}/auth/site`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloudId }),
    });
    if (res.ok) {
      setUser(u => (u ? { ...u, cloudId } : u));
    }
  };

  return { user, loading, login, logout, switchSite };
}
