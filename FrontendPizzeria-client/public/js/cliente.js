const $ = id => document.getElementById(id);
const API = '/api/v1';
const dinero = amount => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(amount) || 0);

let menu = [];
let carrito = {};
let customer = null;
let vistaActual = 'menu';
let rastreoInterval = null;
let pedidoRastreado = null;

async function api(route, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${route}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Comprueba que el backend esté encendido.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error del servidor (${response.status}).`);
  return data;
}

function escapar(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

// Ilustración decorativa para las dos pizzas del catálogo central.
const PUNTOS = [[100, 52], [142, 76], [150, 118], [120, 150], [78, 150], [50, 118], [58, 76], [100, 100], [124, 100], [76, 100]];
const FORMAS = {
  c: (p, fill, stroke) => `<circle cx="${p[0]}" cy="${p[1]}" r="11" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`,
  r: (p, fill, stroke) => `<rect x="${p[0] - 8}" y="${p[1] - 8}" width="16" height="16" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`,
  t: (p, fill, stroke) => `<path d="M${p[0] - 9} ${p[1] + 8}l9-16 9 16z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`,
  o: (p, fill) => `<circle cx="${p[0]}" cy="${p[1]}" r="8" fill="none" stroke="${fill}" stroke-width="4"/>`,
  e: (p, fill, stroke) => `<ellipse cx="${p[0]}" cy="${p[1]}" rx="12" ry="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
};
const RECETAS = {
  1: [['c', '#c0392b', '#922b21'], ['e', '#fff6dc', '#e8d9a8']],
  2: [['r', '#f29a9a', '#d96b6b'], ['t', '#f7d44c', '#d4a017'], ['e', '#fff6dc', '#e8d9a8']]
};

function pizzaSVG(id) {
  const recipe = RECETAS[id] || RECETAS[1];
  const toppings = PUNTOS.map((point, index) => {
    const [shape, fill, stroke] = recipe[index % recipe.length];
    return FORMAS[shape](point, fill, stroke);
  }).join('');
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
    <circle cx="100" cy="100" r="94" fill="#e3a857" stroke="#b9772e" stroke-width="4"/>
    <circle cx="100" cy="100" r="80" fill="#d9432b"/><circle cx="100" cy="100" r="74" fill="#f8c24a"/>
    ${toppings}<path d="M100 26V174M26 100H174M48 48L152 152M152 48L48 152" stroke="#d89b1f" stroke-width="2" opacity=".55"/>
  </svg>`;
}

function imagenProducto(product) {
  if (Number(product.id) === 3 || /refresco|bebida/i.test(product.name)) {
    return '<div class="producto-icono" aria-hidden="true">🥤</div>';
  }
  return `<div class="foto-pizza"><div class="plato">${pizzaSVG(Number(product.id))}</div></div>`;
}

function calcular() {
  const subtotal = menu.reduce((sum, product) => sum + Number(product.base_price) * (carrito[product.id] || 0), 0);
  const cantidad = Object.values(carrito).reduce((sum, value) => sum + value, 0);
  return { subtotal, cantidad };
}

function mostrar(view) {
  vistaActual = view;
  document.querySelectorAll('.vista').forEach(section => { section.hidden = section.id !== `vista-${view}`; });
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('activa', tab.dataset.vista === view));
  if (view === 'carrito') pintarTicket();
  if (view !== 'estado') detenerRastreo();
  actualizarBarra();
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-vista]').forEach(button => {
  button.addEventListener('click', () => mostrar(button.dataset.vista));
});

// Catálogo y precios siempre provienen del backend central, no de arreglos locales.
async function cargarMenu() {
  try {
    const products = await api('/products');
    menu = Array.isArray(products) ? products : [];
    pintarMenu();
    actualizarBarra();
    $('mensajeMenu').hidden = menu.length > 0;
    $('mensajeMenu').textContent = menu.length ? '' : 'No hay productos disponibles en este momento.';
  } catch (error) {
    $('mensajeMenu').textContent = error.message;
    $('mensajeMenu').hidden = false;
  }
}

