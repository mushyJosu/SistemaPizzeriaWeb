import { useRef, useState } from "react";

/**
 * Detecta deslizamiento vertical con el dedo/mouse.
 * - onUp: se llama al deslizar hacia arriba
 * - onDown: se llama al deslizar hacia abajo
 * Devuelve `offset` para mover la tarjeta mientras se arrastra.
 */
export default function useSwipeVertical({ onUp, onDown, umbral = 70 }) {
  const inicioY = useRef(null);
  const [offset, setOffset] = useState(0);
  const [arrastrando, setArrastrando] = useState(false);

  const handlePointerDown = (e) => {
    inicioY.current = e.clientY;
    setArrastrando(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (inicioY.current === null) return;
    const dy = e.clientY - inicioY.current;
    // limitamos el arrastre visual a ±120px
    setOffset(Math.max(-120, Math.min(120, dy)));
  };

  const terminar = (e) => {
    if (inicioY.current === null) return;
    const dy = e.clientY - inicioY.current;
    inicioY.current = null;
    setArrastrando(false);
    setOffset(0);

    if (dy <= -umbral) onUp?.();
    else if (dy >= umbral) onDown?.();
  };

  return {
    offset,
    arrastrando,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: terminar,
      onPointerCancel: terminar,
    },
  };
}