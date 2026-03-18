import { useEffect, useState } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3218';

export interface User {
  accountId: string;
  name: string;
  email: string;
  picture: string;
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
    window.location.href = `${SERVER_URL}/auth/login`;
  };

  const logout = () => {
    fetch(`${SERVER_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
      .finally(() => setUser(null));
  };

  return { user, loading, login, logout };
}
