# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

import json
import math
import re
import time

from plane.app.permissions.base import ROLE
from plane.api.services.bridge_transport import (
    BridgeTransportCanonicalInvalid,
    BridgeTransportConflict,
    BridgeTransportForbidden,
    BridgeTransportMalformed,
    BridgeTransportNotFound,
    BridgeTransportUnavailable,
    bridge_url,
    configured_webhook,
    post_signed,
)
from plane.db.models import BotTypeEnum, WorkspaceAgentMembership, WorkspaceMember
from plane.utils.url_security import pinned_fetch

MAX_PROFILE_RESPONSE_BYTES = 64 * 1024
MAX_PROFILE_FIELD_LENGTH = 8 * 1024
MAX_PROFILE_DESCRIPTION_BYTES = 8 * 1024
MAX_PROFILE_INSTRUCTIONS_BYTES = 8 * 1024
MAX_PROFILE_SKILL_ITEMS = 256
MAX_PROFILE_SKILL_NAME_LENGTH = 255
MAX_PROFILE_SKILL_FIELD_LENGTH = 8 * 1024
MAX_PROFILE_SKILLS_BYTES = 32 * 1024
PROFILE_REVISION = re.compile(r"[0-9a-f]{64}")
PROFILE_OWNER_ID = re.compile(r"[0-9a-f]{64}")
PROFILE_PENDING_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
PROFILE_SKILL_ID = re.compile(r"[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*")
MAX_PROFILE_SKILL_ID_BYTES = 256
MAX_PROFILE_SKILL_CONTENT_BYTES = 48 * 1024
MAX_PROFILE_PENDING_ITEMS = 100
MAX_PROFILE_PENDING_ACTION_LENGTH = 64
MAX_PROFILE_PENDING_SUMMARY_LENGTH = 1024
MAX_PROFILE_PENDING_ORIGIN_LENGTH = 64


class AgentProfileError(ValueError):
    pass


class AgentProfileForbidden(AgentProfileError):
    pass


class AgentProfileNotFound(AgentProfileError):
    pass


class AgentProfileUnavailable(AgentProfileError):
    pass


class AgentProfileMalformed(AgentProfileError):
    pass


class AgentProfileInvalidRequest(AgentProfileError):
    pass


class AgentProfileConflict(AgentProfileError):
    pass


class AgentProfileCanonicalInvalid(AgentProfileError):
    pass


