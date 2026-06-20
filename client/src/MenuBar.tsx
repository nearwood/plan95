import { useState } from 'react';
import { Toolbar, Button, MenuList, MenuListItem } from 'react95';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { User } from './useAuth';

const ISSUES_URL = 'https://github.com/nearwood/plan95/issues';

type Menu = 'file' | 'room' | 'help';

const menuListStyle = { position: 'absolute', top: 24, zIndex: 9999 } as const;

export function MenuBar({ inLobby = false }: { inLobby?: boolean }) {
  const { logout } = useOutletContext<{ user: User; logout: () => void }>();
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState<Menu | null>(null);

  const toggle = (menu: Menu) => setOpenMenu(prev => (prev === menu ? null : menu));
  const close = () => setOpenMenu(null);

  return (
    <Toolbar className='toolbar'>
      <Button variant='menu' size='sm' onClick={() => toggle('file')}>
        File
        {openMenu === 'file' && (
          <MenuList style={menuListStyle} onClick={close}>
            <MenuListItem size='sm' onClick={logout}>Logout</MenuListItem>
          </MenuList>
        )}
      </Button>
      <Button variant='menu' size='sm' disabled>Edit</Button>
      {inLobby ? (
        <Button variant='menu' size='sm' disabled>Room</Button>
      ) : (
        <Button variant='menu' size='sm' onClick={() => toggle('room')}>
          Room
          {openMenu === 'room' && (
            <MenuList style={menuListStyle} onClick={close}>
              <MenuListItem size='sm' onClick={() => navigate('/')}>Return to Lobby</MenuListItem>
            </MenuList>
          )}
        </Button>
      )}
      <Button variant='menu' size='sm' onClick={() => toggle('help')}>
        Help
        {openMenu === 'help' && (
          <MenuList style={menuListStyle} onClick={close}>
            <MenuListItem
              size='sm'
              onClick={() => window.open(ISSUES_URL, '_blank', 'noopener,noreferrer')}
            >
              Report an issue
            </MenuListItem>
          </MenuList>
        )}
      </Button>
    </Toolbar>
  );
}
