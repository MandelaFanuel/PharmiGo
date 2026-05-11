from django.db import migrations, models


NEW_UNIQUE_CONSTRAINT = "prescriptions_stock_pharmacy_med_dosage_scope_unit_uniq"


def sync_pharmacystock_uniqueness(apps, schema_editor):
    table_name = "prescriptions_pharmacystock"

    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(
            f"""
            DO $$
            DECLARE
                constraint_name text;
                index_name text;
            BEGIN
                FOR constraint_name IN
                    SELECT c.conname
                    FROM pg_constraint c
                    JOIN pg_class t ON t.oid = c.conrelid
                    WHERE t.relname = '{table_name}'
                      AND c.contype = 'u'
                      AND pg_get_constraintdef(c.oid) LIKE '%(pharmacy_id, medication_name, dosage)%'
                LOOP
                    EXECUTE format('ALTER TABLE {table_name} DROP CONSTRAINT IF EXISTS %I', constraint_name);
                END LOOP;

                FOR index_name IN
                    SELECT indexname
                    FROM pg_indexes
                    WHERE tablename = '{table_name}'
                      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
                      AND indexdef LIKE '%(pharmacy_id, medication_name, dosage)%'
                LOOP
                    EXECUTE format('DROP INDEX IF EXISTS %I', index_name);
                END LOOP;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint c
                    JOIN pg_class t ON t.oid = c.conrelid
                    WHERE t.relname = '{table_name}'
                      AND c.conname = '{NEW_UNIQUE_CONSTRAINT}'
                ) THEN
                    EXECUTE 'ALTER TABLE {table_name} ADD CONSTRAINT {NEW_UNIQUE_CONSTRAINT} UNIQUE (pharmacy_id, medication_name, dosage, sale_scope, unit)';
                END IF;
            END $$;
            """
        )
        return

    # SQLite and other backends used in tests/dev can safely rely on the ORM state change.


def revert_pharmacystock_uniqueness(apps, schema_editor):
    table_name = "prescriptions_pharmacystock"

    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(
            f"""
            ALTER TABLE {table_name}
            DROP CONSTRAINT IF EXISTS {NEW_UNIQUE_CONSTRAINT};
            """
        )


class Migration(migrations.Migration):

    dependencies = [
        ("prescriptions", "0013_pharmacystock_currency"),
    ]

    operations = [
        migrations.AddField(
            model_name="pharmacystock",
            name="sale_scope",
            field=models.CharField(
                choices=[("retail", "Detail"), ("wholesale", "Gros")],
                default="retail",
                max_length=20,
            ),
        ),
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    sync_pharmacystock_uniqueness,
                    reverse_code=revert_pharmacystock_uniqueness,
                ),
            ],
            state_operations=[
                migrations.AlterUniqueTogether(
                    name="pharmacystock",
                    unique_together={("pharmacy", "medication_name", "dosage", "sale_scope", "unit")},
                ),
            ],
        ),
    ]