function pintarMenu() {
  $('menu').innerHTML = menu.map(product => {
    const quantity = carrito[product.id] || 0;
    return `<article class="card-pizza">
      ${imagenProducto(product)}
      <h3>${escapar(product.name)}</h3>
      <p class="ingredientes">${escapar(product.description || 'Producto disponible')}</p>
      <div class="precio-btn">
        <span class="precio-tag">${dinero(product.base_price)}</span>
        <div class="ctrl">
          ${quantity ? `<button class="btn-redondo" type="button" data-restar="${product.id}" aria-label="Quitar uno">−</button>` : ''}
          <button class="btn-agregar" type="button" data-agregar="${product.id}">Agregar</button>
        </div>
      </div>
      ${quantity ? `<p class="cantidad-seleccionada">En tu ticket: ${quantity}</p>` : ''}
    </article>`;
  }).join('');
}

function cambiarCarrito(id, delta) {
  const current = carrito[id] || 0;
  const next = Math.max(0, Math.min(99, current + delta));
  if (next) carrito[id] = next;
  else delete carrito[id];
  pintarMenu();
  actualizarBarra();
  if (vistaActual === 'carrito') pintarTicket();
}

$('menu').addEventListener('click', event => {
  const add = event.target.closest('[data-agregar]');
  const remove = event.target.closest('[data-restar]');
  if (add) cambiarCarrito(Number(add.dataset.agregar), 1);
  if (remove) cambiarCarrito(Number(remove.dataset.restar), -1);
});

$('resumen').addEventListener('click', event => {
  const add = event.target.closest('[data-agregar]');
  const remove = event.target.closest('[data-restar]');
  if (add) cambiarCarrito(Number(add.dataset.agregar), 1);
  if (remove) cambiarCarrito(Number(remove.dataset.restar), -1);
});

function actualizarBarra() {
  const { subtotal, cantidad } = calcular();
  $('contador').textContent = cantidad;
  $('barraCant').textContent = cantidad;
  $('barraTotal').textContent = dinero(subtotal);
  $('carritoBarra').hidden = cantidad === 0 || vistaActual !== 'menu';
}

function pintarTicket() {
  const items = menu.filter(product => carrito[product.id]);
  $('resumen').innerHTML = items.length ? items.map(product => `
    <li class="linea">
      <div class="mini">${Number(product.id) === 3 ? '🥤' : pizzaSVG(Number(product.id))}</div>
      <div><strong>${escapar(product.name)}</strong><small>${dinero(product.base_price)} c/u</small></div>
      <div class="stepper">
        <button class="btn-redondo" type="button" data-restar="${product.id}" aria-label="Quitar uno">−</button>
        <b>${carrito[product.id]}</b>
        <button class="btn-redondo" type="button" data-agregar="${product.id}" aria-label="Agregar uno">+</button>
      </div>
      <span class="linea-precio">${dinero(Number(product.base_price) * carrito[product.id])}</span>
    </li>`).join('') : '<li class="vacio">Tu ticket está vacío. Agrega productos desde el menú.</li>';
  $('total-final').textContent = dinero(calcular().subtotal);
  $('clienteNoSesion').hidden = Boolean(customer);
  $('datosCliente').hidden = !customer;
}

function actualizarCuenta() {
  $('btnCuenta').hidden = Boolean(customer);
  $('btnSalir').hidden = !customer;
  $('nombreSesion').hidden = !customer;
  $('nombreSesion').textContent = customer ? `Hola, ${customer.name}` : '';
  $('clienteNoSesion').hidden = Boolean(customer);
  $('datosCliente').hidden = !customer;
  if (customer) {
    $('clienteNombre').textContent = customer.name;
    $('clienteTelefono').textContent = customer.phone;
  }
  if (vistaActual === 'carrito') pintarTicket();
}

function abrirCuenta(tab = 'login') {
  cambiarTabCuenta(tab);
  if (!$('dialogCuenta').open) $('dialogCuenta').showModal();
}

function cambiarTabCuenta(tab) {
  const login = tab === 'login';
  $('formLogin').hidden = !login;
  $('formRegistro').hidden = login;
  $('tabLogin').classList.toggle('activa', login);
  $('tabRegistro').classList.toggle('activa', !login);
  $('errorLogin').hidden = true;
  $('errorRegistro').hidden = true;
}

