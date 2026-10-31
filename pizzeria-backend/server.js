// Backend central del sprint: comparte menú, pedidos y estados entre los tres módulos.
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');

// Configuración local opcional desde pizzeria-backend/.env (sin librerías adicionales).
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && process.env[match[1]] === undefined) {
            process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
        }
    }
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const COOKIE_NAME = 'bp_session';
const SESSION_DAYS = 7;
const isProduction = process.env.NODE_ENV === 'production';
app.use(express.json({ limit: '1mb' }));
app.use(cors());

// Conexión MySQL; las credenciales se configuran en .env y no se guardan en el código.
const db = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pizzeria_db',
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: true
});

const MIGRATION_HINT = 'Faltan columnas/tablas del esquema integrado. Ejecuta database/instalacion.sql o las migraciones indicadas en README.md.';
const ORDER_TYPES = ['LOCAL', 'PARA_LLEVAR', 'DOMICILIO'];
const PAYMENT_METHODS = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'];
const STATUSES = ['REGISTRADO', 'EN_COCINA', 'LISTO', 'EN_REPARTO', 'COMPLETADO', 'CANCELADO'];
const scryptAsync = promisify(crypto.scrypt);

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function describeDbError(err) {
    const errors = Array.isArray(err.errors) && err.errors.length ? err.errors : [err];
    const detail = errors.map(e => [e.code, e.address ? `${e.address}:${e.port}` : (e.sqlMessage || e.message)].filter(Boolean).join(' ')).join(' | ');
    const hints = {
        ECONNREFUSED: 'MySQL no está encendido o escucha en otro puerto.',
        ER_ACCESS_DENIED_ERROR: 'Usuario o contraseña de MySQL incorrectos; revisa pizzeria-backend/.env.',
        ER_BAD_DB_ERROR: 'La base de datos pizzeria_db no existe; ejecuta database/instalacion.sql.'
    };
    return `${detail}${hints[errors[0].code] ? `\n  → ${hints[errors[0].code]}` : ''}`;
}

function cleanText(value, maxLength) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (text.length > maxLength) throw new HttpError(400, `El texto excede ${maxLength} caracteres.`);
    return text;
}

function parseOrderId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID de pedido inválido.');
    return id;
}

function validateOrder(body) {
    const { order_type, payment_method, items } = body || {};
    if (!ORDER_TYPES.includes(order_type)) throw new HttpError(400, `order_type debe ser uno de: ${ORDER_TYPES.join(', ')}.`);

    const customer_name = cleanText(body.customer_name, 100);
    if (!customer_name) throw new HttpError(400, 'El nombre del cliente es obligatorio.');

    const customer_phone = cleanText(body.customer_phone, 20);
    const delivery_address = order_type === 'DOMICILIO' ? cleanText(body.delivery_address, 255) : null;
    if (order_type === 'DOMICILIO' && !delivery_address) throw new HttpError(400, 'La dirección es obligatoria para pedidos a domicilio.');
    if (order_type === 'DOMICILIO' && !customer_phone) throw new HttpError(400, 'El teléfono es obligatorio para pedidos a domicilio.');
    if (payment_method !== undefined && payment_method !== null && !PAYMENT_METHODS.includes(payment_method)) {
        throw new HttpError(400, `payment_method debe ser uno de: ${PAYMENT_METHODS.join(', ')}.`);
    }
    if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'El pedido debe incluir al menos un producto.');

    const cleanItems = items.map(item => {
        const product_id = Number(item && item.product_id);
        const quantity = Number(item && item.quantity);
        if (!Number.isInteger(product_id) || product_id <= 0) throw new HttpError(400, 'Hay un producto con product_id inválido.');
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new HttpError(400, 'La cantidad de cada producto debe ser un entero entre 1 y 99.');
        return { product_id, quantity, notes: cleanText(item.notes, 255) };
    });

    return { order_type, customer_name, customer_phone, delivery_address, payment_method: payment_method || null, items: cleanItems };
}

