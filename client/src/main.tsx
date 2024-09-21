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
      }
    ]
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SocketProvider>
      <RouterProvider router={router} />
    </SocketProvider>
  </StrictMode>,
);
