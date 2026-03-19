import { POKER_VALUES } from './pokerValues';

interface UserData {
  [socketId: string]: { name: string; picture: string | null };
}

interface Props {
  votes: Record<string, string | null>;
  userData: UserData;
}

function Avatar({ user }: { socketId: string; user: { name: string; picture: string | null } }) {
  return (
    <div
      title={user.name}
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        border: '2px solid #008001',
        overflow: 'hidden',
        flexShrink: 0,
        animation: 'avatarPop 0.3s ease-out',
      }}
    >
      {user.picture
        ? <img src={user.picture} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ width: '100%', height: '100%', background: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 'bold' }}>
            {user.name?.[0]?.toUpperCase() ?? '?'}
          </div>
      }
    </div>
  );
}

export function VoteDistribution({ votes, userData }: Props) {
  const groups = POKER_VALUES
    .map(value => ({
      value,
      voters: Object.entries(votes)
        .filter(([, v]) => v === value)
        .map(([socketId]) => socketId),
    }))
    .filter(g => g.voters.length > 0);

  if (groups.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, padding: '0 10px 0 4px', flexShrink: 0 }}>
      {groups.map(({ value, voters }) => (
        <div key={value} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 22,
            textAlign: 'right',
            color: '#fff',
            textShadow: '1px 1px 0 #000',
            fontWeight: 'bold',
            fontSize: 13,
            flexShrink: 0,
          }}>
            {value}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {voters.map(socketId => {
              const user = userData[socketId];
              return user ? <Avatar key={socketId} socketId={socketId} user={user} /> : null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
