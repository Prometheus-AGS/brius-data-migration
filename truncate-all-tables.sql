-- Full Sync: Truncate all target tables before reload
-- Using CASCADE to handle all foreign key dependencies

BEGIN;
TRUNCATE TABLE offices, profiles, doctors, patients, orders, products, jaws, projects, treatment_plans CASCADE;
COMMIT;

-- Verify tables are empty
SELECT 'offices' as table_name, COUNT(*) as count FROM offices
UNION ALL SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL SELECT 'doctors', COUNT(*) FROM doctors
UNION ALL SELECT 'patients', COUNT(*) FROM patients
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'jaws', COUNT(*) FROM jaws;
