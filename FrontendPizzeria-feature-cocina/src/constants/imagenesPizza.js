import champinones from "../assets/pizzaChampinones.png";
import especias from "../assets/pizzaEspecias.png";
import peperoni from "../assets/pizzaPeperoni.png";
import queso from "../assets/pizzaQueso.png";

// La llave es el "tipo" de pizza que viene en el pedido
export const IMAGENES_PIZZA = {
  Champiñones: champinones,
  Especias: especias,
  Pepperoni: peperoni,
  Queso: queso,
};

// Imagen que se usa si llega un tipo que no existe en la lista
export const IMAGEN_POR_DEFECTO = queso;