# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import json
import uuid
from urllib.parse import urlencode

from django.db import IntegrityError, transaction
from django.utils import timezone

from plane.db.models import (
    Channel,
    Document,
    Message,
    ProjectMember,
    WorkItemCreationIntent,
    IssueLink,
    WorkMap,
    WorkMapBinding,
    WorkMapBindingPlacement,
    WorkspaceMember,
)
from plane.db.models.project import ROLE
from plane.utils.host import base_host


class WorkItemCreationIntentConflict(ValueError):
    pass


class WorkItemCreationOriginDenied(ValueError):
    pass


class WorkItemCreationIntents:
    """Own the closed origin and retry identity for native work-item creation."""

    @staticmethod
    def _uuid_value(value, *, field_name):
        if not isinstance(value, (str, uuid.UUID)):
            raise WorkItemCreationIntentConflict(f"{field_name} is invalid")
        try:
            return uuid.UUID(str(value))
        except (TypeError, ValueError, AttributeError) as error:
            raise WorkItemCreationIntentConflict(f"{field_name} is invalid") from error

    @staticmethod
    def _integer_value(value, *, field_name):
        if isinstance(value, bool):
            raise WorkItemCreationIntentConflict(f"{field_name} is invalid")
        if isinstance(value, int):
            return value
        if isinstance(value, str):
            try:
                return int(value)
            except ValueError as error:
                raise WorkItemCreationIntentConflict(f"{field_name} is invalid") from error
        raise WorkItemCreationIntentConflict(f"{field_name} is invalid")

    @staticmethod
    def payload_hash(payload, origin):
        canonical = json.dumps(
            {"payload": payload, "origin": origin},
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @staticmethod
    def normalize_origin(origin):
        if not isinstance(origin, dict):
            raise WorkItemCreationIntentConflict("creation_origin must be an object")
        kind = origin.get("kind")
        if kind == WorkItemCreationIntent.OriginKind.CONVERSATION:
            try:
                channel_id = WorkItemCreationIntents._uuid_value(origin["channel_id"], field_name="channel_id")
                thread_root_id = origin.get("thread_root_id")
                thread_root_id = (
                    WorkItemCreationIntents._uuid_value(thread_root_id, field_name="thread_root_id")
                    if thread_root_id is not None
                    else None
                )
            except KeyError as error:
                raise WorkItemCreationIntentConflict("conversation origin identifiers are invalid") from error
            return {
                "kind": kind,
                "channel_id": str(channel_id),
                "thread_root_id": str(thread_root_id) if thread_root_id else None,
            }
        if kind == WorkItemCreationIntent.OriginKind.WORK_MAP:
            try:
                work_map_id = WorkItemCreationIntents._uuid_value(origin["work_map_id"], field_name="work_map_id")
                generation = WorkItemCreationIntents._integer_value(origin["generation"], field_name="generation")
                placement_id = WorkItemCreationIntents._uuid_value(
                    origin["placement_id"], field_name="placement_id"
                )
                element_id = origin["element_id"]
            except KeyError as error:
                raise WorkItemCreationIntentConflict("work map origin identifiers are invalid") from error
            if not isinstance(element_id, str) or generation < 0 or not element_id.strip() or len(element_id) > 255:
                raise WorkItemCreationIntentConflict("work map origin identifiers are invalid")
            return {
                "kind": kind,
                "work_map_id": str(work_map_id),
                "generation": generation,
                "placement_id": str(placement_id),
                "element_id": element_id,
            }
        raise WorkItemCreationIntentConflict("creation_origin kind is unsupported")

    @staticmethod
    def _conversation_origin(*, origin, actor, project):
        channel = (
            Channel.objects.select_for_update()
            .filter(
                id=origin["channel_id"],
                workspace_id=project.workspace_id,
                deleted_at__isnull=True,
            )
            .first()
        )
        if channel is None or not WorkspaceMember.objects.filter(
            workspace_id=project.workspace_id,
            member=actor,
            is_active=True,
            role__in=(ROLE.ADMIN.value, ROLE.MEMBER.value),
        ).exists():
            raise WorkItemCreationOriginDenied("conversation is unavailable")

        thread_root = None
        if origin["thread_root_id"]:
            thread_root = (
                Message.objects.select_for_update()
                .filter(
                    id=origin["thread_root_id"],
                    channel=channel,
                    parent__isnull=True,
                    deleted_at__isnull=True,
                )
                .first()
            )
            if thread_root is None:
                raise WorkItemCreationOriginDenied("conversation thread is unavailable")
        return channel, thread_root

    @staticmethod
    def _work_map_origin(*, origin, actor, project, slug, check_generation=True):
        from plane.app.views.work_map.base import visible_work_maps

        project_membership = ProjectMember.objects.filter(
            project=project,
            member=actor,
            is_active=True,
        )
        if not (
            project_membership.filter(role__in=(ROLE.ADMIN.value, ROLE.MEMBER.value)).exists()
            or (
                project_membership.exists()
                and WorkspaceMember.objects.filter(
                    workspace_id=project.workspace_id,
                    member=actor,
                    role=ROLE.ADMIN.value,
                    is_active=True,
                ).exists()
            )
        ):
            raise WorkItemCreationOriginDenied("work map is unavailable")
        visible_id = (
            visible_work_maps(user=actor, slug=slug, project_id=project.id)
            .filter(id=origin["work_map_id"])
            .values_list("id", flat=True)
            .first()
        )
        document = Document.objects.select_for_update().filter(id=visible_id).first()
        if document is None or document.is_locked or document.archived_at is not None:
            raise WorkItemCreationOriginDenied("work map is unavailable")
        work_map = WorkMap.objects.select_for_update().filter(document_id=document.id).first()
        if work_map is None or (check_generation and work_map.generation != origin["generation"]):
            raise WorkItemCreationIntentConflict("work map generation is stale")
        return document, work_map

    @staticmethod
    def validate_origin(*, origin, actor, project, slug, check_generation=True):
        origin = WorkItemCreationIntents.normalize_origin(origin)
        if origin["kind"] == WorkItemCreationIntent.OriginKind.CONVERSATION:
            WorkItemCreationIntents._conversation_origin(origin=origin, actor=actor, project=project)
        else:
            WorkItemCreationIntents._work_map_origin(
                origin=origin,
                actor=actor,
                project=project,
                slug=slug,
                check_generation=check_generation,
            )
        return origin

    @staticmethod
    def origin_for_intent(intent):
        if intent.origin_kind == WorkItemCreationIntent.OriginKind.CONVERSATION:
            return {
                "kind": intent.origin_kind,
                "channel_id": str(intent.channel_id),
                "thread_root_id": str(intent.thread_root_id) if intent.thread_root_id else None,
            }
        return {
            "kind": intent.origin_kind,
            "work_map_id": str(intent.work_map_id),
            "generation": intent.work_map_generation,
            "placement_id": str(intent.placement_id),
            "element_id": intent.element_id,
        }

    @staticmethod
    def reserve(*, intent_id, origin, actor, project, payload_hash, slug):
        origin = WorkItemCreationIntents.normalize_origin(origin)
        field_values = {
            "origin_kind": origin["kind"],
            "channel_id": uuid.UUID(origin["channel_id"]) if origin.get("channel_id") else None,
            "thread_root_id": uuid.UUID(origin["thread_root_id"]) if origin.get("thread_root_id") else None,
            "work_map_id": uuid.UUID(origin["work_map_id"]) if origin.get("work_map_id") else None,
            "work_map_generation": origin.get("generation"),
            "placement_id": uuid.UUID(origin["placement_id"]) if origin.get("placement_id") else None,
            "element_id": origin.get("element_id"),
        }
        try:
            intent = WorkItemCreationIntent.objects.select_for_update().get(id=intent_id)
            created = False
        except WorkItemCreationIntent.DoesNotExist:
            WorkItemCreationIntents.validate_origin(
                origin=origin,
                actor=actor,
                project=project,
                slug=slug,
                check_generation=True,
            )
            try:
                with transaction.atomic():
                    intent = WorkItemCreationIntent.objects.create(
                        id=intent_id,
                        project=project,
                        workspace_id=project.workspace_id,
                        payload_hash=payload_hash,
                        created_by_id=actor.id,
                        updated_by_id=actor.id,
                        **field_values,
                    )
                created = True
            except IntegrityError:
                intent = WorkItemCreationIntent.objects.select_for_update().filter(id=intent_id).first()
                if intent is None:
                    raise WorkItemCreationIntentConflict("intent_id could not be reserved")
                created = False

        if (
            intent.created_by_id != actor.id
            or intent.project_id != project.id
            or intent.payload_hash != payload_hash
            or any(getattr(intent, key) != value for key, value in field_values.items())
        ):
            raise WorkItemCreationIntentConflict("intent_id was already used with a different origin or payload")
        if not created:
            WorkItemCreationIntents.validate_origin(
                origin=origin,
                actor=actor,
                project=project,
                slug=slug,
                check_generation=False,
            )
        if not created and intent.issue_id is None:
            raise WorkItemCreationIntentConflict("intent_id is still being created")
        return intent, created

    @staticmethod
    def complete(*, intent, issue, origin, actor, project, slug):
        if intent.origin_kind == WorkItemCreationIntent.OriginKind.CONVERSATION:
            channel, thread_root = WorkItemCreationIntents._conversation_origin(
                origin=origin,
                actor=actor,
                project=project,
            )
            message = Message(
                channel=channel,
                parent=thread_root,
                content="",
                client_id=intent.id,
            )
            message.save(created_by_id=actor.id)
            intent.creation_message = message
            intent.origin_finalized_at = timezone.now()
            intent.save(update_fields=["creation_message", "origin_finalized_at", "updated_at"])
            return WorkItemCreationIntents.projection(intent)

        document, work_map = WorkItemCreationIntents._work_map_origin(
            origin=origin,
            actor=actor,
            project=project,
            slug=slug,
        )
        binding = (
            WorkMapBinding.all_objects.select_for_update()
            .filter(
                work_map=work_map,
                source_kind=WorkMapBinding.SourceKind.WORK_ITEM,
                source_id=issue.id,
            )
            .order_by("-created_at")
            .first()
        )
        if binding is None:
            binding = WorkMapBinding.objects.create(
                work_map=work_map,
                source_kind=WorkMapBinding.SourceKind.WORK_ITEM,
                source_id=issue.id,
                node_key=uuid.uuid4(),
                created_by=actor,
            )
        placement, _ = WorkMapBindingPlacement.objects.get_or_create(
            work_map=work_map,
            created_by=actor,
            placement_id=intent.placement_id,
            defaults={"binding": binding},
        )
        if placement.binding_id != binding.id:
            raise WorkItemCreationIntentConflict("work map placement is already bound")
        return WorkItemCreationIntents.projection(intent)

    @staticmethod
    def ensure_conversation_source_link(*, request, slug, intent):
        message = intent.creation_message
        if message is None:
            raise WorkItemCreationIntentConflict("conversation creation record is unavailable")
        source_params = {
            "chat_channel": str(message.channel_id),
            "chat_message": str(message.id),
        }
        if intent.thread_root_id:
            source_params["chat_thread"] = str(intent.thread_root_id)
        source_query = urlencode(source_params)
        source_url = f"{base_host(request=request, is_app=True).rstrip('/')}/{slug}?{source_query}"
        if IssueLink.objects.filter(issue_id=intent.issue_id, url=source_url).exists():
            return
        IssueLink.objects.create(
            project_id=intent.project_id,
            issue_id=intent.issue_id,
            title="Conversation activity",
            url=source_url,
            metadata={
                "origin_kind": "conversation",
                "channel_id": str(message.channel_id),
                "message_id": str(message.id),
            },
            created_by_id=intent.created_by_id,
            updated_by_id=intent.created_by_id,
        )

    @staticmethod
    def projection(intent):
        if intent.origin_kind == WorkItemCreationIntent.OriginKind.CONVERSATION:
            return {
                "kind": intent.origin_kind,
                "channel_id": str(intent.channel_id),
                "thread_root_id": str(intent.thread_root_id) if intent.thread_root_id else None,
                "message_id": str(intent.creation_message_id) if intent.creation_message_id else None,
            }
        binding = WorkMapBinding.objects.filter(
            work_map_id=intent.work_map_id,
            source_kind=WorkMapBinding.SourceKind.WORK_ITEM,
            source_id=intent.issue_id,
            deleted_at__isnull=True,
        ).first()
        return {
            "kind": intent.origin_kind,
            "work_map_id": str(intent.work_map_id),
            "generation": intent.work_map_generation,
            "placement_id": str(intent.placement_id),
            "element_id": intent.element_id,
            "node_key": str(binding.node_key) if binding else None,
            "status": "complete" if intent.origin_finalized_at else "pending_scene",
        }

    @staticmethod
    def finalize_work_map_origins(*, work_map, scene, actor, source_url_for):
        from plane.utils.work_map_scene import persisted_scene_node_key_for_element

        intents = list(
            WorkItemCreationIntent.objects.select_for_update()
            .filter(
                work_map=work_map,
                origin_kind=WorkItemCreationIntent.OriginKind.WORK_MAP,
                origin_finalized_at__isnull=True,
                issue__isnull=False,
            )
            .select_related("issue")
        )
        finalized = []
        for intent in intents:
            node_key = persisted_scene_node_key_for_element(scene, intent.element_id)
            if node_key is None:
                continue
            binding = (
                WorkMapBinding.objects.select_for_update()
                .filter(
                    work_map=work_map,
                    source_kind=WorkMapBinding.SourceKind.WORK_ITEM,
                    source_id=intent.issue_id,
                    deleted_at__isnull=True,
                )
                .first()
            )
            if binding is None or binding.node_key != node_key:
                raise WorkItemCreationIntentConflict("work map origin carrier is unavailable")
            source_url = source_url_for(intent)
            link = IssueLink.objects.filter(issue_id=intent.issue_id, url=source_url).first()
            if link is None:
                IssueLink.objects.create(
                    project_id=intent.project_id,
                    issue_id=intent.issue_id,
                    title="Work map object",
                    url=source_url,
                    metadata={
                        "origin_kind": WorkItemCreationIntent.OriginKind.WORK_MAP,
                        "work_map_id": str(work_map.pk),
                        "element_id": intent.element_id,
                    },
                    created_by_id=actor.id,
                    updated_by_id=actor.id,
                )
            intent.origin_finalized_at = timezone.now()
            intent.save(update_fields=["origin_finalized_at", "updated_at"])
            finalized.append(intent.id)
        return finalized
