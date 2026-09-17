# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

import base64
import binascii
import json
import uuid

from django.db import IntegrityError, connection, transaction
from django.db.models import Prefetch, Q, UUIDField
from django.db.models.expressions import RawSQL
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from plane.db.models import FileAsset, Issue, Message
from plane.db.models.project import ROLE


MESSAGE_PAGE_SIZE = 50


class MessageCursorError(ValueError):
    pass


class MessageParentError(ValueError):
    pass


class MessageReplayConflict(ValueError):
    pass


class MessageThreadNotFound(ValueError):
    pass


class MessageThreadRootRequired(ValueError):
    pass


class MessageThreadCycleError(ValueError):
    pass


class MessageAttachmentError(ValueError):
    pass


class ChannelMessages:
    @staticmethod
    def list_roots(*, channel, user, cursor=None):
        messages = ChannelMessages._with_attachments(
            Message.objects.filter(channel=channel, parent__isnull=True).select_related(
                "created_by", "created_work_item_intent__issue"
            )
        )
        return ChannelMessages._paginate(messages, channel_id=channel.id, user=user, cursor=cursor)

    @staticmethod
    def list_thread(*, channel, root_id, user, cursor=None):
        root = Message.objects.filter(channel=channel, id=root_id).only("id", "parent_id").first()
        if root is None:
            raise MessageThreadNotFound
        if root.parent_id is not None:
            raise MessageThreadRootRequired

        thread_ids = RawSQL(
            """
            WITH RECURSIVE descendants(id) AS (
                SELECT id
                FROM channel_messages
                WHERE id = %s
                  AND channel_id = %s
                  AND parent_id IS NULL
                  AND deleted_at IS NULL
                UNION
                SELECT message.id
                FROM channel_messages AS message
                JOIN descendants ON message.parent_id = descendants.id
                WHERE message.channel_id = %s
                  AND message.deleted_at IS NULL
            )
            SELECT id FROM descendants
            """,
            [root_id, channel.id, channel.id],
            output_field=UUIDField(),
        )
        messages = ChannelMessages._with_attachments(
            Message.objects.filter(channel=channel, id__in=thread_ids).select_related(
                "created_by", "created_work_item_intent__issue"
            )
        )
        return ChannelMessages._paginate(messages, channel_id=channel.id, user=user, cursor=cursor, root_id=root.id)

    @staticmethod
    def create(*, channel, user, content, parent_id, client_id, attachment_ids=None):
        attachment_ids = list(attachment_ids or [])
        if len(attachment_ids) != len(set(attachment_ids)):
            raise MessageAttachmentError("attachment_ids must not contain duplicates")
        if not content.strip() and not attachment_ids:
            raise MessageAttachmentError("Message content or at least one attachment is required")

        with transaction.atomic():
            existing = (
                Message.objects.select_for_update()
                .filter(channel=channel, created_by_id=user.id, client_id=client_id)
                .first()
            )
            if existing is not None:
                if ChannelMessages._matches(
                    existing,
                    content=content,
                    parent_id=parent_id,
                    attachment_ids=attachment_ids,
                ):
                    return ChannelMessages._with_root_id(existing), False
                raise MessageReplayConflict

            if parent_id is not None and not Message.objects.filter(id=parent_id, channel=channel).exists():
                raise MessageParentError("Parent message is not in this channel")

            assets = ChannelMessages._lock_attachments(channel=channel, user=user, attachment_ids=attachment_ids)
            existing = (
                Message.objects.select_for_update()
                .filter(channel=channel, created_by_id=user.id, client_id=client_id)
                .first()
            )
            if existing is not None:
                if ChannelMessages._matches(
                    existing,
                    content=content,
                    parent_id=parent_id,
                    attachment_ids=attachment_ids,
                ):
                    return ChannelMessages._with_root_id(existing), False
                raise MessageReplayConflict

            try:
                with transaction.atomic():
                    message = Message(
                        channel=channel,
                        content=content,
                        parent_id=parent_id,
                        client_id=client_id,
                    )
                    message.save(created_by_id=user.id)
                    FileAsset.objects.filter(id__in=[asset.id for asset in assets]).update(
                        message=message,
                        updated_by_id=user.id,
                        updated_at=timezone.now(),
                    )
            except IntegrityError:
                existing = (
                    Message.objects.select_related("created_by")
                    .filter(
                        channel=channel,
                        created_by_id=user.id,
                        client_id=client_id,
                    )
                    .first()
                )
                if existing is not None and ChannelMessages._matches(
                    existing,
                    content=content,
                    parent_id=parent_id,
                    attachment_ids=attachment_ids,
                ):
                    return ChannelMessages._with_root_id(existing), False
                raise MessageReplayConflict
        message = Message.objects.select_related("created_by").get(id=message.id)
        return ChannelMessages._with_root_id(message), True

    @staticmethod
    def _paginate(messages, *, channel_id, user, cursor, root_id=None):
        if cursor:
            created_at, message_id = ChannelMessages._decode_cursor(cursor)
            messages = messages.filter(Q(created_at__gt=created_at) | Q(created_at=created_at, id__gt=message_id))

        page = list(messages.order_by("created_at", "id")[: MESSAGE_PAGE_SIZE + 1])
        has_next = len(page) > MESSAGE_PAGE_SIZE
        page = page[:MESSAGE_PAGE_SIZE]
        if root_id is not None:
            for message in page:
                message._root_id = root_id
        creation_issue_ids = {
            message.created_work_item_intent.issue_id
            for message in page
            if getattr(message, "created_work_item_intent", None)
            and message.created_work_item_intent.issue_id is not None
        }
        visible_issue_ids = set()
        if creation_issue_ids:
            visible_issue_ids = set(
                Issue.issue_objects.filter(id__in=creation_issue_ids)
                .filter(
                    Q(
                        project__project_projectmember__member=user,
                        project__project_projectmember__is_active=True,
                        project__project_projectmember__role__gt=ROLE.GUEST.value,
                    )
                    | Q(
                        project__project_projectmember__member=user,
                        project__project_projectmember__is_active=True,
                        project__project_projectmember__role=ROLE.GUEST.value,
                        project__guest_view_all_features=True,
                    )
                    | Q(
                        project__project_projectmember__member=user,
                        project__project_projectmember__is_active=True,
                        project__project_projectmember__role=ROLE.GUEST.value,
                        project__guest_view_all_features=False,
                        created_by=user,
                    )
                )
                .values_list("id", flat=True)
            )
        for message in page:
            intent = getattr(message, "created_work_item_intent", None)
            message._created_work_item_visible = bool(intent and intent.issue_id in visible_issue_ids)
        ChannelMessages._attach_reply_counts(page, channel_id=channel_id)
        return {
            "messages": page,
            "next_cursor": ChannelMessages._encode_cursor(page[-1]) if has_next else None,
        }

    @staticmethod
    def _matches(message, *, content, parent_id, attachment_ids):
        existing_attachment_ids = set(
            message.attachments.filter(
                entity_type=FileAsset.EntityTypeContext.MESSAGE_ATTACHMENT,
                is_uploaded=True,
                is_deleted=False,
                deleted_at__isnull=True,
            ).values_list("id", flat=True)
        )
        return (
            message.content == content
            and message.parent_id == parent_id
            and existing_attachment_ids == set(attachment_ids)
        )

    @staticmethod
    def _with_attachments(messages):
        attachments = FileAsset.objects.filter(
            entity_type=FileAsset.EntityTypeContext.MESSAGE_ATTACHMENT,
            is_uploaded=True,
            is_deleted=False,
            deleted_at__isnull=True,
        )
        return messages.prefetch_related(Prefetch("attachments", queryset=attachments))

    @staticmethod
    def _lock_attachments(*, channel, user, attachment_ids):
        if not attachment_ids:
            return []
        assets = list(
            FileAsset.objects.select_for_update()
            .filter(id__in=attachment_ids)
            .order_by("id")
        )
        by_id = {asset.id: asset for asset in assets}
        if len(assets) != len(attachment_ids) or any(
            asset_id not in by_id for asset_id in attachment_ids
        ):
            raise MessageAttachmentError("Attachment was not found")
        if any(
            asset.entity_type != FileAsset.EntityTypeContext.MESSAGE_ATTACHMENT
            or asset.channel_id != channel.id
            or asset.workspace_id != channel.workspace_id
            or asset.created_by_id != user.id
            or asset.message_id is not None
            or not asset.is_uploaded
            or asset.is_deleted
            or asset.deleted_at is not None
            for asset in assets
        ):
            raise MessageAttachmentError("Attachment is not available for this channel message")
        return [by_id[asset_id] for asset_id in attachment_ids]

    @staticmethod
    def _attach_reply_counts(messages, *, channel_id):
        if not messages:
            return

        placeholders = ", ".join(["%s"] * len(messages))
        sql = f"""
            WITH RECURSIVE descendants(ancestor_id, descendant_id) AS (
                SELECT message.id, message.id
                FROM channel_messages AS message
                WHERE message.channel_id = %s
                  AND message.deleted_at IS NULL
                  AND message.id IN ({placeholders})
                UNION
                SELECT descendants.ancestor_id, child.id
                FROM channel_messages AS child
                JOIN descendants ON child.parent_id = descendants.descendant_id
                WHERE child.channel_id = %s
                  AND child.deleted_at IS NULL
            )
            SELECT ancestor_id, COUNT(*) - 1 AS reply_count
            FROM descendants
            GROUP BY ancestor_id
        """
        params = [channel_id, *(message.id for message in messages), channel_id]
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            counts = {str(ancestor_id): int(reply_count) for ancestor_id, reply_count in cursor.fetchall()}
        for message in messages:
            message._reply_count = counts.get(str(message.id), 0)

    @staticmethod
    def _with_root_id(message):
        message._root_id = ChannelMessages._root_id(message)
        return message

    @staticmethod
    def root_id(message):
        return ChannelMessages._root_id(message)

    @staticmethod
    def _root_id(message):
        current = message
        visited = set()
        while current.parent_id is not None:
            if current.id in visited:
                raise MessageThreadCycleError("Message thread contains a cycle")
            visited.add(current.id)
            current = Message.objects.only("id", "parent_id").get(
                id=current.parent_id,
                channel_id=message.channel_id,
            )
        return current.id

    @staticmethod
    def _encode_cursor(message):
        payload = json.dumps(
            {"created_at": message.created_at.isoformat(), "id": str(message.id)},
            separators=(",", ":"),
        ).encode("utf-8")
        return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_cursor(value):
        try:
            padded = value + "=" * (-len(value) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError
            created_at_value = payload.get("created_at")
            message_id_value = payload.get("id")
            if not isinstance(created_at_value, str) or not isinstance(message_id_value, str):
                raise ValueError
            created_at = parse_datetime(created_at_value)
            message_id = uuid.UUID(message_id_value)
            if created_at is None or timezone.is_naive(created_at):
                raise ValueError
            return created_at, message_id
        except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error) as error:
            raise MessageCursorError("Invalid cursor") from error
