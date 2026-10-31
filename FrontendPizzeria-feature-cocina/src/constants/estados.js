export const ESTADOS = {
  PENDIENTE: "pendiente",     // llegó de recepción, sin tomar
  PREPARACION: "preparacion", // azul
  COCINANDO: "cocinando",     // rojo
};

// Orden del flujo: deslizar arriba avanza, abajo retrocede
export const ORDEN_ESTADOS = [
  ESTADOS.PENDIENTE,
  ESTADOS.PREPARACION,
  ESTADOS.COCINANDO,
];

export const ETIQUETAS = {
  [ESTADOS.PENDIENTE]: "Pedido sin tomar",
  [ESTADOS.PREPARACION]: "Preparación",
  [ESTADOS.COCINANDO]: "Cocinando",
};