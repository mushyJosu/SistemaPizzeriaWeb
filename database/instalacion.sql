-- Esquema completo de la pizzería integrada (Cliente + Recepción + Cocina).
-- Para una instalación nueva; conserva un menú de tres productos compartido por todos los módulos.
CREATE DATABASE IF NOT EXISTS pizzeria_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pizzeria_db;

CREATE TABLE IF NOT EXISTS categories (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    active TINYINT(1) DEFAULT 1,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_customers_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_sessions (
    token_hash CHAR(64) NOT NULL,
    customer_id INT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_hash),
    KEY idx_customer_sessions_expiry (expires_at),
    CONSTRAINT fk_customer_sessions_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
    id INT NOT NULL AUTO_INCREMENT,
    category_id INT DEFAULT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    base_price DECIMAL(10,2) NOT NULL,
    available TINYINT(1) DEFAULT 1,
    PRIMARY KEY (id),
    KEY idx_products_category (category_id),
    CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
    id INT NOT NULL AUTO_INCREMENT,
    customer_id INT DEFAULT NULL,
    order_type ENUM('LOCAL','PARA_LLEVAR','DOMICILIO') NOT NULL,
    status ENUM('REGISTRADO','EN_COCINA','LISTO','EN_REPARTO','COMPLETADO','CANCELADO') DEFAULT 'REGISTRADO',
    payment_method ENUM('EFECTIVO','TARJETA','TRANSFERENCIA') DEFAULT NULL,
    payment_status ENUM('PENDIENTE','PAGADO') DEFAULT 'PENDIENTE',
    customer_name VARCHAR(100) DEFAULT NULL,
    customer_phone VARCHAR(20) DEFAULT NULL,
    delivery_address VARCHAR(255) DEFAULT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    estimated_minutes SMALLINT UNSIGNED DEFAULT NULL,
    kitchen_started_at TIMESTAMP NULL DEFAULT NULL,
    oven_started_at TIMESTAMP NULL DEFAULT NULL,
    ready_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_orders_status_created (status, created_at),
    KEY idx_orders_customer (customer_id),
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
    id INT NOT NULL AUTO_INCREMENT,
    order_id INT DEFAULT NULL,
    product_id INT DEFAULT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    notes VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_order_items_order (order_id),
    KEY idx_order_items_product (product_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
        REFERENCES orders (id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
        REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO categories (id, name, active) VALUES
    (1, 'Pizzas', 1),
    (2, 'Bebidas', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), active = VALUES(active);

-- Este catálogo es la única fuente de productos y precios para cliente, recepción y cocina.
INSERT INTO products (id, category_id, name, description, base_price, available) VALUES
    (1, 1, 'Pizza Pepperoni', 'Pizza grande con pepperoni y queso mozzarella.', 180.00, 1),
    (2, 1, 'Pizza Hawaiana', 'Pizza grande con jamón, piña y queso.', 170.00, 1),
    (3, 2, 'Refresco 2L', 'Refresco de dos litros.', 45.00, 1)
ON DUPLICATE KEY UPDATE
    category_id = VALUES(category_id),
    name = VALUES(name),
    description = VALUES(description),
    base_price = VALUES(base_price),
    available = VALUES(available);
