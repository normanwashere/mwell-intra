-- Production reconciliation is certified; remove the temporary private snapshot tables.
drop schema if exists recovery_20260806 cascade;
