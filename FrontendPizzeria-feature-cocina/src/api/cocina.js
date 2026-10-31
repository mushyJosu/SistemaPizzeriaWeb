import { ESTADOS } from "../constants/estados";
import { IMAGENES_PIZZA } from "../constants/imagenesPizza";

// Rutas relativas: en desarrollo Vite las reenvía al backend (ver vite.config.js)
const API = import.meta.env.VITE_API_URL || "/api/v1";

const SIN_CONEXION = "No se pudo conectar con el servidor. ¿Está encendido el backend (npm start)?";

async function peticion(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`${API}${ruta}`, {
      headers: { "Content-Type": "application/json" },
      ...opciones,
    });
  } catch {
    throw new Error(SIN_CONEXION);
  }

  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    // El proxy de Vite responde 5xx sin cuerpo cuando el backend está apagado
    if (!datos?.error && respuesta.status >= 500) {
      throw new Error(SIN_CONEXION);
    }
    throw new Error(datos?.error || `Error del servidor (${respuesta.status})`);
  }
  if (datos === null) {
    throw new Error("El servidor no respondió JSON. Revisa el proxy de Vite (vite.config.js).");
  }
  return datos;
}

// ============================================
// ADAPTADOR: pedido de la BD → modelo de cocina
// { id, cliente, tipo, especificaciones, estado, inicioCocina, ... }
// ============================================

const TIPOS_PEDIDO = {
  LOCAL: "En el local",
  PARA_LLEVAR: "Para llevar",
  DOMICILIO: "A domicilio",
};

// Palabras del nombre del producto → llave de IMAGENES_PIZZA
const PALABRAS_IMAGEN = [
  { palabras: ["pepperoni", "peperoni"], imagen: "Pepperoni" },
  // Se reutiliza la imagen de queso disponible para representar la Pizza Hawaiana del menú común.
  { palabras: ["hawaiana"], imagen: "Queso" },
  { palabras: ["champinon", "champinones"], imagen: "Champiñones" },
  { palabras: ["especia", "picante"], imagen: "Especias" },
  { palabras: ["queso"], imagen: "Queso" },
];

const MAX_LINEAS = 4;

function normalizar(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function claveImagen(nombre) {
  const texto = normalizar(nombre);
  const coincidencia = PALABRAS_IMAGEN.find(({ palabras }) =>
    palabras.some((palabra) => texto.includes(palabra))
  );
  return coincidencia && IMAGENES_PIZZA[coincidencia.imagen] ? coincidencia.imagen : null;
}

// La tarjeta muestra la primera pizza del pedido (o el primer producto si no hay pizzas)
function elegirProductoPrincipal(items) {
  return (
    items.find((item) => claveImagen(item.product_name)) ||
    items.find((item) => normalizar(item.product_name).includes("pizza")) ||
    items[0]
  );
}

function describirProductos(items) {
  const lineas = items.map((item) => {
    const nombre = item.product_name || "Producto eliminado";
    return `${item.quantity}× ${nombre}${item.notes ? ` — ${item.notes}` : ""}`;
  });

  if (lineas.length <= MAX_LINEAS) return lineas.join("\n");
  return [...lineas.slice(0, MAX_LINEAS - 1), `+${lineas.length - (MAX_LINEAS - 1)} más`].join("\n");
}

export function obtenerFolio(id) {
  return `PED-${String(id).padStart(4, "0")}`;
}

export function aPedidoCocina(orden, consultadoEn) {
  const principal = elegirProductoPrincipal(orden.items) || {};

  let estado = ESTADOS.PENDIENTE;
  if (orden.status === "EN_COCINA") {
    estado = orden.oven_started_at ? ESTADOS.COCINANDO : ESTADOS.PREPARACION;
  }

  return {
    id: orden.id,
    folio: obtenerFolio(orden.id),
    cliente: orden.customer_name || "Sin nombre",
    tipoPedido: TIPOS_PEDIDO[orden.order_type] || orden.order_type,
    tipo: principal.product_name || "Pedido",
    imagen: claveImagen(principal.product_name),
    especificaciones: describirProductos(orden.items),
    estado,
    // Se calcula con el tiempo que reporta el servidor para no depender del reloj de la tablet
    inicioCocina:
      orden.oven_elapsed_seconds === null || orden.oven_elapsed_seconds === undefined
        ? null
        : consultadoEn - orden.oven_elapsed_seconds * 1000,
    estimadoMinutos: orden.estimated_minutes,
    finEstimado:
      orden.remaining_seconds === null || orden.remaining_seconds === undefined
        ? null
        : consultadoEn + orden.remaining_seconds * 1000,
  };
}

// ============================================
// ENDPOINTS DE COCINA
// ============================================

export async function obtenerPedidos() {
  const consultadoEn = Date.now();
  const ordenes = await peticion("/kitchen/orders");
  if (!Array.isArray(ordenes)) {
    throw new Error("Respuesta inesperada del servidor.");
  }
  return ordenes.map((orden) => aPedidoCocina(orden, consultadoEn));
}

export const tomarPedido = (id, minutos) =>
  peticion(`/kitchen/orders/${id}/start`, {
    method: "PATCH",
    body: JSON.stringify({ estimated_minutes: minutos }),
  });

export const meterAlHorno = (id) => peticion(`/kitchen/orders/${id}/oven`, { method: "PATCH" });

export const marcarListo = (id) => peticion(`/kitchen/orders/${id}/ready`, { method: "PATCH" });

export const regresarPedido = (id) => peticion(`/kitchen/orders/${id}/back`, { method: "PATCH" });