$('btnCuenta').addEventListener('click', () => abrirCuenta('login'));
$('btnAbrirCuenta').addEventListener('click', () => abrirCuenta('login'));
$('btnCerrarCuenta').addEventListener('click', () => $('dialogCuenta').close());
$('tabLogin').addEventListener('click', () => cambiarTabCuenta('login'));
$('tabRegistro').addEventListener('click', () => cambiarTabCuenta('registro'));

async function cargarSesion() {
  try {
    const data = await api('/auth/me');
    customer = data.customer;
  } catch (error) {
    if (!error.message.includes('Inicia sesión') && !error.message.includes('Tu sesión venció')) {
      console.warn(error.message);
    }
    customer = null;
  }
  actualizarCuenta();
}

$('formLogin').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('btnLogin');
  button.disabled = true;
  $('errorLogin').hidden = true;
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('loginEmail').value.trim(), password: $('loginPassword').value })
    });
    customer = data.customer;
    $('formLogin').reset();
    $('dialogCuenta').close();
    actualizarCuenta();
  } catch (error) {
    $('errorLogin').textContent = error.message;
    $('errorLogin').hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('formRegistro').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('btnRegistro');
  button.disabled = true;
  $('errorRegistro').hidden = true;
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('registroNombre').value.trim(),
        email: $('registroEmail').value.trim(),
        phone: $('registroTelefono').value.trim(),
        password: $('registroPassword').value
      })
    });
    customer = data.customer;
    $('formRegistro').reset();
    $('dialogCuenta').close();
    actualizarCuenta();
  } catch (error) {
    $('errorRegistro').textContent = error.message;
    $('errorRegistro').hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('btnSalir').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch (error) { console.warn(error.message); }
  customer = null;
  detenerRastreo();
  actualizarCuenta();
  if (vistaActual === 'estado') {
    $('infoPedidoBox').hidden = true;
    mostrarErrorRastreo('Inicia sesión para consultar tus pedidos.');
  }
});

$('tipoPedido').addEventListener('change', () => {
  const isDelivery = $('tipoPedido').value === 'DOMICILIO';
  $('grupoDireccion').hidden = !isDelivery;
  $('direccionEntrega').required = isDelivery;
});

function mostrarProcesando(show, message = 'Enviando pedido...') {
  $('modalTexto').textContent = message;
  $('modalProcesando').hidden = !show;
}

// El cliente envía IDs y cantidades; el backend comprueba precios y calcula el total con MySQL.
$('formPedido').addEventListener('submit', async event => {
  event.preventDefault();
  $('errorPedido').hidden = true;
  if (!customer) return abrirCuenta('login');
  const { cantidad } = calcular();
  if (!cantidad) {
    $('errorPedido').textContent = 'Agrega al menos un producto al ticket.';
    $('errorPedido').hidden = false;
    return;
  }
  const orderType = $('tipoPedido').value;
  const address = $('direccionEntrega').value.trim();
  if (orderType === 'DOMICILIO' && !address) {
    $('errorPedido').textContent = 'Escribe la dirección de entrega.';
    $('errorPedido').hidden = false;
    return;
  }

  const button = $('btnPagar');
  button.disabled = true;
  mostrarProcesando(true);
  try {
    const data = await api('/customer/orders', {
      method: 'POST',
      body: JSON.stringify({
        order_type: orderType,
        delivery_address: orderType === 'DOMICILIO' ? address : null,
        payment_method: $('metodoPago').value,
        items: Object.entries(carrito).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({
          product_id: Number(productId), quantity
        }))
      })
    });
    carrito = {};
    $('formPedido').reset();
    $('grupoDireccion').hidden = true;
    $('direccionEntrega').required = false;
    pintarMenu();
    actualizarBarra();
    pintarTicket();
    mostrarProcesando(false);
    $('folioBuscar').value = `PED-${String(data.order_id).padStart(4, '0')}`;
    mostrar('estado');
    await iniciarRastreo($('folioBuscar').value);
  } catch (error) {
    mostrarProcesando(false);
    $('errorPedido').textContent = error.message;
    $('errorPedido').hidden = false;
    if (error.message.toLowerCase().includes('sesión')) abrirCuenta('login');
  } finally {
    button.disabled = false;
  }
});

