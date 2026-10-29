import { useEffect, useRef } from 'react';
import { Engine } from '../engine/Engine';

declare global {
  interface Window {
    __ducks?: { engine: Engine };
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine({ canvas, quality: 'high' });
    const resize = () => engine.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    engine.start();
    window.__ducks = { engine };
    return () => {
      ro.disconnect();
      engine.dispose();
    };
  }, []);
  return (
    <div className="stage">
      <canvas ref={canvasRef} />
    </div>
  );
}
