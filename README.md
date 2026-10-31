# Buena Pizza — Sprint integrado

Proyecto integrado para **Clientes, Recepción y Cocina**. Los tres módulos utilizan un único backend Express y un único catálogo MySQL.

## Qué quedó integrado

- **Clientes:** menú dinámico leído desde MySQL, carrito, registro/inicio de sesión, creación de pedidos y rastreo del estado real.
- **Recepción:** conserva su panel y sus acciones, consultando la misma API y base de datos.
- **Cocina:** conserva la aplicación React/Vite y su flujo de preparación/horno/listo.
- **Catálogo único:** Pizza Pepperoni ($180), Pizza Hawaiana ($170) y Refresco 2L ($45). Los precios de la pantalla de Clientes y del pedido se toman del servidor.
- **Login sencillo:** las contraseñas se guardan con hash scrypt y salt aleatorio (no se almacenan ni se recuperan en texto plano). La sesión usa cookie HttpOnly y su token se guarda como hash en MySQL.
- **Estados compartidos:** `REGISTRADO → EN_COCINA → LISTO → COMPLETADO`; para domicilio, `LISTO → EN_REPARTO → COMPLETADO`. Los pedidos pueden cancelarse desde `REGISTRADO`.

No se procesa un pago real: el sistema conserva el método elegido como dato del pedido. No se incluye pasarela bancaria.

## Requisitos

- Node.js 18 o superior.
- MySQL 8 o superior.
- MySQL Workbench (recomendado para ejecutar el SQL).

## Instalación nueva

### 1. Preparar MySQL

1. Abre MySQL Workbench y conecta tu servidor local.
2. Abre `database/instalacion.sql` y ejecútalo completo.
3. El script crea `pizzeria_db`, sus tablas, las columnas que necesita Cocina y las tres filas del menú integrado.

> Este script es para una instalación nueva o de práctica. Si ya tienes una base con pedidos que debas conservar, no la borres ni vuelvas a importar los dumps antiguos; utiliza la sección **Actualizar una base existente**.

### 2. Configurar el backend

1. Entra a `pizzeria-backend`.
2. Copia `.env.example` como `.env`.
3. Edita `.env` y escribe la contraseña de tu MySQL en `DB_PASSWORD`. Ejemplo local:

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_contraseña_mysql
DB_NAME=pizzeria_db
NODE_ENV=development
```

4. Instala e inicia:

```bash
npm install
npm start
```

En la terminal debe aparecer `Servidor central corriendo en http://localhost:3000` y `Conectado exitosamente a MySQL`.

### 3. Abrir los módulos

Con el backend encendido:

| Módulo | Dirección |
|---|---|
| Clientes | http://localhost:3000/cliente/ |
| Recepción | http://localhost:3000/pages/recepcion.html |
| API / salud | http://localhost:3000/api/v1/health |

Cocina se ejecuta en otra terminal:

```bash
cd FrontendPizzeria-feature-cocina
npm install
npm run dev
```

Abre la dirección local que muestre Vite (normalmente `http://localhost:5173`). `vite.config.js` ya reenvía `/api` al backend del puerto 3000.

## Actualizar una base existente

Haz primero un respaldo en MySQL Workbench. Conserva los pedidos y productos existentes.

1. Si las columnas de Cocina todavía no están en `orders`, ejecuta en orden:
   - `database/migraciones/001_tiempos_cocina.sql`
   - `database/migraciones/002_horno_cocina.sql`
2. Ejecuta `database/migraciones/003_cuentas_clientes.sql` para crear las tablas de clientes/sesiones y asociar `orders.customer_id`.
3. Verifica que `products` contenga los IDs y precios del catálogo compartido. Para alinear el menú actual puedes ejecutar:

