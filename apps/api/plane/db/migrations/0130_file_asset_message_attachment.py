import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0129_merge_work_map_and_message_work_item"),
    ]

    operations = [
        migrations.AddField(
            model_name="fileasset",
            name="channel",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="assets",
                to="db.channel",
            ),
        ),
        migrations.AddField(
            model_name="fileasset",
            name="message",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="attachments",
                to="db.message",
            ),
        ),
        migrations.AddConstraint(
            model_name="fileasset",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(entity_type__isnull=True, channel__isnull=True)
                    | (
                        models.Q(entity_type__isnull=False, entity_type="MESSAGE_ATTACHMENT")
                        & models.Q(channel__isnull=False)
                        & models.Q(workspace__isnull=False)
                        & models.Q(user__isnull=True)
                        & models.Q(project__isnull=True)
                        & models.Q(draft_issue__isnull=True)
                        & models.Q(issue__isnull=True)
                        & models.Q(comment__isnull=True)
                        & models.Q(page__isnull=True)
                        & models.Q(document__isnull=True)
                    )
                    | (
                        models.Q(entity_type__isnull=False)
                        & ~models.Q(entity_type="MESSAGE_ATTACHMENT")
                        & models.Q(channel__isnull=True)
                    )
                ),
                name="message_attachment_channel_owner_only",
            ),
        ),
        migrations.AddConstraint(
            model_name="fileasset",
            constraint=models.CheckConstraint(
                condition=models.Q(message__isnull=True)
                | (models.Q(entity_type__isnull=False) & models.Q(entity_type="MESSAGE_ATTACHMENT")),
                name="file_asset_message_owner_is_closed",
            ),
        ),
    ]
