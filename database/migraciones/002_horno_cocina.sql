-- ============================================================
-- Migración 002: horno en el módulo de cocina
-- El módulo de cocina distingue "preparación" de "cocinando" (horno).
-- Ambos se guardan como status = 'EN_COCINA'; esta columna indica
-- desde cuándo el pedido está en el horno (NULL = aún en preparación).
--
-- Requiere haber ejecutado antes 001_tiempos_cocina.sql.
-- Ejecutar UNA sola vez sobre pizzeria_db. Si vuelves a importar
-- pizzeria_db_orders.sql, hay que correr 001 y 002 otra vez.
-- ============================================================

USE pizzeria_db;

ALTER TABLE orders
    ADD COLUMN oven_started_at TIMESTAMP NULL DEFAULT NULL
        COMMENT 'Momento en que el pedido entró al horno (NULL = en preparación)'
        AFTER kitchen_started_at;
