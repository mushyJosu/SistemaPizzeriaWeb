// ============================================
// CONFIGURACIÓN
// ============================================

const API_URL = location.protocol === "file:" ? "http://localhost:3000/api/v1" : "/api/v1";
const INTERVALO_ACTUALIZACION = 10000; // 10 segundos

let pedidos = [];
let productos = [];
let cargandoPedidos = false;

// ============================================
// ELEMENTOS DEL HTML
// ============================================

const tablaPedidos = document.getElementById("tablaPedidos");
const buscarPedido = document.getElementById("buscarPedido");
const filtroEstado = document.getElementById("filtroEstado");
const mensajeVacio = document.getElementById("mensajeVacio");
const estadoConexion = document.getElementById("estadoConexion");
const ultimaActualizacion = document.getElementById("ultimaActualizacion");

const dialogNuevoPedido = document.getElementById("dialogNuevoPedido");
const formNuevoPedido = document.getElementById("formNuevoPedido");
const tipoPedido = document.getElementById("tipoPedido");
const campoDireccion = document.getElementById("campoDireccion");
const direccionEntrega = document.getElementById("direccionEntrega");
const telefonoCliente = document.getElementById("telefonoCliente");
const telefonoOpcional = document.getElementById("telefonoOpcional");
const listaItems = document.getElementById("listaItems");
const plantillaItem = document.getElementById("plantillaItem");
const totalPedido = document.getElementById("totalPedido");
const errorFormulario = document.getElementById("errorFormulario");

const btnNuevoPedido = document.getElementById("btnNuevoPedido");
const btnCerrarDialogo = document.getElementById("btnCerrarDialogo");
const btnCancelar = document.getElementById("btnCancelar");
const btnAgregarItem = document.getElementById("btnAgregarItem");
const btnRegistrar = document.getElementById("btnRegistrar");

// ============================================
// COMUNICACIÓN CON LA API
// ============================================

async function api(ruta, opciones = {}) {
    let respuesta;

    try {
        respuesta = await fetch(`${API_URL}${ruta}`, {
            headers: { "Content-Type": "application/json" },
            ...opciones
        });
    } catch {
        throw new Error(
            "No se pudo conectar con el servidor. Verifica que el backend esté encendido (node server.js)."
        );
    }

    const datos = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok) {
        throw new Error(datos.error || `Error del servidor (${respuesta.status}).`);
    }

    return datos;
}

function mostrarEstadoConexion(mensaje) {
    estadoConexion.textContent = mensaje || "";
    estadoConexion.hidden = !mensaje;
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

const ESTADOS = {
    REGISTRADO: { nombre: "Registrado", clase: "status-registrado" },
    EN_COCINA: { nombre: "En cocina", clase: "status-cocina" },
    LISTO: { nombre: "Listo", clase: "status-listo" },
    EN_REPARTO: { nombre: "En reparto", clase: "status-reparto" },
    COMPLETADO: { nombre: "Entregado", clase: "status-entregado" },
    CANCELADO: { nombre: "Cancelado", clase: "status-cancelado" }
};

const TIPOS_PEDIDO = {
    LOCAL: "En el local",
    PARA_LLEVAR: "Para llevar",
    DOMICILIO: "A domicilio"
};

const formatoMoneda = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
});

function obtenerFolio(id) {
    return `PED-${String(id).padStart(4, "0")}`;
}

function formatearHora(fecha) {
    return new Date(fecha).toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
}

function obtenerTiempoTranscurrido(fecha) {
    const minutos = Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 60000));

    if (minutos < 1) return "menos de 1 min";
    if (minutos < 60) return `${minutos} min`;

    const horas = Math.floor(minutos / 60);
    const resto = String(minutos % 60).padStart(2, "0");
    return `${horas} h ${resto} min`;
}

// Tiempo restante según el estimado que capturó cocina.
// El backend envía remaining_seconds al momento de la consulta; se descuenta lo que pasó desde entonces.
function obtenerTiempoRestante(pedido) {
    switch (pedido.status) {
        case "REGISTRADO":
            return { texto: "Esperando cocina" };
        case "LISTO":
            return { texto: "Listo" };
        case "EN_REPARTO":
            return { texto: "En reparto" };
        case "EN_COCINA":
            break;
        default:
            return { texto: "—" };
    }

    if (pedido.remaining_seconds === null || pedido.remaining_seconds === undefined) {
        return { texto: "Sin estimado" };
    }

    const segundos = pedido.remaining_seconds - (Date.now() - pedido.consultadoEn) / 1000;
    const minutos = Math.ceil(Math.abs(segundos) / 60);

    if (segundos >= 0) {
        return { texto: minutos <= 1 ? "Menos de 1 min" : `${minutos} min` };
    }
    return { texto: `Retrasado ${minutos} min`, clase: "time-late" };
}

