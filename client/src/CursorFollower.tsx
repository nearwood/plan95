interface CursorFollowerProps {
  x: number; // fraction (0-1) of the containing table's width
  y: number; // fraction (0-1) of the containing table's height
  image: string;
  visible: boolean;
}

export function CursorFollower({ x, y, image, visible }: CursorFollowerProps) {
  return (
    <img
      className='cursorFollower'
      src={image}
      alt=''
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, visibility: visible ? 'visible' : 'hidden' }}
    />
  );
}
