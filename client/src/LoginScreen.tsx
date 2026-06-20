import { WindowHeader, Button, Frame, WindowContent } from 'react95';

const AUTH_ERRORS: Record<string, string> = {
  no_jira_access:
    "You don't have access to the team's Jira workspace. Ask an admin to grant you access, then try again.",
  '1': 'Something went wrong signing in. Please try again.',
};

function LoginScreen({ onLogin, authError }: { onLogin: () => void; authError?: string | null }) {
  const message = authError ? (AUTH_ERRORS[authError] ?? AUTH_ERRORS['1']) : null;

  return (<>
    <WindowHeader className='window-title'>
      <span><img src='/favicon.png' className='title-icon' alt='' />plan95</span>
    </WindowHeader>
    <WindowContent className='windowContent' style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      {message && (
        <Frame variant='well' style={{ padding: 8, maxWidth: 320, textAlign: 'center', color: '#a00000' }}>
          {message}
        </Frame>
      )}
      <p>Sign in to start planning.</p>
      <Button onClick={onLogin}>Login with Atlassian</Button>
    </WindowContent>
    <Frame variant='well' className='footer' />
  </>);
}

export default LoginScreen;
