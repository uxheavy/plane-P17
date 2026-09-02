import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0124_page_document_cutover")]

    operations = [
        migrations.AddConstraint(
            model_name="user",
            constraint=models.CheckConstraint(
                condition=models.Q(bot_type__isnull=True)
                | ~models.Q(bot_type="AGENT")
                | models.Q(is_bot=True),
                name="agent_bot_type_requires_is_bot",
            ),
        ),
        migrations.AddField(
            model_name="apitoken",
            name="purpose",
            field=models.CharField(
                choices=[
                    ("FULL", "Full"),
                    ("AGENT_LIFECYCLE", "Agent lifecycle"),
                    ("AGENT_RUNTIME", "Agent runtime"),
                ],
                default="FULL",
                max_length=32,
            ),
        ),
        migrations.CreateModel(
            name="WorkspaceAgentMembership",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                (
                    "id",
                    models.UUIDField(
                        db_index=True,
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                        unique=True,
                    ),
                ),
                ("agent_key", models.CharField(max_length=255)),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Created By",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_updated_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Last Modified By",
                    ),
                ),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="agent_membership",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="agent_memberships", to="db.workspace"
                    ),
                ),
            ],
            options={"db_table": "workspace_agent_memberships"},
        ),
        migrations.CreateModel(
            name="WorkspaceAgentMembershipReceipt",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                (
                    "id",
                    models.UUIDField(
                        db_index=True,
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                        unique=True,
                    ),
                ),
                ("idempotency_key", models.CharField(max_length=255)),
                ("request_hash", models.CharField(max_length=64)),
                ("response", models.JSONField(default=dict)),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Created By",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_updated_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Last Modified By",
                    ),
                ),
                (
                    "membership",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="receipts",
                        to="db.workspaceagentmembership",
                    ),
                ),
            ],
            options={"db_table": "workspace_agent_membership_receipts"},
        ),
        migrations.AddConstraint(
            model_name="workspaceagentmembership",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("workspace", "agent_key"),
                name="workspace_agent_membership_unique_key",
            ),
        ),
        migrations.AddConstraint(
            model_name="workspaceagentmembershipreceipt",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("membership", "idempotency_key"),
                name="workspace_agent_membership_receipt_unique_key",
            ),
        ),
        migrations.RunSQL(
            sql="""
            CREATE OR REPLACE FUNCTION enforce_agent_membership_lifecycle() RETURNS trigger AS $$
            DECLARE
                agent_is_bot boolean;
                agent_kind text;
                owner_workspace uuid;
                membership_row record;
                lifecycle_on boolean;
            BEGIN
                membership_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                lifecycle_on := current_setting('plane.agent_lifecycle', true) = 'on';
                SELECT is_bot, bot_type INTO agent_is_bot, agent_kind
                FROM users WHERE id = membership_row.member_id;
                IF agent_is_bot AND agent_kind = 'AGENT' THEN
                    IF TG_OP = 'DELETE' THEN
                        IF lifecycle_on THEN
                            RETURN OLD;
                        END IF;
                        RAISE EXCEPTION 'Agent membership is lifecycle-managed';
                    END IF;
                    IF NOT lifecycle_on THEN
                        RAISE EXCEPTION 'Agent membership is lifecycle-managed';
                    END IF;
                    IF membership_row.deleted_at IS NOT NULL THEN
                        RETURN membership_row;
                    END IF;
                    SELECT workspace_id INTO owner_workspace
                    FROM workspace_agent_memberships
                    WHERE user_id = membership_row.member_id AND deleted_at IS NULL;
                    IF owner_workspace IS NULL
                        OR owner_workspace <> membership_row.workspace_id
                        OR membership_row.role <> 15
                    THEN
                        RAISE EXCEPTION 'Agent membership violates lifecycle ownership';
                    END IF;
                END IF;
                RETURN membership_row;
            END;
            $$ LANGUAGE plpgsql;
            CREATE TRIGGER workspace_agent_membership_guard
            BEFORE INSERT OR UPDATE OR DELETE ON workspace_members
            FOR EACH ROW EXECUTE FUNCTION enforce_agent_membership_lifecycle();
            CREATE TRIGGER project_agent_membership_guard
            BEFORE INSERT OR UPDATE OR DELETE ON project_members
            FOR EACH ROW EXECUTE FUNCTION enforce_agent_membership_lifecycle();
            """,
            reverse_sql="""
            DROP TRIGGER IF EXISTS project_agent_membership_guard ON project_members;
            DROP TRIGGER IF EXISTS workspace_agent_membership_guard ON workspace_members;
            DROP FUNCTION IF EXISTS enforce_agent_membership_lifecycle();
            """,
        ),
    ]
