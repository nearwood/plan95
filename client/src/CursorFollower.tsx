interface CursorFollowerProps {
  x: number; // fraction (0-1) of the containing table's width
  y: number; // fraction (0-1) of the containing table's height
  image: string;
}

export function CursorFollower({ x, y, image }: CursorFollowerProps) {
  return (
    <img
      className='cursorFollower'
      src={image}
      alt=''
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    />
  );
}