// Las contraseñas se almacenan como hash scrypt con salt aleatorio; no se pueden recuperar en texto plano.
async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derived = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return `scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltHex, hashHex] = parts;
    if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length, {
        N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function readCookie(req, name) {
    const raw = req.headers.cookie || '';
    for (const entry of raw.split(';')) {
        const index = entry.indexOf('=');
        if (index < 0) continue;
        if (entry.slice(0, index).trim() === name) return decodeURIComponent(entry.slice(index + 1).trim());
    }
    return null;
}

function setSessionCookie(res, token) {
    const secure = isProduction ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`);
}

function clearSessionCookie(res) {
    const secure = isProduction ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

async function createCustomerSession(customerId, res) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.execute(
        `INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${SESSION_DAYS} DAY))`,
        [hashSessionToken(token), customerId]
    );
    setSessionCookie(res, token);
}

// Middleware de sesión para las rutas privadas del cliente.
async function requireCustomer(req, res, next) {
    try {
        const token = readCookie(req, COOKIE_NAME);
        if (!token) throw new HttpError(401, 'Inicia sesión para continuar.');
        const [rows] = await db.execute(
            `SELECT c.id, c.name, c.email, c.phone
             FROM customer_sessions s
             INNER JOIN customers c ON c.id = s.customer_id
             WHERE s.token_hash = ? AND s.expires_at > NOW()
             LIMIT 1`,
            [hashSessionToken(token)]
        );
        if (!rows.length) {
            clearSessionCookie(res);
            throw new HttpError(401, 'Tu sesión venció. Inicia sesión nuevamente.');
        }
        req.customer = rows[0];
        next();
    } catch (error) {
        next(error);
    }
}

// Reglas para el flujo compartido de pedidos.
function isValidTransition(order, nextStatus) {
    const isDelivery = order.order_type === 'DOMICILIO';
    switch (order.status) {
        case 'REGISTRADO': return nextStatus === 'EN_COCINA' || nextStatus === 'CANCELADO';
        case 'EN_COCINA': return nextStatus === 'LISTO';
        case 'LISTO': return isDelivery ? nextStatus === 'EN_REPARTO' : nextStatus === 'COMPLETADO';
        case 'EN_REPARTO': return nextStatus === 'COMPLETADO';
        default: return false;
    }
}

async function createOrder(order, customerId = null) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const productIds = [...new Set(order.items.map(item => item.product_id))];
        const [products] = await conn.query(
            'SELECT id, base_price FROM products WHERE id IN (?) AND available = TRUE',
            [productIds]
        );
        const prices = new Map(products.map(product => [product.id, Number(product.base_price)]));
        const missing = productIds.filter(id => !prices.has(id));
        if (missing.length) throw new HttpError(400, `Productos inexistentes o no disponibles: ${missing.join(', ')}.`);

        const itemsValues = order.items.map(item => {
            const unitPrice = prices.get(item.product_id);
            const subtotal = Math.round(unitPrice * item.quantity * 100) / 100;
            return [item.product_id, item.quantity, unitPrice, subtotal, item.notes];
        });
        const total = Math.round(itemsValues.reduce((sum, item) => sum + item[3], 0) * 100) / 100;

        const [result] = await conn.query(
            `INSERT INTO orders (customer_id, order_type, customer_name, customer_phone, delivery_address, payment_method, total_amount)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [customerId, order.order_type, order.customer_name, order.customer_phone, order.delivery_address, order.payment_method, total]
        );
        const orderId = result.insertId;
        await conn.query(
            'INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, notes) VALUES ?',
            [itemsValues.map(item => [orderId, ...item])]
        );
        await conn.commit();
        return { message: 'Pedido creado con éxito', order_id: orderId, folio: `PED-${String(orderId).padStart(4, '0')}`, total_amount: total };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function fetchOrdersWithItems(whereSql, orderSql) {
    const [orders] = await db.query(`
        SELECT o.*,
               CASE WHEN o.status = 'EN_COCINA' AND o.estimated_minutes IS NOT NULL
                    THEN TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(o.kitchen_started_at, INTERVAL o.estimated_minutes MINUTE)) END AS remaining_seconds,
               CASE WHEN o.status = 'EN_COCINA' AND o.oven_started_at IS NOT NULL
                    THEN TIMESTAMPDIFF(SECOND, o.oven_started_at, NOW()) END AS oven_elapsed_seconds
        FROM orders o WHERE ${whereSql} ORDER BY ${orderSql}`);
    if (!orders.length) return [];

    const [items] = await db.query(`
        SELECT oi.id, oi.order_id, oi.product_id, p.name AS product_name,
               oi.quantity, oi.unit_price, oi.subtotal, oi.notes
        FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id IN (?) ORDER BY oi.id`, [orders.map(order => order.id)]);
    const byOrder = new Map();
    for (const item of items) {
        if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
        byOrder.get(item.order_id).push(item);
    }
    return orders.map(order => ({ ...order, items: byOrder.get(order.id) || [] }));
}

async function changeOrderStatus(id, nextStatus, { allowedFrom = null, estimatedMinutes = null } = {}) {
    const [rows] = await db.query('SELECT id, status, order_type FROM orders WHERE id = ?', [id]);
    if (!rows.length) throw new HttpError(404, 'Pedido no encontrado');
    const order = rows[0];
    if ((allowedFrom && !allowedFrom.includes(order.status)) || !isValidTransition(order, nextStatus)) {
        throw new HttpError(409, `No se puede cambiar el pedido #${id} de ${order.status} a ${nextStatus}.`);
    }
    const sets = ['status = ?'];
    const values = [nextStatus];
    if (nextStatus === 'EN_COCINA') sets.push('kitchen_started_at = NOW()', 'oven_started_at = NULL', 'estimated_minutes = ?'), values.push(estimatedMinutes);
    if (nextStatus === 'LISTO') sets.push('ready_at = NOW()');
    const [result] = await db.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND status = ?`, [...values, id, order.status]);
    if (!result.affectedRows) throw new HttpError(409, 'El pedido cambió de estado mientras tanto. Actualiza e intenta de nuevo.');
    return { message: `Estado del pedido #${id} actualizado a ${nextStatus}` };
}

