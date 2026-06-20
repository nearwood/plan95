import { Select } from 'react95';
import { useOutletContext } from 'react-router-dom';
import type { User } from './useAuth';

// A small dropdown to switch the active Jira site, shown only when the user has
// access to more than one. Issue lookups resolve against the selected site.
export function SiteSelector() {
  const { user, switchSite } = useOutletContext<{
    user: User;
    switchSite: (cloudId: string) => void;
  }>();

  if (!user.sites || user.sites.length < 2) return null;

  return (
    <Select
      options={user.sites.map(s => ({ label: s.name, value: s.id }))}
      value={user.cloudId}
      onChange={opt => switchSite(opt.value)}
      width={160}
    />
  );
}