class AgentProfiles:
    @staticmethod
    def read(*, workspace, requester, user_id):
        value = AgentProfiles._request(
            workspace=workspace, requester=requester, user_id=user_id, operation="agent_profile.read"
        )
        return AgentProfiles._projection(value)

    @staticmethod
    def write(*, workspace, requester, user_id, description, expected_revision):
        if not isinstance(description, str) or "\x00" in description:
            raise AgentProfileInvalidRequest
        try:
            if len(description.encode("utf-8")) > MAX_PROFILE_DESCRIPTION_BYTES:
                raise AgentProfileInvalidRequest
        except UnicodeEncodeError as error:
            raise AgentProfileInvalidRequest from error
        if not isinstance(expected_revision, str) or not PROFILE_REVISION.fullmatch(expected_revision):
            raise AgentProfileInvalidRequest
        value = AgentProfiles._request(
            workspace=workspace,
            requester=requester,
            user_id=user_id,
            operation="agent_profile.write",
            description=description,
            expected_revision=expected_revision,
        )
        return AgentProfiles._write_projection(value)

    @staticmethod
    def read_model(*, workspace, requester, user_id):
        value = AgentProfiles._request(
            workspace=workspace,
            requester=requester,
            user_id=user_id,
            operation="agent_profile.model.read",
        )
        return AgentProfiles._model_projection(value)

    @staticmethod
    def write_model(*, workspace, requester, user_id, provider, model, expected_revision):
        for value in (provider, model):
            if value is not None and (not isinstance(value, str) or "\x00" in value):
                raise AgentProfileInvalidRequest
            if value is not None:
                try:
                    if len(value.encode("utf-8")) > MAX_PROFILE_FIELD_LENGTH:
                        raise AgentProfileInvalidRequest
                except UnicodeEncodeError as error:
                    raise AgentProfileInvalidRequest from error
        if not isinstance(expected_revision, str) or not PROFILE_REVISION.fullmatch(expected_revision):
            raise AgentProfileInvalidRequest
        value = AgentProfiles._request(
            workspace=workspace,
            requester=requester,
            user_id=user_id,
            operation="agent_profile.model.write",
            provider=provider,
            model=model,
            expected_revision=expected_revision,
        )
        return AgentProfiles._model_projection(value)

    @staticmethod
    def read_skill(*, workspace, requester, user_id, owner_id, skill_id, expected_revision):
        AgentProfiles._validate_skill_target(owner_id, skill_id, expected_revision)
        value = AgentProfiles._request(
            workspace=workspace,
            requester=requester,
            user_id=user_id,
            operation="agent_profile.skill.read",
            owner_id=owner_id,
            skill_id=skill_id,
            expected_revision=expected_revision,
        )
        return AgentProfiles._skill_read_projection(
            value, owner_id=owner_id, skill_id=skill_id, expected_revision=expected_revision
        )

    @staticmethod
    def edit_skill(*, workspace, requester, user_id, owner_id, skill_id, expected_revision, content):
        AgentProfiles._validate_skill_target(owner_id, skill_id, expected_revision)
        AgentProfiles._validate_skill_content(content)
        value = AgentProfiles._request(
            workspace=workspace,
            requester=requester,
            user_id=user_id,
            operation="agent_profile.skill.edit",
            owner_id=owner_id,
            skill_id=skill_id,
            expected_revision=expected_revision,
            content=content,
        )
        return AgentProfiles._skill_mutation_projection(
            value, owner_id=owner_id, skill_id=skill_id, operation="edit", expected_revision=expected_revision
        )

    @staticmethod
    def pending_skills(*, workspace, requester, user_id, pending_id=None):
        if pending_id is not None and not PROFILE_PENDING_ID.fullmatch(pending_id):
            raise AgentProfileInvalidRequest
        value = AgentProfiles._request(
            workspace=workspace,
            requester=requester,
            user_id=user_id,
            operation="agent_profile.skill.pending",
            pending_id=pending_id,
        )
        return AgentProfiles._skill_pending_projection(value, pending_id=pending_id)

    @staticmethod
    def approve_skill(
        *, workspace, requester, user_id, pending_id, owner_id, skill_id, expected_revision, content_revision
    ):
        if not PROFILE_PENDING_ID.fullmatch(pending_id):
            raise AgentProfileInvalidRequest
        AgentProfiles._validate_skill_target(owner_id, skill_id, expected_revision)
        if not PROFILE_REVISION.fullmatch(content_revision):
            raise AgentProfileInvalidRequest
        value = AgentProfiles._request(
            workspace=workspace,
            requester=requester,
            user_id=user_id,
            operation="agent_profile.skill.approve",
            pending_id=pending_id,
            owner_id=owner_id,
            skill_id=skill_id,
            expected_revision=expected_revision,
            content_revision=content_revision,
        )
        return AgentProfiles._skill_mutation_projection(
            value,
            owner_id=owner_id,
            skill_id=skill_id,
            operation="approve",
            expected_revision=expected_revision,
            pending_id=pending_id,
        )

    @staticmethod
    def reject_skill(*, workspace, requester, user_id, pending_id, owner_id, skill_id, expected_revision):
        if not PROFILE_PENDING_ID.fullmatch(pending_id):
            raise AgentProfileInvalidRequest
        AgentProfiles._validate_skill_target(owner_id, skill_id, expected_revision)
        value = AgentProfiles._request(
            workspace=workspace,
            requester=requester,
            user_id=user_id,
            operation="agent_profile.skill.reject",
            pending_id=pending_id,
            owner_id=owner_id,
            skill_id=skill_id,
            expected_revision=expected_revision,
        )
        return AgentProfiles._skill_mutation_projection(
            value,
            owner_id=owner_id,
            skill_id=skill_id,
            operation="reject",
            expected_revision=expected_revision,
            pending_id=pending_id,
        )

    @staticmethod
    def _request(
        *,
        workspace,
        requester,
        user_id,
        operation,
        description=None,
        provider=None,
        model=None,
        expected_revision=None,
        owner_id=None,
        skill_id=None,
        content=None,
        pending_id=None,
        content_revision=None,
    ):
        is_write = operation in {
            "agent_profile.write",
            "agent_profile.model.write",
            "agent_profile.skill.edit",
            "agent_profile.skill.approve",
            "agent_profile.skill.reject",
        }
        requires_admin = is_write or operation == "agent_profile.skill.pending"
        member_query = WorkspaceMember.objects.filter(workspace=workspace, member=requester, is_active=True)
        authorized = member_query.filter(role=ROLE.ADMIN.value).exists() if requires_admin else member_query.exists()
        if not getattr(requester, "is_active", False) or not authorized:
            raise AgentProfileForbidden
        if requires_admin and getattr(requester, "is_bot", False):
            raise AgentProfileForbidden

        membership = (
            WorkspaceAgentMembership.objects.filter(workspace=workspace, user_id=user_id).select_related("user").first()
        )
        if (
            membership is None
            or not membership.user.is_active
            or not membership.user.is_bot
            or membership.user.bot_type != BotTypeEnum.AGENT
            or not WorkspaceMember.objects.filter(workspace=workspace, member_id=user_id, is_active=True).exists()
        ):
            raise AgentProfileNotFound

        webhook = AgentProfiles._webhook(workspace)
        target_url = AgentProfiles._profile_url(webhook)
        payload = {
            "version": 1,
            "operation": operation,
            "webhook_id": str(webhook.id),
            "workspace_slug": workspace.slug,
            "user_id": str(membership.user_id),
            "agent_key": membership.agent_key,
            "issued_at": int(time.time()),
        }
        if operation == "agent_profile.write":
            payload.update(description=description, expected_revision=expected_revision)
        elif operation == "agent_profile.model.write":
            payload.update(provider=provider, model=model, expected_revision=expected_revision)
        elif operation in {"agent_profile.skill.read", "agent_profile.skill.edit"}:
            payload.update(owner_id=owner_id, skill_id=skill_id, expected_revision=expected_revision)
            if operation == "agent_profile.skill.edit":
                payload.update(content=content)
        elif operation == "agent_profile.skill.pending":
            if pending_id is not None:
                payload.update(pending_id=pending_id)
        elif operation in {"agent_profile.skill.approve", "agent_profile.skill.reject"}:
            payload.update(
                pending_id=pending_id,
                owner_id=owner_id,
                skill_id=skill_id,
                expected_revision=expected_revision,
            )
            if operation == "agent_profile.skill.approve":
                payload.update(content_revision=content_revision)
        try:
            return post_signed(
                webhook=webhook,
                target_url=target_url,
                payload=payload,
                max_response_bytes=MAX_PROFILE_RESPONSE_BYTES,
                fetch=pinned_fetch,
            )
        except BridgeTransportNotFound as error:
            raise AgentProfileNotFound from error
        except BridgeTransportConflict as error:
            if is_write or operation == "agent_profile.skill.read":
                raise AgentProfileConflict from error
            raise AgentProfileUnavailable from error
        except BridgeTransportForbidden as error:
            raise AgentProfileUnavailable from error
        except BridgeTransportCanonicalInvalid as error:
            raise AgentProfileCanonicalInvalid from error
        except BridgeTransportMalformed as error:
            raise AgentProfileMalformed from error
        except BridgeTransportUnavailable as error:
            raise AgentProfileUnavailable from error

    @staticmethod
    def _webhook(workspace):
        try:
            return configured_webhook(workspace)
        except BridgeTransportUnavailable as error:
            raise AgentProfileUnavailable from error

    @staticmethod
    def _profile_url(webhook):
        try:
            return bridge_url(webhook, "agent-profile")
        except BridgeTransportUnavailable as error:
            raise AgentProfileUnavailable from error

    @staticmethod
    def _projection(raw_body):
        if not isinstance(raw_body, dict) or set(raw_body) != {
            "label",
            "description",
            "model",
            "revision",
            "instructions",
            "skills",
        }:
            raise AgentProfileMalformed
        label = raw_body["label"]
        description = raw_body["description"]
        model = raw_body["model"]
        revision = raw_body["revision"]
        instructions = raw_body["instructions"]
        skills = raw_body["skills"]
        if (
            not isinstance(label, str)
            or not isinstance(description, str)
            or len(label) > MAX_PROFILE_FIELD_LENGTH
            or len(description) > MAX_PROFILE_FIELD_LENGTH
            or (model is not None and (not isinstance(model, str) or len(model) > MAX_PROFILE_FIELD_LENGTH))
            or not isinstance(revision, str)
            or not PROFILE_REVISION.fullmatch(revision)
        ):
            raise AgentProfileMalformed
        if not isinstance(instructions, dict) or set(instructions) != {"exists", "content", "truncated"}:
            raise AgentProfileMalformed
        instructions_exists = instructions["exists"]
        instructions_content = instructions["content"]
        instructions_truncated = instructions["truncated"]
        if (
            not isinstance(instructions_exists, bool)
            or not isinstance(instructions_content, str)
            or not isinstance(instructions_truncated, bool)
        ):
            raise AgentProfileMalformed
        try:
            if len(instructions_content.encode("utf-8")) > MAX_PROFILE_INSTRUCTIONS_BYTES:
                raise AgentProfileMalformed
        except UnicodeEncodeError as error:
            raise AgentProfileMalformed from error
        if not instructions_exists and (instructions_content or instructions_truncated):
            raise AgentProfileMalformed
        if not isinstance(skills, dict) or set(skills) != {"items", "truncated"}:
            raise AgentProfileMalformed
        skill_items = skills["items"]
        skills_truncated = skills["truncated"]
        if (
            not isinstance(skill_items, list)
            or len(skill_items) > MAX_PROFILE_SKILL_ITEMS
            or not isinstance(skills_truncated, bool)
        ):
            raise AgentProfileMalformed
        for skill in skill_items:
            if not isinstance(skill, dict) or not {"name", "description", "category", "editable"}.issubset(skill):
                raise AgentProfileMalformed
            name = skill["name"]
            skill_description = skill["description"]
            category = skill["category"]
            if (
                not isinstance(name, str)
                or not name.strip()
                or len(name) > MAX_PROFILE_SKILL_NAME_LENGTH
                or not isinstance(skill_description, str)
                or len(skill_description) > MAX_PROFILE_SKILL_FIELD_LENGTH
                or (
                    category is not None
                    and (not isinstance(category, str) or len(category) > MAX_PROFILE_SKILL_FIELD_LENGTH)
                )
            ):
                raise AgentProfileMalformed
            if skill["editable"] is True:
                if set(skill) != {"name", "description", "category", "editable", "owner_id", "skill_id", "revision"}:
                    raise AgentProfileMalformed
                owner_id = skill["owner_id"]
                skill_id = skill["skill_id"]
                skill_revision = skill["revision"]
                if (
                    not isinstance(owner_id, str)
                    or not PROFILE_OWNER_ID.fullmatch(owner_id)
                    or not isinstance(skill_id, str)
                    or not PROFILE_SKILL_ID.fullmatch(skill_id)
                    or len(skill_id.encode("utf-8")) > MAX_PROFILE_SKILL_ID_BYTES
                    or not isinstance(skill_revision, str)
                    or not PROFILE_REVISION.fullmatch(skill_revision)
                ):
                    raise AgentProfileMalformed
            elif skill["editable"] is False:
                if set(skill) != {"name", "description", "category", "editable", "item_id"}:
                    raise AgentProfileMalformed
                if not isinstance(skill["item_id"], str) or not skill["item_id"]:
                    raise AgentProfileMalformed
            else:
                raise AgentProfileMalformed
        try:
            if (
                len(json.dumps(skills, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
                > MAX_PROFILE_SKILLS_BYTES
            ):
                raise AgentProfileMalformed
        except (TypeError, UnicodeEncodeError) as error:
            raise AgentProfileMalformed from error
        return {
            "label": label,
            "description": description,
            "model": model,
            "revision": revision,
            "instructions": {
                "exists": instructions_exists,
                "content": instructions_content,
                "truncated": instructions_truncated,
            },
            "skills": {
                "items": skill_items,
                "truncated": skills_truncated,
            },
        }

    @staticmethod
    def _write_projection(raw_body):
        if not isinstance(raw_body, dict) or set(raw_body) != {"description", "revision"}:
            raise AgentProfileMalformed
        description = raw_body["description"]
        revision = raw_body["revision"]
        if (
            not isinstance(description, str)
            or len(description) > MAX_PROFILE_FIELD_LENGTH
            or not isinstance(revision, str)
            or not PROFILE_REVISION.fullmatch(revision)
        ):
            raise AgentProfileMalformed
        return {"description": description, "revision": revision}

    @staticmethod
    def _model_projection(raw_body):
        if not isinstance(raw_body, dict) or set(raw_body) != {"provider", "model", "revision"}:
            raise AgentProfileMalformed
        provider = raw_body["provider"]
        model = raw_body["model"]
        revision = raw_body["revision"]
        if (
            (provider is not None and (not isinstance(provider, str) or len(provider) > MAX_PROFILE_FIELD_LENGTH))
            or (model is not None and (not isinstance(model, str) or len(model) > MAX_PROFILE_FIELD_LENGTH))
            or not isinstance(revision, str)
            or not PROFILE_REVISION.fullmatch(revision)
        ):
            raise AgentProfileMalformed
        return {"provider": provider, "model": model, "revision": revision}

    @staticmethod
    def _validate_skill_target(owner_id, skill_id, expected_revision):
        if (
            not isinstance(owner_id, str)
            or not PROFILE_OWNER_ID.fullmatch(owner_id)
            or not isinstance(skill_id, str)
            or not PROFILE_SKILL_ID.fullmatch(skill_id)
            or len(skill_id.encode("utf-8")) > MAX_PROFILE_SKILL_ID_BYTES
            or not isinstance(expected_revision, str)
            or not PROFILE_REVISION.fullmatch(expected_revision)
        ):
            raise AgentProfileInvalidRequest

    @staticmethod
    def _validate_skill_content(content):
        if not isinstance(content, str) or not content or "\x00" in content:
            raise AgentProfileInvalidRequest
        try:
            if len(content.encode("utf-8")) > MAX_PROFILE_SKILL_CONTENT_BYTES:
                raise AgentProfileInvalidRequest
        except UnicodeEncodeError as error:
            raise AgentProfileInvalidRequest from error

    @staticmethod
    def _skill_identity_projection(raw_body, *, owner_id=None, skill_id=None):
        if not isinstance(raw_body, dict):
            raise AgentProfileMalformed
        actual_owner = raw_body.get("owner_id")
        actual_skill = raw_body.get("skill_id")
        if (
            not isinstance(actual_owner, str)
            or not PROFILE_OWNER_ID.fullmatch(actual_owner)
            or not isinstance(actual_skill, str)
            or not PROFILE_SKILL_ID.fullmatch(actual_skill)
            or len(actual_skill.encode("utf-8")) > MAX_PROFILE_SKILL_ID_BYTES
            or (owner_id is not None and actual_owner != owner_id)
            or (skill_id is not None and actual_skill != skill_id)
        ):
            raise AgentProfileMalformed
        return actual_owner, actual_skill

    @staticmethod
    def _skill_read_projection(raw_body, *, owner_id, skill_id, expected_revision):
        if not isinstance(raw_body, dict) or set(raw_body) != {"owner_id", "skill_id", "revision", "content"}:
            raise AgentProfileMalformed
        AgentProfiles._skill_identity_projection(raw_body, owner_id=owner_id, skill_id=skill_id)
        content = raw_body["content"]
        if (
            not isinstance(content, str)
            or not content
            or "\x00" in content
            or not isinstance(raw_body["revision"], str)
            or not PROFILE_REVISION.fullmatch(raw_body["revision"])
            or raw_body["revision"] != expected_revision
        ):
            raise AgentProfileMalformed
        AgentProfiles._validate_skill_content(content)
        return {"owner_id": owner_id, "skill_id": skill_id, "revision": raw_body["revision"], "content": content}

    @staticmethod
    def _skill_mutation_projection(raw_body, *, owner_id, skill_id, operation, expected_revision, pending_id=None):
        if not isinstance(raw_body, dict) or not isinstance(raw_body.get("success"), bool):
            raise AgentProfileMalformed
        AgentProfiles._skill_identity_projection(raw_body, owner_id=owner_id, skill_id=skill_id)
        if pending_id is not None and raw_body.get("pending_id") != pending_id:
            raise AgentProfileMalformed
        if not raw_body["success"]:
            if raw_body.get("stale") is True:
                raise AgentProfileConflict
            result = {"success": False, "owner_id": owner_id, "skill_id": skill_id, "error": "skill_operation_failed"}
            if pending_id is not None:
                result["pending_id"] = pending_id
            return result
        if operation == "edit" and raw_body.get("staged") is True:
            content_revision = raw_body.get("content_revision")
            if (
                not isinstance(raw_body.get("pending_id"), str)
                or not PROFILE_PENDING_ID.fullmatch(raw_body["pending_id"])
                or raw_body.get("expected_revision") != expected_revision
                or not isinstance(content_revision, str)
                or not PROFILE_REVISION.fullmatch(content_revision)
            ):
                raise AgentProfileMalformed
            return {
                "success": True,
                "staged": True,
                "pending_id": raw_body["pending_id"],
                "owner_id": owner_id,
                "skill_id": skill_id,
                "expected_revision": expected_revision,
                "content_revision": content_revision,
            }
        if operation == "reject":
            if raw_body.get("rejected") is not True:
                raise AgentProfileMalformed
            return {
                "success": True,
                "rejected": True,
                "pending_id": pending_id,
                "owner_id": owner_id,
                "skill_id": skill_id,
            }
        revision = raw_body.get("revision")
        if not isinstance(revision, str) or not PROFILE_REVISION.fullmatch(revision):
            raise AgentProfileMalformed
        result = {"success": True, "owner_id": owner_id, "skill_id": skill_id, "revision": revision}
        if pending_id is not None:
            result["pending_id"] = pending_id
        return result

    @staticmethod
    def _skill_pending_item_projection(value):
        if not isinstance(value, dict) or set(value) != {
            "id",
            "action",
            "summary",
            "origin",
            "created_at",
            "owner_id",
            "skill_id",
            "expected_revision",
            "content_revision",
        }:
            raise AgentProfileMalformed
        if (
            not isinstance(value["id"], str)
            or not PROFILE_PENDING_ID.fullmatch(value["id"])
            or not isinstance(value["action"], str)
            or not value["action"]
            or len(value["action"]) > MAX_PROFILE_PENDING_ACTION_LENGTH
            or not isinstance(value["summary"], str)
            or len(value["summary"]) > MAX_PROFILE_PENDING_SUMMARY_LENGTH
            or not isinstance(value["origin"], str)
            or len(value["origin"]) > MAX_PROFILE_PENDING_ORIGIN_LENGTH
            or not isinstance(value["created_at"], (int, float))
            or isinstance(value["created_at"], bool)
            or not math.isfinite(value["created_at"])
            or not isinstance(value["owner_id"], str)
            or not PROFILE_OWNER_ID.fullmatch(value["owner_id"])
            or not isinstance(value["skill_id"], str)
            or not PROFILE_SKILL_ID.fullmatch(value["skill_id"])
            or len(value["skill_id"].encode("utf-8")) > MAX_PROFILE_SKILL_ID_BYTES
            or not isinstance(value["expected_revision"], str)
            or not PROFILE_REVISION.fullmatch(value["expected_revision"])
            or not isinstance(value["content_revision"], str)
            or not PROFILE_REVISION.fullmatch(value["content_revision"])
        ):
            raise AgentProfileMalformed
        return dict(value)

    @staticmethod
    def _skill_pending_projection(raw_body, *, pending_id=None):
        if not isinstance(raw_body, dict):
            raise AgentProfileMalformed
        if "items" in raw_body:
            if pending_id is not None or (
                set(raw_body) != {"items", "truncated"}
                or not isinstance(raw_body["items"], list)
                or len(raw_body["items"]) > MAX_PROFILE_PENDING_ITEMS
                or not isinstance(raw_body["truncated"], bool)
            ):
                raise AgentProfileMalformed
            return {
                "items": [AgentProfiles._skill_pending_item_projection(item) for item in raw_body["items"]],
                "truncated": raw_body["truncated"],
            }
        if set(raw_body) != {"pending", "review"}:
            raise AgentProfileMalformed
        pending = AgentProfiles._skill_pending_item_projection(raw_body["pending"])
        if pending_id is None or pending["id"] != pending_id:
            raise AgentProfileMalformed
        review = raw_body["review"]
        if (
            not isinstance(review, dict)
            or set(review) != {"diff", "truncated"}
            or not isinstance(review["diff"], str)
            or len(review["diff"].encode("utf-8")) > MAX_PROFILE_SKILL_CONTENT_BYTES
            or not isinstance(review["truncated"], bool)
        ):
            raise AgentProfileMalformed
        return {"pending": pending, "review": review}