function parseEstimatedMinutes(value, required) {
    if (value === undefined || value === null || value === '') {
        if (required) throw new HttpError(400, 'estimated_minutes es obligatorio (minutos de preparación).');
        return null;
    }
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new HttpError(400, 'estimated_minutes debe ser un entero entre 1 y 240.');
    return minutes;
}

async function kitchenUpdate(id, sql, params, conflictMessage) {
    const [result] = await db.query(sql, params);
    if (result.affectedRows) return;
    const [rows] = await db.query('SELECT id FROM orders WHERE id = ?', [id]);
    if (!rows.length) throw new HttpError(404, 'Pedido no encontrado');
    throw new HttpError(409, conflictMessage);
}

// ============================================
// CUENTAS DE CLIENTE
// ============================================

app.post('/api/v1/auth/register', async (req, res) => {
    const name = cleanText(req.body && req.body.name, 100);
    const email = cleanText(req.body && req.body.email, 150);
    const phone = cleanText(req.body && req.body.phone, 20);
    const password = String((req.body && req.body.password) || '');
    if (!name || name.length < 3) throw new HttpError(400, 'El nombre debe tener al menos 3 caracteres.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Ingresa un correo electrónico válido.');
    if (!phone) throw new HttpError(400, 'El teléfono es obligatorio.');
    if (password.length < 8 || password.length > 128) throw new HttpError(400, 'La contraseña debe tener entre 8 y 128 caracteres.');

    const normalizedEmail = email.toLowerCase();
    const [existing] = await db.execute('SELECT id FROM customers WHERE email = ?', [normalizedEmail]);
    if (existing.length) throw new HttpError(409, 'Ya existe una cuenta con ese correo.');
    const passwordHash = await hashPassword(password);
    let customerId;
    try {
        const [result] = await db.execute(
            'INSERT INTO customers (name, email, phone, password_hash) VALUES (?, ?, ?, ?)',
            [name, normalizedEmail, phone, passwordHash]
        );
        customerId = result.insertId;
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Ya existe una cuenta con ese correo.');
        throw error;
    }
    await db.execute('DELETE FROM customer_sessions WHERE expires_at < NOW()');
    await createCustomerSession(customerId, res);
    res.status(201).json({ customer: { id: customerId, name, email: normalizedEmail, phone } });
});

