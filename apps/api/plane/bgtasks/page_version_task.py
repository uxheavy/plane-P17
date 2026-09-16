# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json
import uuid


# Third party imports
from celery import shared_task

# Django imports
from django.db import transaction
from django.utils import timezone

# Module imports
from plane.bgtasks.copy_s3_object import extract_asset_ids
from plane.db.models import DocumentVersionAsset, FileAsset, Page, PageVersion
from plane.utils.exception_logger import log_exception

PAGE_VERSION_TASK_TIMEOUT = 600


def page_version_assets(page):
    asset_ids = set()
    for source in extract_asset_ids(page.description_html, "image-component"):
        try:
            asset_ids.add(uuid.UUID(str(source)))
        except (TypeError, ValueError):
            continue
    assets = {asset.id: asset for asset in FileAsset._base_manager.filter(id__in=asset_ids)}
    if any(
        asset.document_id != page.id or asset.entity_type != FileAsset.EntityTypeContext.PAGE_DESCRIPTION
        for asset in assets.values()
    ):
        raise ValueError("Page version asset is not owned by its Document")
    return assets.values()


def replace_page_version_assets(page_version, assets):
    asset_ids = {asset.id for asset in assets}
    DocumentVersionAsset.objects.filter(document_version=page_version).exclude(asset_id__in=asset_ids).delete(
        soft=False
    )
    DocumentVersionAsset.objects.bulk_create(
        [DocumentVersionAsset(document_version=page_version, asset_id=asset_id) for asset_id in asset_ids],
        ignore_conflicts=True,
    )


@shared_task
def track_page_version(page_id, existing_instance, user_id):
    try:
        current_instance = json.loads(existing_instance) if existing_instance is not None else {}
        sub_pages = {}
        with transaction.atomic():
            page = Page.objects.select_for_update().get(id=page_id)
            if current_instance.get("description_html") == page.description_html:
                return
            assets = list(page_version_assets(page))
            page_version = (
                PageVersion.objects.select_for_update().filter(document_id=page_id).order_by("-last_saved_at").first()
            )

            if (
                page_version
                and str(page_version.owned_by_id) == str(user_id)
                and (timezone.now() - page_version.last_saved_at).total_seconds() <= PAGE_VERSION_TASK_TIMEOUT
            ):
                page_version.description_html = page.description_html
                page_version.description_binary = page.description_binary
                page_version.description_json = page.description_json
                page_version.description_stripped = page.description_stripped
                page_version.sub_pages_data = sub_pages
                page_version.save(
                    update_fields=[
                        "description_html",
                        "description_binary",
                        "description_json",
                        "description_stripped",
                        "sub_pages_data",
                        "updated_at",
                    ]
                )
            else:
                page_version = PageVersion.objects.create(
                    document_id=page_id,
                    workspace_id=page.workspace_id,
                    description_json=page.description_json,
                    description_html=page.description_html,
                    description_binary=page.description_binary,
                    description_stripped=page.description_stripped,
                    owned_by_id=user_id,
                    last_saved_at=timezone.now(),
                    sub_pages_data=sub_pages,
                )
            replace_page_version_assets(page_version, assets)
            if PageVersion.objects.filter(document_id=page_id).count() > 20:
                PageVersion.objects.filter(document_id=page_id).order_by("last_saved_at").first().delete()

        return
    except Page.DoesNotExist:
        return
    except Exception as e:
        log_exception(e)
        return
