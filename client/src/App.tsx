import { styleReset, Window } from 'react95';
import { createGlobalStyle, ThemeProvider } from 'styled-components';

/* Pick a theme of your choice */
import original from 'react95/dist/themes/original';
import './App.css'

/* Original Windows95 font (optional) */
import ms_sans_serif from 'react95/dist/fonts/ms_sans_serif.woff2';
import ms_sans_serif_bold from 'react95/dist/fonts/ms_sans_serif_bold.woff2';
import { Outlet } from 'react-router-dom';
// import { useOnlineStatus } from './useOnlineStatus';

const GlobalStyles = createGlobalStyle`
  ${styleReset}
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
  // const isOnline = useOnlineStatus();

  return (
    <>
      <GlobalStyles />
      <ThemeProvider theme={original}>
        <Window className='window'>
          <Outlet />
        </Window>
      </ThemeProvider>
    </>
  );
}

export default App;
