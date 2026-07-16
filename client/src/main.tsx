import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { SocketProvider } from './socketContext.tsx';

import {
  createBrowserRouter,
  RouterProvider,
} from "react-router-dom";
import App from './App.tsx';
import PokerRoom from './PokerRoom.tsx';
import Lobby from './Lobby.tsx';
import BotLab from './BotLab.tsx';

// Handle GitHub Pages 404 redirect
const redirectPath = new URLSearchParams(window.location.search).get('p');
if (redirectPath) {
  window.history.replaceState(null, '', redirectPath);
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: '',
        element: <Lobby />,
      },
      {
        path: "poker/:roomName",
        element: <PokerRoom />,
      },
      {
        path: "dev/bots/:roomName",
        element: <BotLab />,
      }
    ]
  },
], { basename: import.meta.env.BASE_URL });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SocketProvider>
      <RouterProvider router={router} />
    </SocketProvider>
  </StrictMode>,
);
