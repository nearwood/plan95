import { useEffect, useState } from 'react';
import { WindowHeader, Frame, WindowContent, ProgressBar } from 'react95';

const MESSAGES = [
  'Defragmenting Drive C:...',
  'Running CHKDSK on C:...',
  'Scanning disk for errors...',
  'Running ScanDisk on C:...',
  'Checking file allocation table...',
  'Compressing Drive C:...',
  'Searching for Plug and Play devices...',
  'Building driver database...',
  'Installing printers...',
  'Updating system configuration...',
  'Loading VxD drivers...',
  'Optimizing memory usage...',
  'Restoring Recycle Bin...',
  'Rebuilding desktop icons...',
  'Initializing Dial-Up Networking...',
  'Configuring Win95 registry...',
  'Reticulating splines...',
];

const MAX_PROGRESS = 99;
const FULL_DURATION_MS = 4 * 60 * 1000;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pickMessage = (previous?: string) => {
  let next: string;
  do { next = MESSAGES[Math.floor(Math.random() * MESSAGES.length)]; } while (next === previous);
  return next;
};

function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(() => pickMessage());

  // Fake progress: a jittered, monotonic climb toward MAX_PROGRESS that only
  // gets there after FULL_DURATION_MS, advancing at random intervals.
  useEffect(() => {
    const start = Date.now();
    let timer: number;
    const tick = () => {
      const target = MAX_PROGRESS * Math.min(1, (Date.now() - start) / FULL_DURATION_MS);
      setProgress(prev => Math.max(prev, Math.min(MAX_PROGRESS, target * rand(0.7, 1.3))));
      timer = window.setTimeout(tick, rand(300, 2500));
    };
    timer = window.setTimeout(tick, rand(300, 1000));
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let timer: number;
    const tick = () => {
      setMessage(prev => pickMessage(prev));
      timer = window.setTimeout(tick, rand(2000, 6000));
    };
    timer = window.setTimeout(tick, rand(2000, 6000));
    return () => window.clearTimeout(timer);
  }, []);

  return (<>
    <WindowHeader className='window-title'>
      <span><img src='/favicon.png' className='title-icon' alt='' />plan95</span>
    </WindowHeader>
    <WindowContent className='windowContent' style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <p>{message}</p>
      <ProgressBar value={Math.floor(progress)} style={{ width: 'min(320px, 100%)' }} />
    </WindowContent>
    <Frame variant='well' className='footer' />
  </>);
}

export default LoadingScreen;
