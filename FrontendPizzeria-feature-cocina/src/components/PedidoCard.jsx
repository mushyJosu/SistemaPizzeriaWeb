import { useEffect, useState } from "react";
import { ESTADOS, ETIQUETAS } from "../constants/estados";
import { IMAGENES_PIZZA, IMAGEN_POR_DEFECTO } from "../constants/imagenesPizza";
import useSwipeVertical from "../hooks/useSwipeVertical";

function formatearTiempo(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// Texto del tiempo estimado que eligió el cocinero al tomar el pedido
function textoEstimado(pedido, ahora) {
  if (!pedido.estimadoMinutos) return "";
  if (pedido.finEstimado === null) return `Estimado ${pedido.estimadoMinutos} min`;

  const restante = pedido.finEstimado - ahora;
  const minutos = Math.ceil(Math.abs(restante) / 60000);
  return restante >= 0
    ? `Estimado ${pedido.estimadoMinutos} min · faltan ${minutos} min`
    : `Estimado ${pedido.estimadoMinutos} min · retrasado ${minutos} min`;
}

export default function PedidoCard({ pedido, onAvanzar, onRetroceder }) {
  const { offset, arrastrando, handlers } = useSwipeVertical({
    onUp: () => onAvanzar(pedido.id),
    onDown: () => onRetroceder(pedido.id),
  });

  // Reloj para el cronómetro (cocinando) y el tiempo restante (preparación y cocinando)
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    if (pedido.estado === ESTADOS.PENDIENTE) return;
    setAhora(Date.now()); // evita mostrar un tiempo viejo justo al cambiar de estado
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pedido.estado]);

  const etiqueta =
    pedido.estado === ESTADOS.COCINANDO && pedido.inicioCocina
      ? `Cocinando tiempo: ${formatearTiempo(ahora - pedido.inicioCocina)}`
      : ETIQUETAS[pedido.estado];

  // `imagen` lo calcula el adaptador de la API; `tipo` se conserva para los datos de prueba originales
  // La bebida del catálogo se representa con un icono para no mostrar una foto de pizza.
  const esBebida = /refresco|bebida/i.test(pedido.tipo || "");
  const imagen = IMAGENES_PIZZA[pedido.imagen ?? pedido.tipo] || IMAGEN_POR_DEFECTO;
  const estimado = pedido.estado === ESTADOS.PENDIENTE ? "" : textoEstimado(pedido, ahora);
  const retrasado = estimado.includes("retrasado");

  return (
    <div className="columna">
      <span className="etiqueta">{etiqueta}</span>

      <article
        className={`card card--${pedido.estado} ${arrastrando ? "card--drag" : ""}`}
        style={{ transform: `translateY(${offset}px)` }}
        {...handlers}
      >
        <div className="card__imagen">
          {esBebida ? (
            <span className="card__producto-icono" aria-label={pedido.tipo}>🥤</span>
          ) : (
            <img src={imagen} alt={pedido.tipo} draggable={false} />
          )}
        </div>
        <small className="card__cliente">
          {[pedido.folio, pedido.cliente, pedido.tipoPedido].filter(Boolean).join(" · ")}
        </small>
        <p className="card__tipo">{pedido.tipo}</p>
        <small className="card__specs">{pedido.especificaciones}</small>
        {estimado && (
          <small className={`card__estimado ${retrasado ? "card__estimado--tarde" : ""}`}>{estimado}</small>
        )}
      </article>
    </div>
  );
}
