import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';
import LoadingScreen from './LoadingScreen';

// The root URL has no UI of its own: once auth has resolved (App only renders
// this route then), drop the user into a freshly named room.
function Lobby() {
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const roomName = uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: '-',
    });
    // replace so Back doesn't return to "/" and bounce straight into another room
    navigate(`/poker/${roomName}`, { replace: true });
  }, [navigate]);

  return <LoadingScreen />;
}

export default Lobby;
