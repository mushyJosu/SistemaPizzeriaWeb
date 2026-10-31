import { OPCIONES_MINUTOS } from "../constants/tiempos";

// Ventana para elegir el tiempo estimado al tomar un pedido (botones grandes para tablet)
export default function SelectorTiempo({ pedido, onElegir, onCancelar }) {
  return (
    <div className="selector" role="dialog" aria-modal="true" aria-labelledby="selector-titulo" onClick={onCancelar}>
      <div className="selector__caja" onClick={(e) => e.stopPropagation()}>
        <p className="selector__folio">{pedido.folio}</p>
        <h2 id="selector-titulo">¿Cuánto tardará el pedido de {pedido.cliente}?</h2>

        <div className="selector__opciones">
          {OPCIONES_MINUTOS.map((minutos) => (
            <button key={minutos} type="button" className="selector__opcion" onClick={() => onElegir(minutos)}>
              {minutos} min
            </button>
          ))}
        </div>

        <button type="button" className="selector__cancelar" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