function describirItems(pedido) {
    return pedido.items
        .map(item => `${item.quantity}× ${item.product_name || "Producto eliminado"}`)
        .join(", ");
}

function crearCelda(texto, clase = "") {
    const celda = document.createElement("td");

    // textContent evita interpretar el contenido como HTML.
    celda.textContent = texto;

    if (clase) {
        celda.className = clase;
    }

    return celda;
}

function actualizarResumen() {
    const contar = (...estados) =>
        pedidos.filter(pedido => estados.includes(pedido.status)).length;

    document.getElementById("totalPedidos").textContent = pedidos.length;
    document.getElementById("pedidosRegistrados").textContent = contar("REGISTRADO");
    document.getElementById("pedidosCocina").textContent = contar("EN_COCINA");
    document.getElementById("pedidosListos").textContent = contar("LISTO", "EN_REPARTO");
}

// Acción disponible para recepción según el estado y tipo del pedido
function obtenerAccion(pedido) {
    switch (pedido.status) {
        case "REGISTRADO":
            return {
                texto: "Cancelar",
                siguiente: "CANCELADO",
                peligro: true,
                pregunta: "¿Seguro que quieres cancelar el pedido"
            };
        case "LISTO":
            if (pedido.order_type === "DOMICILIO") {
                return {
                    texto: "Enviar a reparto",
                    siguiente: "EN_REPARTO",
                    pregunta: "¿Confirmas que salió a reparto el pedido"
                };
            }
            return {
                texto: "Confirmar entrega",
                siguiente: "COMPLETADO",
                pregunta: "¿Confirmas que se entregó el pedido"
            };
        case "EN_REPARTO":
            return {
                texto: "Confirmar entrega",
                siguiente: "COMPLETADO",
                pregunta: "¿Confirmas que se entregó el pedido"
            };
        default:
            return { texto: "En cocina", deshabilitado: true };
    }
}

// ============================================
// MOSTRAR Y FILTRAR PEDIDOS
// ============================================

