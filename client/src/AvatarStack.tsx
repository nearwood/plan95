import { useEffect, useState } from 'react';

interface AvatarEntry {
  socketId: string;
  name: string;
  picture: string | null;
  leaving: boolean;
}

interface UserData {
  [socketId: string]: { name: string; picture: string | null };
}

export function AvatarStack({ userData }: { userData: UserData }) {
  const [entries, setEntries] = useState<AvatarEntry[]>([]);

  useEffect(() => {
    setEntries(prev => {
      const next = [...prev];

      // Mark removed users as leaving
      prev.forEach((entry, i) => {
        if (!userData[entry.socketId] && !entry.leaving) {
          next[i] = { ...entry, leaving: true };
          setTimeout(() => {
            setEntries(e => e.filter(a => a.socketId !== entry.socketId));
          }, 300);
        }
      });

      // Add new users
      Object.entries(userData).forEach(([socketId, user]) => {
        if (!next.find(e => e.socketId === socketId)) {
          next.push({ socketId, name: user.name, picture: user.picture, leaving: false });
        }
      });

      return next;
    });
  }, [userData]);

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {entries.map(entry => (
        <div
          key={entry.socketId}
          title={entry.name}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            marginLeft: -10,
            border: '2px solid #008001',
            overflow: 'hidden',
            flexShrink: 0,
            animation: entry.leaving ? 'avatarPop 0.3s ease-in reverse forwards' : 'avatarPop 0.3s ease-out',
          }}
        >
          {entry.picture
            ? <img src={entry.picture} alt={entry.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', background: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 'bold' }}>
                {entry.name?.[0]?.toUpperCase() ?? '?'}
              </div>
          }
        </div>
      ))}
    </div>
  );
}
