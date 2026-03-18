import { WindowHeader, Button, Frame, WindowContent } from 'react95';

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (<>
    <WindowHeader className='window-title'>
      <span>plan95</span>
    </WindowHeader>
    <WindowContent className='windowContent' style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <p>Sign in to start planning.</p>
      <Button onClick={onLogin}>Login with Atlassian</Button>
    </WindowContent>
    <Frame variant='well' className='footer' />
  </>);
}

export default LoginScreen;