app.post('/api/v1/auth/login', async (req, res) => {
    const email = cleanText(req.body && req.body.email, 150);
    const password = String((req.body && req.body.password) || '');
    if (!email || !password) throw new HttpError(400, 'Ingresa tu correo y contraseña.');
    const [rows] = await db.execute('SELECT id, name, email, phone, password_hash FROM customers WHERE email = ? LIMIT 1', [email.toLowerCase()]);
    if (!rows.length || !(await verifyPassword(password, rows[0].password_hash))) throw new HttpError(401, 'Correo o contraseña incorrectos.');
    await db.execute('DELETE FROM customer_sessions WHERE expires_at < NOW()');
    await createCustomerSession(rows[0].id, res);
    const { id, name, email: customerEmail, phone } = rows[0];
    res.json({ customer: { id, name, email: customerEmail, phone } });
});

app.get('/api/v1/auth/me', requireCustomer, (req, res) => {
    res.json({ customer: req.customer });
});

app.post('/api/v1/auth/logout', async (req, res) => {
    const token = readCookie(req, COOKIE_NAME);
    if (token) await db.execute('DELETE FROM customer_sessions WHERE token_hash = ?', [hashSessionToken(token)]);
    clearSessionCookie(res);
    res.json({ message: 'Sesión cerrada.' });
});

// ============================================
// MENÚ Y PEDIDOS COMPARTIDOS
// ============================================

app.get('/api/v1/health', async (req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
});

app.get('/api/v1/products', async (req, res) => {
    const [rows] = await db.query(
        'SELECT id, category_id, name, description, base_price FROM products WHERE available = TRUE ORDER BY category_id, id'
    );
    res.json(rows);
});

// Recepción conserva su endpoint y formato original.
app.post('/api/v1/orders', async (req, res) => {
    const order = validateOrder(req.body);
    res.status(201).json(await createOrder(order, null));
});

// Clientes crea pedidos ligados a su cuenta; los precios siempre se calculan en el servidor.
app.post('/api/v1/customer/orders', requireCustomer, async (req, res) => {
    const order = validateOrder({
        ...req.body,
        customer_name: req.customer.name,
        customer_phone: req.customer.phone
    });
    res.status(201).json(await createOrder(order, req.customer.id));
});

// Cliente consulta exclusivamente pedidos asociados a su sesión.
app.get('/api/v1/customer/orders/:id', requireCustomer, async (req, res) => {
    const id = parseOrderId(req.params.id);
    const [orders] = await db.execute(
        `SELECT id, order_type, status, payment_method, total_amount, created_at,
                estimated_minutes, kitchen_started_at, oven_started_at, ready_at
         FROM orders WHERE id = ? AND customer_id = ? LIMIT 1`,
        [id, req.customer.id]
    );
    if (!orders.length) throw new HttpError(404, 'No encontramos ese pedido en tu cuenta.');
    const [items] = await db.execute(
        `SELECT oi.product_id, p.name AS product_name, oi.quantity, oi.unit_price, oi.subtotal, oi.notes
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ? ORDER BY oi.id`,
        [id]
    );
    res.json({ ...orders[0], items });
});

// Recepción y cocina consultan la misma cola de pedidos.
app.get('/api/v1/orders/active', async (req, res) => {
    res.json(await fetchOrdersWithItems("o.status NOT IN ('COMPLETADO', 'CANCELADO')", 'o.created_at DESC, o.id DESC'));
});

app.patch('/api/v1/orders/:id/status', async (req, res) => {
    const id = parseOrderId(req.params.id);
    const status = req.body && req.body.status;
    if (!STATUSES.includes(status)) throw new HttpError(400, `status debe ser uno de: ${STATUSES.join(', ')}.`);
    const estimatedMinutes = status === 'EN_COCINA' ? parseEstimatedMinutes(req.body.estimated_minutes, false) : null;
    res.json(await changeOrderStatus(id, status, { estimatedMinutes }));
});

// ============================================
// OPERACIÓN DE COCINA
// ============================================

app.get('/api/v1/kitchen/orders', async (req, res) => {
    res.json(await fetchOrdersWithItems("o.status IN ('REGISTRADO', 'EN_COCINA')", 'o.created_at ASC, o.id ASC'));
});