function coincideConBusqueda(pedido, busqueda) {
    if (!busqueda) return true;

    const textoBusqueda = busqueda.replace(/^#/, "");
    const productosTexto = pedido.items
        .map(item => `${item.product_name || ""} ${item.notes || ""}`)
        .join(" ")
        .toLowerCase();

    return (
        obtenerFolio(pedido.id).toLowerCase().includes(textoBusqueda) ||
        String(pedido.id) === textoBusqueda ||
        (pedido.customer_name || "").toLowerCase().includes(textoBusqueda) ||
        productosTexto.includes(textoBusqueda)
    );
}

function renderizarPedidos() {
    const busqueda = buscarPedido.value.trim().toLowerCase();
    const estadoSeleccionado = filtroEstado.value;

    const pedidosFiltrados = pedidos.filter(pedido =>
        coincideConBusqueda(pedido, busqueda) &&
        (estadoSeleccionado === "TODOS" || pedido.status === estadoSeleccionado)
    );

    tablaPedidos.replaceChildren();

    pedidosFiltrados.forEach(pedido => {
        const fila = document.createElement("tr");
        const estado = ESTADOS[pedido.status] || { nombre: pedido.status, clase: "" };

        fila.appendChild(crearCelda(`#${obtenerFolio(pedido.id)}`, "order-id"));

        // Cliente (con teléfono y dirección si existen)
        const celdaCliente = crearCelda(pedido.customer_name || "—");
        if (pedido.customer_phone) {
            const telefono = document.createElement("small");
            telefono.textContent = pedido.customer_phone;
            celdaCliente.appendChild(telefono);
        }
        fila.appendChild(celdaCliente);

        // Tipo de pedido
        const celdaTipo = crearCelda(TIPOS_PEDIDO[pedido.order_type] || pedido.order_type);
        if (pedido.order_type === "DOMICILIO" && pedido.delivery_address) {
            const direccion = document.createElement("small");
            direccion.textContent = pedido.delivery_address;
            celdaTipo.appendChild(direccion);
            celdaTipo.classList.add("cell-wrap");
        }
        fila.appendChild(celdaTipo);

        // Productos y notas
        const celdaPedido = crearCelda(describirItems(pedido), "cell-wrap");
        const notas = pedido.items.filter(item => item.notes);
        if (notas.length > 0) {
            const detalleNotas = document.createElement("small");
            detalleNotas.textContent = notas
                .map(item => `${item.product_name || "Producto"}: ${item.notes}`)
                .join(" · ");
            celdaPedido.appendChild(detalleNotas);
        }
        fila.appendChild(celdaPedido);

        fila.appendChild(crearCelda(formatoMoneda.format(pedido.total_amount)));
        // Hora de registro y tiempo transcurrido
        const celdaHora = crearCelda(formatearHora(pedido.created_at));
        const transcurrido = document.createElement("small");
        transcurrido.textContent = `hace ${obtenerTiempoTranscurrido(pedido.created_at)}`;
        celdaHora.appendChild(transcurrido);
        fila.appendChild(celdaHora);

        const restante = obtenerTiempoRestante(pedido);
        fila.appendChild(crearCelda(restante.texto, restante.clase || ""));

        // Estado
        const celdaEstado = document.createElement("td");
        const etiquetaEstado = document.createElement("span");
        etiquetaEstado.className = `status ${estado.clase}`;
        etiquetaEstado.textContent = estado.nombre;
        celdaEstado.appendChild(etiquetaEstado);
        fila.appendChild(celdaEstado);

        // Acción
        const accion = obtenerAccion(pedido);
        const celdaAccion = document.createElement("td");
        const botonAccion = document.createElement("button");

        botonAccion.type = "button";
        botonAccion.className = accion.peligro ? "btn-action btn-action-danger" : "btn-action";
        botonAccion.textContent = accion.texto;
        botonAccion.disabled = Boolean(accion.deshabilitado);

        if (!accion.deshabilitado) {
            botonAccion.addEventListener("click", () => {
                cambiarEstado(pedido, accion, botonAccion);
            });
        }

        celdaAccion.appendChild(botonAccion);
        fila.appendChild(celdaAccion);

        tablaPedidos.appendChild(fila);
    });

    mensajeVacio.hidden = pedidosFiltrados.length > 0;

    actualizarResumen();
}

async function cargarPedidos() {
    if (cargandoPedidos) return;
    cargandoPedidos = true;

    try {
        const consultadoEn = Date.now();
        pedidos = (await api("/orders/active")).map(pedido => ({ ...pedido, consultadoEn }));
        mostrarEstadoConexion("");
        ultimaActualizacion.textContent =
            `Actualizado: ${new Date().toLocaleTimeString("es-MX", { hour12: false })}`;
        renderizarPedidos();
    } catch (error) {
        mostrarEstadoConexion(error.message);
    } finally {
        cargandoPedidos = false;
    }
}

// ============================================
// CAMBIAR ESTADO (entregar, enviar a reparto, cancelar)
// ============================================

async function cambiarEstado(pedido, accion, boton) {
    const confirmar = window.confirm(`${accion.pregunta} ${obtenerFolio(pedido.id)}?`);

    if (!confirmar) {
        return;
    }

    boton.disabled = true;

    try {
        await api(`/orders/${pedido.id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: accion.siguiente })
        });
    } catch (error) {
        window.alert(error.message);
    }

    await cargarPedidos();
}

// ============================================
// FORMULARIO DE NUEVO PEDIDO
// ============================================

async function cargarProductos() {
    productos = await api("/products");
}

function llenarSelectProductos(select) {
    select.replaceChildren();

    const opcionVacia = document.createElement("option");
    opcionVacia.value = "";
    opcionVacia.textContent = "Selecciona un producto";
    select.appendChild(opcionVacia);

    productos.forEach(producto => {
        const opcion = document.createElement("option");
        opcion.value = producto.id;
        opcion.textContent = `${producto.name} — ${formatoMoneda.format(producto.base_price)}`;
        select.appendChild(opcion);
    });
}

function agregarItem() {
    const fila = plantillaItem.content.firstElementChild.cloneNode(true);

    llenarSelectProductos(fila.querySelector(".item-producto"));

    fila.querySelector(".btn-remove").addEventListener("click", () => {
        fila.remove();
        actualizarBotonesQuitar();
        calcularTotal();
    });

    listaItems.appendChild(fila);
    actualizarBotonesQuitar();
    calcularTotal();
}

// Siempre debe quedar al menos un renglón de producto
function actualizarBotonesQuitar() {
    const botones = listaItems.querySelectorAll(".btn-remove");
    botones.forEach(boton => {
        boton.disabled = botones.length === 1;
    });
}

function obtenerItemsFormulario() {
    return [...listaItems.querySelectorAll(".item-row")].map(fila => ({
        product_id: Number(fila.querySelector(".item-producto").value),
        quantity: Number(fila.querySelector(".item-cantidad").value),
        notes: fila.querySelector(".item-nota").value.trim() || null
    }));
}

// Total de referencia; el total definitivo lo calcula el backend
function calcularTotal() {
    const total = obtenerItemsFormulario().reduce((suma, item) => {
        const producto = productos.find(p => p.id === item.product_id);
        const cantidad = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
        return producto ? suma + producto.base_price * cantidad : suma;
    }, 0);

    totalPedido.textContent = formatoMoneda.format(total);
}

function actualizarCamposPorTipo() {
    const esDomicilio = tipoPedido.value === "DOMICILIO";

    campoDireccion.hidden = !esDomicilio;
    direccionEntrega.required = esDomicilio;
    telefonoCliente.required = esDomicilio;
    telefonoOpcional.hidden = esDomicilio;
}

function mostrarErrorFormulario(mensaje) {
    errorFormulario.textContent = mensaje || "";
    errorFormulario.hidden = !mensaje;
}

async function abrirFormulario() {
    try {
        await cargarProductos();
    } catch (error) {
        window.alert(error.message);
        return;
    }

    if (productos.length === 0) {
        window.alert("No hay productos disponibles en el menú.");
        return;
    }

    formNuevoPedido.reset();
    listaItems.replaceChildren();
    agregarItem();
    actualizarCamposPorTipo();
    mostrarErrorFormulario("");
    btnRegistrar.disabled = false;

    dialogNuevoPedido.showModal();

    document.getElementById("nombreCliente").focus();
}

function cerrarFormulario() {
    dialogNuevoPedido.close();
}

function validarFormulario(datos) {
    if (!datos.customer_name) {
        return "Ingresa el nombre del cliente.";
    }
    if (datos.order_type === "DOMICILIO" && !datos.customer_phone) {
        return "Ingresa el teléfono del cliente para pedidos a domicilio.";
    }
    if (datos.order_type === "DOMICILIO" && !datos.delivery_address) {
        return "Ingresa la dirección de entrega.";
    }
    if (datos.items.some(item => !item.product_id)) {
        return "Selecciona un producto en cada renglón.";
    }
    if (datos.items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
        return "La cantidad de cada producto debe ser un número entero entre 1 y 99.";
    }
    return "";
}

btnNuevoPedido.addEventListener("click", abrirFormulario);
btnCerrarDialogo.addEventListener("click", cerrarFormulario);
btnCancelar.addEventListener("click", cerrarFormulario);
btnAgregarItem.addEventListener("click", agregarItem);
tipoPedido.addEventListener("change", actualizarCamposPorTipo);
listaItems.addEventListener("input", calcularTotal);
listaItems.addEventListener("change", calcularTotal);

// ============================================
// EVENTOS DE BÚSQUEDA Y FILTRADO
// ============================================

buscarPedido.addEventListener("input", renderizarPedidos);
filtroEstado.addEventListener("change", renderizarPedidos);

// ============================================
// REGISTRAR NUEVO PEDIDO
// ============================================

formNuevoPedido.addEventListener("submit", async event => {
    event.preventDefault();

    const esDomicilio = tipoPedido.value === "DOMICILIO";

    const datos = {
        order_type: tipoPedido.value,
        customer_name: document.getElementById("nombreCliente").value.trim(),
        customer_phone: telefonoCliente.value.trim() || null,
        delivery_address: esDomicilio ? direccionEntrega.value.trim() : null,
        payment_method: document.getElementById("metodoPago").value,
        items: obtenerItemsFormulario()
    };

    const error = validarFormulario(datos);
    if (error) {
        mostrarErrorFormulario(error);
        return;
    }

    mostrarErrorFormulario("");
    btnRegistrar.disabled = true;

    try {
        const respuesta = await api("/orders", {
            method: "POST",
            body: JSON.stringify(datos)
        });

        cerrarFormulario();
        await cargarPedidos();
        window.alert(`Pedido ${obtenerFolio(respuesta.order_id)} registrado. Total: ${formatoMoneda.format(respuesta.total_amount)}`);
    } catch (error) {
        mostrarErrorFormulario(error.message);
        btnRegistrar.disabled = false;
    }
});

// ============================================
// INICIALIZAR MÓDULO
// ============================================

cargarPedidos();
setInterval(cargarPedidos, INTERVALO_ACTUALIZACION);
