-- ============================================================
-- Migración 001: tiempos de cocina
-- Agrega a `orders` el tiempo estimado que captura cocina y las
-- horas en que el pedido entró a cocina y quedó listo.
--
-- Ejecutar UNA sola vez sobre pizzeria_db, DESPUÉS de importar
-- los dumps pizzeria_db_*.sql. Si vuelves a importar
-- pizzeria_db_orders.sql, la tabla se recrea sin estas columnas
-- y hay que correr esta migración otra vez.
-- ============================================================

USE pizzeria_db;

ALTER TABLE orders
    ADD COLUMN estimated_minutes SMALLINT UNSIGNED NULL
        COMMENT 'Minutos estimados de preparación (los captura cocina)'
        AFTER total_amount,
    ADD COLUMN kitchen_started_at TIMESTAMP NULL DEFAULT NULL
        COMMENT 'Momento en que el pedido pasó a EN_COCINA'
        AFTER estimated_minutes,
    ADD COLUMN ready_at TIMESTAMP NULL DEFAULT NULL
        COMMENT 'Momento en que el pedido pasó a LISTO'
        AFTER kitchen_started_at;
