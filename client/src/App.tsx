import { styleReset, Window } from 'react95';
import { createGlobalStyle, ThemeProvider } from 'styled-components';

import original from 'react95/dist/themes/original';
import './App.css'

import ms_sans_serif from 'react95/dist/fonts/ms_sans_serif.woff2';
import ms_sans_serif_bold from 'react95/dist/fonts/ms_sans_serif_bold.woff2';
import { Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';
import LoginScreen from './LoginScreen';

const GlobalStyles = createGlobalStyle`
  ${styleReset}
  html, body, #root {
    height: 100%;
    margin: 0;
    padding: 0;
  }
  #root {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #008080;
    min-height: 100vh;
    padding: 16px;
    box-sizing: border-box;
  }
  @font-face {
    font-family: 'ms_sans_serif';
    src: url('${ms_sans_serif}') format('woff2');
    font-weight: 400;
    font-style: normal
  }
  @font-face {
    font-family: 'ms_sans_serif';
    src: url('${ms_sans_serif_bold}') format('woff2');
    font-weight: bold;
    font-style: normal
  }
`;

function App() {
  const { user, loading, login, logout } = useAuth();

  return (
    <>
      <GlobalStyles />
      <ThemeProvider theme={original}>
        <Window className='window'>
          {loading
            ? null
            : user
              ? <Outlet context={{ user, logout }} />
              : <LoginScreen onLogin={login} />
          }
        </Window>
      </ThemeProvider>
    </>
  );
}

export default App;
