from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0132_work_item_claim"),
    ]

    operations = [
        migrations.AddField(
            model_name="draftissue",
            name="creation_origin",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