function detenerRastreo() {
  if (rastreoInterval) clearInterval(rastreoInterval);
  rastreoInterval = null;
}

function mostrarErrorRastreo(message) {
  $('msgEstadoError').textContent = message;
  $('msgEstadoError').hidden = false;
}

function obtenerIdDesdeFolio(value) {
  const normalized = String(value || '').trim().toUpperCase();
  const match = normalized.match(/^(?:PED-)?0*(\d+)$/);
  return match ? Number(match[1]) : null;
}

function formatoFecha(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

function dibujarEstado(order) {
  const states = {
    REGISTRADO: { progress: 15, active: 1, text: 'Tu pedido fue recibido y está esperando a cocina.' },
    EN_COCINA: order.oven_started_at
      ? { progress: 65, active: 2, text: 'Tu pizza está en el horno.' }
      : { progress: 42, active: 2, text: 'Cocina está preparando tu pedido.' },
    LISTO: { progress: 82, active: 3, text: 'Tu pedido está listo.' },
    EN_REPARTO: { progress: 92, active: 3, text: 'Tu pedido está en camino.' },
    COMPLETADO: { progress: 100, active: 3, text: 'El pedido fue entregado.' },
    CANCELADO: { progress: 0, active: 0, text: 'Este pedido fue cancelado.' }
  };
  const state = states[order.status] || { progress: 0, active: 0, text: 'Estado no disponible.' };
  const items = (order.items || []).map(item => `${item.quantity}× ${item.product_name}`).join(', ');
  $('estadoFolio').textContent = `PED-${String(order.id).padStart(4, '0')}`;
  $('estadoCliente').textContent = order.status.replaceAll('_', ' ');
  $('estadoDetalle').textContent = `${state.text} Total: ${dinero(order.total_amount)}. ${items ? `Productos: ${items}. ` : ''}${formatoFecha(order.created_at) ? `Registrado: ${formatoFecha(order.created_at)}.` : ''}`;
  $('barra').style.width = `${state.progress}%`;
  document.querySelectorAll('#pasos .paso').forEach((step, index) => step.classList.toggle('activo', index < state.active));
  $('estadoCliente').classList.toggle('estado-cancelado', order.status === 'CANCELADO');
  $('estadoCliente').classList.toggle('estado-completado', order.status === 'COMPLETADO');
}

async function consultarPedido(id, showError = true) {
  try {
    const order = await api(`/customer/orders/${id}`);
    pedidoRastreado = order;
    $('infoPedidoBox').hidden = false;
    $('msgEstadoError').hidden = true;
    dibujarEstado(order);
    if (['COMPLETADO', 'CANCELADO'].includes(order.status)) detenerRastreo();
  } catch (error) {
    if (showError) {
      $('infoPedidoBox').hidden = true;
      mostrarErrorRastreo(error.message);
    }
    if (error.message.toLowerCase().includes('sesión')) abrirCuenta('login');
  }
}

async function iniciarRastreo(folio) {
  detenerRastreo();
  $('msgEstadoError').hidden = true;
  $('infoPedidoBox').hidden = true;
  if (!customer) {
    mostrarErrorRastreo('Inicia sesión con la cuenta que realizó el pedido.');
    return;
  }
  const id = obtenerIdDesdeFolio(folio);
  if (!id) {
    mostrarErrorRastreo('Escribe un folio válido, por ejemplo PED-0001.');
    return;
  }
  await consultarPedido(id, true);
  if (!$('infoPedidoBox').hidden && !['COMPLETADO', 'CANCELADO'].includes(pedidoRastreado?.status)) {
    rastreoInterval = setInterval(() => consultarPedido(id, false), 5000);
  }
}

$('formRastreo').addEventListener('submit', event => {
  event.preventDefault();
  iniciarRastreo($('folioBuscar').value);
});

// Arranque: valida la sesión y carga el catálogo central antes de permitir pedidos.
(async function iniciar() {
  await Promise.all([cargarSesion(), cargarMenu()]);
  actualizarCuenta();
  pintarTicket();
})();
