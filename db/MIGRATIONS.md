# Database Migrations

This project uses PostgreSQL migrations from `db/migrations/*.sql` and explicit rollback files from `db/rollbacks/*.down.sql`.
Applied versions are tracked in `schema_migrations`.

`001_baseline.sql` is the only initial schema source. `initPg()` no longer carries a second embedded schema definition; both empty databases and upgrades execute the same ordered migration chain.

## Rules

- Keep migrations idempotent where practical: use `IF NOT EXISTS`, `CREATE OR REPLACE`, and safe backfill SQL.
- Do not edit an already released migration after it may have run on a server.
- Startup fails when an applied migration checksum differs from the file in the image. `PO18_ALLOW_MIGRATION_CHECKSUM_DRIFT=1` is an emergency inspection override, not a normal deployment setting.
- Fix a bad released migration with a new higher-numbered migration.
- Add a matching `db/rollbacks/NNN_name.down.sql` for each released migration when the change can be safely reversed.
- Update `db/schema-snapshot.json` in the same change. `npm run check:schema` rejects a changed migration chain or application DDL outside the migration directory.
- Take a database backup before any schema change on a production instance.

## Preflight

Before deploying a new migration:

```bash
docker exec po18-app sh -lc 'pg_dump "$DATABASE_URL" --format=custom --file=/config/backups/pre-migration-$(date +%Y%m%d-%H%M%S).dump'
```

Check current migration state:

```bash
docker exec po18-app sh -lc 'psql "$DATABASE_URL" -c "SELECT version, name, applied_at FROM schema_migrations ORDER BY version;"'
```

The migration table also records `duration_ms` and `app_version`, so a running database can be matched to the application version that applied each change.

`018_data_quality_guards` adds `NOT VALID` checks for new writes without forcing a full validation scan of legacy rows. After cleaning historical anomalies, constraints can be validated individually with `ALTER TABLE ... VALIDATE CONSTRAINT ...`.

Later additive migrations keep the explicitly deferred identity model unchanged:

- `019_job_effect_idempotency`: exactly-once charge/reward ledger.
- `020_taxonomy_and_quality_semantics`: normalized taxonomy, timestamp semantics and deferred order checks.
- `021_book_manifest_checksums`: Manifest checksums.
- `022_review_governance`: reports, appeals and bounded vote changes.

None of these migrations introduces `book_key` or changes existing platform-unaware API fields.

## Rollback Strategy

Rollback is manual and must be explicitly enabled. It never runs during normal app startup.

The baseline migration intentionally has no automatic down migration because dropping the whole application schema is destructive. Restore a backup when a complete baseline rollback is required.

Rollback the latest migration:

```bash
docker exec po18-app sh -lc 'cd /app && PO18_ALLOW_SCHEMA_ROLLBACK=1 npm run db:rollback -- --steps 1 --confirm ROLLBACK'
```

Rollback all migrations newer than a target version:

```bash
docker exec po18-app sh -lc 'cd /app && PO18_ALLOW_SCHEMA_ROLLBACK=1 npm run db:rollback -- --to 005_system_jobs --confirm ROLLBACK'
```

Rules:

1. Restore the pre-migration dump when the migration changed or removed data.
2. Create a new compensating migration when the schema can be repaired safely.
3. Use `db:rollback` only when the matching down SQL is known to be safe for the current data.
4. Manually repair metadata only when a migration failed before finishing and the database state is already known.

Prefer restore for destructive mistakes. Prefer a new compensating migration for additive schema fixes.

## Manual Repair

If a migration failed midway:

```bash
docker exec po18-app sh -lc 'psql "$DATABASE_URL" -c "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;"'
```

If the failed version is not recorded, fix the SQL or create a new migration and restart the app.

If the failed version is recorded but the schema is incomplete:

```bash
docker exec po18-app sh -lc 'psql "$DATABASE_URL" -f /app/db/migrations/00X_name.sql'
```

Only delete a row from `schema_migrations` when you have verified the failed migration left no partial objects or data changes:

```bash
docker exec po18-app sh -lc 'psql "$DATABASE_URL" -c "DELETE FROM schema_migrations WHERE version = 0;"'
```

Replace `0` with the exact version after inspection.

## Book Stats Repair

If `book_stats` drifts from source tables, refresh it without dropping data:

```bash
docker exec po18-app sh -lc 'psql "$DATABASE_URL" -c "SELECT refresh_book_stats(book_id) FROM (SELECT book_id FROM book_metadata UNION SELECT book_id FROM chapter_cache UNION SELECT book_id FROM reader_book_feedback UNION SELECT book_id FROM reader_book_crowd_votes) s WHERE book_id IS NOT NULL;"'
```

## System Jobs Repair

If a process exits while a job is `running`, mark old jobs failed before retrying:

```bash
docker exec po18-app sh -lc 'psql "$DATABASE_URL" -c "UPDATE system_jobs SET status = '\''failed'\'', error = '\''process exited before completion'\'', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE status = '\''running'\'' AND updated_at < now() - interval '\''30 minutes'\'';"'
```
