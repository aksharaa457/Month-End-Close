-- Dev-only login roles. In production these come from Terraform/Secrets Manager.
-- They inherit privileges from the NOLOGIN roles created by schema.sql.
CREATE ROLE app_migrator NOLOGIN;
CREATE ROLE app_api NOLOGIN;
CREATE ROLE app_worker NOLOGIN;
CREATE ROLE app_auth NOLOGIN BYPASSRLS;
CREATE ROLE cch_api LOGIN PASSWORD 'cch_api_dev' IN ROLE app_api;
CREATE ROLE cch_worker LOGIN PASSWORD 'cch_worker_dev' IN ROLE app_worker;
