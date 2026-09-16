import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def backfill_conversation_origins(apps, schema_editor):
    intent_model = apps.get_model("db", "WorkItemCreationIntent")
    message_model = apps.get_model("db", "Message")
    for intent in intent_model.objects.select_related("legacy_source_message"):
        source = intent.legacy_source_message
        if source is None:
            continue
        root = source
        visited = set()
        while root.parent_id is not None and root.id not in visited:
            visited.add(root.id)
            root = message_model.objects.only("id", "parent_id").get(id=root.parent_id)
        intent.origin_kind = "conversation"
        intent.channel_id = source.channel_id
        intent.thread_root_id = root.id if root.parent_id is None and root.id != source.id else None
        intent.save(update_fields=["origin_kind", "channel_id", "thread_root_id"])


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0130_file_asset_message_attachment"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="MessageWorkItemIntent",
            new_name="WorkItemCreationIntent",
        ),
        migrations.RenameField(
            model_name="workitemcreationintent",
            old_name="source_message",
            new_name="legacy_source_message",
        ),
        migrations.AlterField(
            model_name="workitemcreationintent",
            name="legacy_source_message",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="legacy_work_item_intents",
                to="db.message",
            ),
        ),
        migrations.AlterField(
            model_name="workitemcreationintent",
            name="id",
            field=models.UUIDField(
                db_index=True,
                default=uuid.uuid4,
                editable=False,
                primary_key=True,
                serialize=False,
                unique=True,
            ),
        ),
        migrations.AlterField(
            model_name="workitemcreationintent",
            name="project",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="project_%(class)s",
                to="db.project",
            ),
        ),
        migrations.AlterField(
            model_name="workitemcreationintent",
            name="updated_by",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_updated_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Last Modified By",
            ),
        ),
        migrations.AlterField(
            model_name="workitemcreationintent",
            name="workspace",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="workspace_%(class)s",
                to="db.workspace",
            ),
        ),
        migrations.AddField(
            model_name="workitemcreationintent",
            name="origin_kind",
            field=models.CharField(
                choices=[("conversation", "Conversation"), ("work-map", "Work map")],
                default="conversation",
                max_length=20,
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="workitemcreationintent",
            name="channel",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="work_item_creation_intents",
                to="db.channel",
            ),
        ),
        migrations.AddField(
            model_name="workitemcreationintent",
            name="thread_root",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="thread_work_item_creation_intents",
                to="db.message",
            ),
        ),
        migrations.AddField(
            model_name="workitemcreationintent",
            name="work_map",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="work_item_creation_intents",
                to="db.workmap",
            ),
        ),
        migrations.AddField(
            model_name="workitemcreationintent",
            name="work_map_generation",
            field=models.PositiveBigIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="workitemcreationintent",
            name="placement_id",
            field=models.UUIDField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="workitemcreationintent",
            name="element_id",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="workitemcreationintent",
            name="creation_message",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="created_work_item_intent",
                to="db.message",
            ),
        ),
        migrations.AddField(
            model_name="workitemcreationintent",
            name="origin_finalized_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="workitemcreationintent",
            name="issue",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="work_item_creation_intent",
                to="db.issue",
            ),
        ),
        migrations.RemoveIndex(
            model_name="workitemcreationintent",
            name="message_work_item_source_idx",
        ),
        migrations.AddIndex(
            model_name="workitemcreationintent",
            index=models.Index(fields=("origin_kind", "created_by"), name="work_item_creation_origin_idx"),
        ),
        migrations.AddIndex(
            model_name="workitemcreationintent",
            index=models.Index(fields=("work_map", "element_id"), name="work_item_create_map_elem_idx"),
        ),
        migrations.RunPython(backfill_conversation_origins, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="workitemcreationintent",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(
                        origin_kind="conversation",
                        channel__isnull=False,
                        work_map__isnull=True,
                        work_map_generation__isnull=True,
                        placement_id__isnull=True,
                        element_id__isnull=True,
                    )
                    | models.Q(
                        origin_kind="work-map",
                        channel__isnull=True,
                        thread_root__isnull=True,
                        work_map__isnull=False,
                        work_map_generation__isnull=False,
                        placement_id__isnull=False,
                        element_id__isnull=False,
                    )
                ),
                name="work_item_creation_origin_closed",
            ),
        ),
    ]