```sql
USE pizzeria_db;
UPDATE products SET name='Pizza Pepperoni', description='Pizza grande con pepperoni y queso mozzarella.', base_price=180.00, available=1 WHERE id=1;
UPDATE products SET name='Pizza Hawaiana', description='Pizza grande con jamón, piña y queso.', base_price=170.00, available=1 WHERE id=2;
UPDATE products SET name='Refresco 2L', description='Refresco de dos litros.', base_price=45.00, available=1 WHERE id=3;
```

Si esos IDs no corresponden a los productos que espera tu sistema, revisa primero `SELECT id, name, base_price FROM products;` y adapta los IDs antes de actualizar. No ejecutes los dumps dentro de `database/legacy` sobre una base que quieras conservar, ya que los dumps originales incluyen `DROP TABLE`.

## Cuentas de cliente

Desde Clientes, pulsa **Iniciar sesión** y después **Crear cuenta**. El registro solicita nombre, correo, teléfono y contraseña de al menos 8 caracteres. Al registrarse, la sesión se inicia automáticamente.

La cuenta es necesaria para confirmar pedidos desde el módulo Cliente. Los pedidos realizados por Recepción siguen funcionando sin cuenta. Cada pedido creado desde Clientes guarda `customer_id`; por eso, al rastrear un folio, solo la cuenta propietaria puede consultarlo.

La contraseña se procesa con `scrypt` y un salt aleatorio antes de guardarse. No se cifra para descifrarla después. La sesión se entrega en una cookie `HttpOnly`; en un despliegue real debe usarse HTTPS y `NODE_ENV=production`.

## Endpoints principales

| Método | Endpoint | Función |
|---|---|---|
| GET | `/api/v1/products` | Catálogo común |
| POST | `/api/v1/auth/register` | Crear cuenta y sesión |
| POST | `/api/v1/auth/login` | Iniciar sesión |
| GET | `/api/v1/auth/me` | Consultar sesión actual |
| POST | `/api/v1/auth/logout` | Cerrar sesión |
| POST | `/api/v1/customer/orders` | Crear pedido autenticado |
| GET | `/api/v1/customer/orders/:id` | Rastrear pedido propio |
| POST | `/api/v1/orders` | Crear pedido desde Recepción |
| GET | `/api/v1/orders/active` | Pedidos activos para Recepción |
| PATCH | `/api/v1/orders/:id/status` | Acciones de Recepción |
| GET | `/api/v1/kitchen/orders` | Cola de Cocina |
| PATCH | `/api/v1/kitchen/orders/:id/start` | Iniciar preparación |
| PATCH | `/api/v1/kitchen/orders/:id/oven` | Marcar entrada al horno |
| PATCH | `/api/v1/kitchen/orders/:id/ready` | Marcar pedido listo |
| PATCH | `/api/v1/kitchen/orders/:id/back` | Retroceder un paso en Cocina |

## Prueba rápida del flujo integrado

1. Inicia MySQL y el backend.
2. Abre Clientes, crea una cuenta y realiza un pedido con Pizza Pepperoni o Pizza Hawaiana. Puedes agregar Refresco 2L.
3. Copia el folio `PED-XXXX` generado.
4. Abre Recepción y verifica que aparece el pedido.
5. Abre Cocina y toma el pedido, selecciona el tiempo, pásalo al horno y márcalo como listo.
6. En Recepción, cambia el pedido a entregado (o a reparto y después entregado si es domicilio).
7. Regresa a Clientes y consulta el mismo folio. El estado debe actualizarse desde MySQL.

## Notas del alcance

- Se conserva el diseño y el flujo operativo principal de Recepción y Cocina.
- Se retiró del módulo Cliente el menú fijo de ocho productos, el cupón local y el temporizador ficticio de dos minutos porque no estaban conectados a la API común.
- Los productos y precios se mantienen en MySQL; el frontend nunca envía importes para calcular el pedido.
- El registro de pago es informativo para el sprint. No se cobran tarjetas ni transferencias desde la aplicación.
- No se incluyeron `node_modules`; cada frontend/backend instala dependencias con `npm install`.