app.patch('/api/v1/kitchen/orders/:id/start', async (req, res) => {
    const id = parseOrderId(req.params.id);
    const estimatedMinutes = parseEstimatedMinutes(req.body && req.body.estimated_minutes, true);
    res.json(await changeOrderStatus(id, 'EN_COCINA', { allowedFrom: ['REGISTRADO'], estimatedMinutes }));
});

app.patch('/api/v1/kitchen/orders/:id/oven', async (req, res) => {
    const id = parseOrderId(req.params.id);
    await kitchenUpdate(id,
        "UPDATE orders SET oven_started_at = NOW() WHERE id = ? AND status = 'EN_COCINA' AND oven_started_at IS NULL",
        [id], 'El pedido no está en preparación o ya está en el horno.');
    res.json({ message: `Pedido #${id} en el horno` });
});

app.patch('/api/v1/kitchen/orders/:id/ready', async (req, res) => {
    const id = parseOrderId(req.params.id);
    res.json(await changeOrderStatus(id, 'LISTO', { allowedFrom: ['EN_COCINA'] }));
});

app.patch('/api/v1/kitchen/orders/:id/back', async (req, res) => {
    const id = parseOrderId(req.params.id);
    const [rows] = await db.query('SELECT status, oven_started_at FROM orders WHERE id = ?', [id]);
    if (!rows.length) throw new HttpError(404, 'Pedido no encontrado');
    const order = rows[0];
    if (order.status === 'EN_COCINA' && order.oven_started_at) {
        await kitchenUpdate(id,
            "UPDATE orders SET oven_started_at = NULL WHERE id = ? AND status = 'EN_COCINA' AND oven_started_at IS NOT NULL",
            [id], 'El pedido cambió de estado mientras tanto. Actualiza e intenta de nuevo.');
        return res.json({ message: `Pedido #${id} regresó a preparación` });
    }
    if (order.status === 'EN_COCINA') {
        await kitchenUpdate(id,
            "UPDATE orders SET status = 'REGISTRADO', kitchen_started_at = NULL, estimated_minutes = NULL WHERE id = ? AND status = 'EN_COCINA' AND oven_started_at IS NULL",
            [id], 'El pedido cambió de estado mientras tanto. Actualiza e intenta de nuevo.');
        return res.json({ message: `Pedido #${id} regresó a pendiente` });
    }
    throw new HttpError(409, `El pedido #${id} está en ${order.status}; cocina no puede regresarlo.`);
});

// ============================================
// ARCHIVOS WEB Y MANEJO DE ERRORES
// ============================================
const CLIENT_PUBLIC = path.join(__dirname, '..', 'FrontendPizzeria-client', 'public');
const RECEPTION_PUBLIC = path.join(__dirname, '..', 'FrontendPizzeria-feature-recepcion');
app.get(/^\/cliente$/, (req, res) => res.redirect('/cliente/'));
app.get('/', (req, res) => res.redirect('/pages/recepcion.html'));
app.use('/cliente', express.static(CLIENT_PUBLIC));
app.use(express.static(RECEPTION_PUBLIC));

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
    if (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE') {
        console.error(MIGRATION_HINT, err.message);
        return res.status(500).json({ error: MIGRATION_HINT });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, async () => {
    console.log(`Servidor central corriendo en http://localhost:${PORT}`);
    try {
        await db.query('SELECT 1');
        console.log('Conectado exitosamente a MySQL.');
        const [columns] = await db.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'`
        );
        const names = new Set(columns.map(column => column.COLUMN_NAME));
        const required = ['customer_id', 'estimated_minutes', 'kitchen_started_at', 'oven_started_at', 'ready_at'];
        const [tables] = await db.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('customers', 'customer_sessions')`
        );
        const accountTables = new Set(tables.map(table => table.TABLE_NAME));
        if (required.some(column => !names.has(column)) || !accountTables.has('customers') || !accountTables.has('customer_sessions')) {
            console.warn(MIGRATION_HINT);
        }
    } catch (error) {
        console.error('No se pudo comprobar la base de datos:', describeDbError(error));
    }
});

process.on('SIGINT', async () => {
    await db.end();
    process.exit(0);
});
