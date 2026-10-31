import { useCallback, useEffect, useRef, useState } from "react";
import PedidoCard from "./components/PedidoCard";
import SelectorTiempo from "./components/SelectorTiempo";
import Toast from "./components/Toast";
import { ESTADOS } from "./constants/estados";
import { INTERVALO_ACTUALIZACION } from "./constants/tiempos";
import {
  marcarListo,
  meterAlHorno,
  obtenerPedidos,
  regresarPedido,
  tomarPedido,
} from "./api/cocina";

export default function App() {
  const [pedidos, setPedidos] = useState([]);
  const [toast, setToast] = useState(null);
  const [errorConexion, setErrorConexion] = useState("");
  const [cargando, setCargando] = useState(true);
  const [pedidoPorTomar, setPedidoPorTomar] = useState(null);

  // Mientras haya cambios enviándose, la actualización automática no pisa la pantalla
  const cambiosEnCurso = useRef(0);
  const temporizadorToast = useRef(null);

  const mostrarToast = useCallback((mensaje, tipo = "ok") => {
    clearTimeout(temporizadorToast.current);
    setToast({ mensaje, tipo });
    temporizadorToast.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const cargar = useCallback(async ({ forzar = false } = {}) => {
    if (!forzar && cambiosEnCurso.current > 0) return;
    try {
      const datos = await obtenerPedidos();
      if (forzar || cambiosEnCurso.current === 0) setPedidos(datos);
      setErrorConexion("");
    } catch (error) {
      setErrorConexion(error.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, INTERVALO_ACTUALIZACION);
    return () => clearInterval(intervalo);
  }, [cargar]);

  // Aplica el cambio en pantalla de inmediato y lo guarda en el backend.
  // Si el backend lo rechaza, se recargan los datos reales y se muestra el error.
  const ejecutarCambio = async (cambioLocal, llamada, mensajeOk) => {
    cambiosEnCurso.current += 1;
    setPedidos(cambioLocal);
    try {
      await llamada();
      if (mensajeOk) mostrarToast(mensajeOk);
    } catch (error) {
      mostrarToast(error.message, "error");
    } finally {
      cambiosEnCurso.current -= 1;
      if (cambiosEnCurso.current === 0) await cargar({ forzar: true });
    }
  };

  const actualizarPedido = (id, cambios) => (prev) =>
    prev.map((p) => (p.id === id ? { ...p, ...cambios } : p));

  // Punto de integración con recepción: el pedido pasa a LISTO en la BD
  // y recepción lo ve en su siguiente actualización.
  const notificarARecepcion = (pedido) =>
    ejecutarCambio(
      (prev) => prev.filter((p) => p.id !== pedido.id),
      () => marcarListo(pedido.id),
      `Pedido de ${pedido.cliente} listo, enviado a recepción`
    );

  const avanzar = (id) => {
    const pedido = pedidos.find((p) => p.id === id);
    if (!pedido) return;

    if (pedido.estado === ESTADOS.PENDIENTE) {
      // Antes de tomarlo, el cocinero indica cuánto tardará
      setPedidoPorTomar(pedido);
      return;
    }

    if (pedido.estado === ESTADOS.PREPARACION) {
      ejecutarCambio(
        actualizarPedido(id, { estado: ESTADOS.COCINANDO, inicioCocina: Date.now() }),
        () => meterAlHorno(id)
      );
      return;
    }

    // Si ya estaba en rojo (cocinando) y sube: se envía a recepción
    notificarARecepcion(pedido);
  };

  const confirmarTiempo = (minutos) => {
    const pedido = pedidoPorTomar;
    setPedidoPorTomar(null);
    if (!pedido) return;

    ejecutarCambio(
      actualizarPedido(pedido.id, {
        estado: ESTADOS.PREPARACION,
        estimadoMinutos: minutos,
        finEstimado: Date.now() + minutos * 60000,
      }),
      () => tomarPedido(pedido.id, minutos)
    );
  };

  const retroceder = (id) => {
    const pedido = pedidos.find((p) => p.id === id);
    if (!pedido || pedido.estado === ESTADOS.PENDIENTE) return; // ya está en el estado inicial

    const cambios =
      pedido.estado === ESTADOS.COCINANDO
        ? { estado: ESTADOS.PREPARACION, inicioCocina: null }
        : { estado: ESTADOS.PENDIENTE, inicioCocina: null, estimadoMinutos: null, finEstimado: null };

    ejecutarCambio(actualizarPedido(id, cambios), () => regresarPedido(id));
  };

  return (
    <main className="tablero">
      <header className="tablero__header">
        <h1>Cocina</h1>
        <span>{pedidos.length} pedidos activos</span>
      </header>

      {errorConexion && <p className="aviso-conexion">{errorConexion}</p>}

      <section className="fila">
        {pedidos.map((pedido) => (
          <PedidoCard
            key={pedido.id}
            pedido={pedido}
            onAvanzar={avanzar}
            onRetroceder={retroceder}
          />
        ))}

        {!cargando && pedidos.length === 0 && !errorConexion && (
          <p className="fila__vacia">Sin pedidos por preparar 🍕</p>
        )}
      </section>

      <p className="ayuda">⬆️ Desliza hacia arriba para avanzar · ⬇️ hacia abajo para regresar</p>

      {pedidoPorTomar && (
        <SelectorTiempo
          pedido={pedidoPorTomar}
          onElegir={confirmarTiempo}
          onCancelar={() => setPedidoPorTomar(null)}
        />
      )}

      <Toast mensaje={toast?.mensaje} tipo={toast?.tipo} />
    </main>
  );
}
