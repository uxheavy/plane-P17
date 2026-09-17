# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

import json
import time
import uuid
from datetime import datetime

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
from plane.api.services.channel import (
    ChannelMessages,
    MessageCursorError,
    MessageThreadNotFound,
    MessageThreadRootRequired,
)
from plane.db.models import WorkspaceAgentMembership, WorkspaceMember
from plane.utils.agent import is_agent_user
from plane.utils.url_security import pinned_fetch


MAX_CONVERSATION_MESSAGES = 50
MAX_CONVERSATION_CONTEXT_BYTES = 64 * 1024
MAX_PROPOSAL_RESPONSE_BYTES = 64 * 1024
MAX_PROPOSAL_TITLE_LENGTH = 255
MAX_PROPOSAL_DESCRIPTION_BYTES = 32 * 1024
MAX_PROPOSAL_ERROR_LENGTH = 64


class ConversationProposalError(ValueError):
    pass


class ConversationProposalForbidden(ConversationProposalError):
    pass


class ConversationProposalNotFound(ConversationProposalError):
    pass


class ConversationProposalUnavailable(ConversationProposalError):
    pass


class ConversationProposalMalformed(ConversationProposalError):
    pass


class ConversationProposalInvalidRequest(ConversationProposalError):
    pass


class ConversationProposalConflict(ConversationProposalError):
    pass


class ConversationProposalTooLarge(ConversationProposalError):
    pass


class ConversationProposalCanonicalInvalid(ConversationProposalError):
    pass


class ConversationProposals:
    @staticmethod
    def submit(*, channel, requester, request_id, agent_user_id, thread_id=None):
        request_id = ConversationProposals._request_id(request_id)
        agent = ConversationProposals._authorize_source(
            channel=channel,
            requester=requester,
            agent_user_id=agent_user_id,
        )
        thread_id = ConversationProposals._thread_id(thread_id)
        context = ConversationProposals._context(channel=channel, requester=requester, thread_id=thread_id)
        payload = ConversationProposals._payload(
            operation="conversation_proposal.submit",
            channel=channel,
            requester=requester,
            agent=agent,
            request_id=request_id,
            thread_id=thread_id,
            context=context,
        )
        return ConversationProposals._request(payload)

    @staticmethod
    def read(*, channel, requester, request_id, agent_user_id, thread_id=None):
        request_id = ConversationProposals._request_id(request_id)
        agent = ConversationProposals._authorize_source(
            channel=channel,
            requester=requester,
            agent_user_id=agent_user_id,
        )
        thread_id = ConversationProposals._thread_id(thread_id)
        ConversationProposals._revalidate_source(
            channel=channel,
            requester=requester,
            thread_id=thread_id,
        )
        payload = ConversationProposals._payload(
            operation="conversation_proposal.read",
            channel=channel,
            requester=requester,
            agent=agent,
            request_id=request_id,
            thread_id=thread_id,
        )
        return ConversationProposals._request(payload)

    @staticmethod
    def _request_id(value):
        try:
            return uuid.UUID(str(value))
        except (TypeError, ValueError) as error:
            raise ConversationProposalInvalidRequest("request_id must be a UUID") from error

    @staticmethod
    def _thread_id(value):
        if value is None or isinstance(value, uuid.UUID):
            return value
        try:
            return uuid.UUID(str(value))
        except (TypeError, ValueError) as error:
            raise ConversationProposalInvalidRequest("thread_id must be a UUID") from error

    @staticmethod
    def _authorize_source(*, channel, requester, agent_user_id):
        if (
            not getattr(requester, "is_active", False)
            or getattr(requester, "is_bot", False)
            or not WorkspaceMember.objects.filter(
                workspace_id=channel.workspace_id,
                member=requester,
                is_active=True,
            ).exists()
        ):
            raise ConversationProposalForbidden("An active human channel member is required")

        membership = (
            WorkspaceAgentMembership.objects.filter(
                workspace_id=channel.workspace_id,
                user_id=agent_user_id,
            )
            .select_related("user")
            .first()
        )
        if (
            membership is None
            or not membership.user.is_active
            or not is_agent_user(membership.user)
            or not WorkspaceMember.objects.filter(
                workspace_id=channel.workspace_id,
                member_id=membership.user_id,
                is_active=True,
            ).exists()
        ):
            raise ConversationProposalNotFound("Agent membership not found")
        return membership

    @staticmethod
    def _context(*, channel, requester, thread_id):
        try:
            if thread_id is None:
                page = ChannelMessages.list_roots(channel=channel, user=requester)
            else:
                page = ChannelMessages.list_thread(channel=channel, root_id=thread_id, user=requester)
        except MessageThreadNotFound as error:
            raise ConversationProposalNotFound("Conversation thread not found") from error
        except MessageThreadRootRequired as error:
            raise ConversationProposalInvalidRequest("thread_id must reference a root message") from error
        except MessageCursorError as error:
            raise ConversationProposalInvalidRequest("Conversation context could not be read") from error

        messages = page["messages"][:MAX_CONVERSATION_MESSAGES]
        context = {
            "channel_id": str(channel.id),
            "thread_id": str(thread_id) if thread_id is not None else None,
            "source_ids": [str(message.id) for message in messages],
            "truncated": page["next_cursor"] is not None,
            "messages": [ConversationProposals._message(message) for message in messages],
        }
        encoded = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
        try:
            if len(encoded.encode("utf-8")) > MAX_CONVERSATION_CONTEXT_BYTES:
                raise ConversationProposalTooLarge("Conversation context exceeds the size limit")
        except UnicodeEncodeError as error:
            raise ConversationProposalMalformed from error
        return encoded

    @staticmethod
    def _revalidate_source(*, channel, requester, thread_id):
        if thread_id is None:
            return
        try:
            ChannelMessages.list_thread(channel=channel, root_id=thread_id, user=requester)
        except MessageThreadNotFound as error:
            raise ConversationProposalNotFound("Conversation thread not found") from error
        except MessageThreadRootRequired as error:
            raise ConversationProposalInvalidRequest("thread_id must reference a root message") from error
        except MessageCursorError as error:
            raise ConversationProposalInvalidRequest("Conversation context could not be read") from error

    @staticmethod
    def _message(message):
        created_at = message.created_at
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        return {
            "id": str(message.id),
            "parent_id": str(message.parent_id) if message.parent_id is not None else None,
            "root_id": str(getattr(message, "_root_id", message.id)),
            "author_id": str(message.created_by_id),
            "author_display_name": message.created_by.display_name,
            "created_at": created_at,
            "content": message.content,
        }

    @staticmethod
    def _payload(*, operation, channel, requester, agent, request_id, thread_id, context=None):
        webhook = configured_webhook(channel.workspace)
        payload = {
            "version": 1,
            "operation": operation,
            "webhook_id": str(webhook.id),
            "workspace_slug": channel.workspace.slug,
            "user_id": str(agent.user_id),
            "agent_key": agent.agent_key,
            "issued_at": int(time.time()),
            "requester_id": str(requester.id),
            "request_id": str(request_id),
            "channel_id": str(channel.id),
            "thread_id": str(thread_id) if thread_id is not None else None,
        }
        if context is not None:
            payload["context"] = context
        return webhook, payload

    @staticmethod
    def _request(payload):
        webhook, payload = payload
        try:
            raw = post_signed(
                webhook=webhook,
                target_url=bridge_url(webhook, "conversation-proposal"),
                payload=payload,
                max_response_bytes=MAX_PROPOSAL_RESPONSE_BYTES,
                fetch=pinned_fetch,
            )
        except BridgeTransportNotFound as error:
            raise ConversationProposalNotFound from error
        except BridgeTransportConflict as error:
            raise ConversationProposalConflict from error
        except BridgeTransportForbidden as error:
            raise ConversationProposalForbidden from error
        except BridgeTransportCanonicalInvalid as error:
            raise ConversationProposalCanonicalInvalid from error
        except BridgeTransportMalformed as error:
            raise ConversationProposalMalformed from error
        except BridgeTransportUnavailable as error:
            raise ConversationProposalUnavailable from error
        return ConversationProposals._response(raw, expected_request_id=payload["request_id"])

    @staticmethod
    def _response(raw, *, expected_request_id):
        if not isinstance(raw, dict) or set(raw) - {"request_id", "status", "result", "error"}:
            raise ConversationProposalMalformed
        if raw.get("request_id") != expected_request_id:
            raise ConversationProposalMalformed
        status = raw.get("status")
        if status not in {"accepted", "processing", "completed", "failed"}:
            raise ConversationProposalMalformed
        result = raw.get("result")
        error = raw.get("error")
        if status == "completed":
            if (
                set(raw) != {"request_id", "status", "result"}
                or not isinstance(result, dict)
                or set(result)
                != {
                    "title",
                    "description_markdown",
                }
            ):
                raise ConversationProposalMalformed
            title = result["title"]
            description = result["description_markdown"]
            if (
                not isinstance(title, str)
                or not isinstance(description, str)
                or not title.strip()
                or not description.strip()
                or "\x00" in title
                or "\x00" in description
            ):
                raise ConversationProposalMalformed
            try:
                title.encode("utf-8")
                if len(title) > MAX_PROPOSAL_TITLE_LENGTH:
                    raise ConversationProposalMalformed
                if len(description.encode("utf-8")) > MAX_PROPOSAL_DESCRIPTION_BYTES:
                    raise ConversationProposalMalformed
            except UnicodeEncodeError as exc:
                raise ConversationProposalMalformed from exc
            return {"request_id": expected_request_id, "status": status, "result": result}
        if status == "failed":
            if set(raw) != {"request_id", "status", "error"} or not isinstance(error, str):
                raise ConversationProposalMalformed
            if not error or len(error) > MAX_PROPOSAL_ERROR_LENGTH or "\x00" in error:
                raise ConversationProposalMalformed
            return {"request_id": expected_request_id, "status": status, "error": error}
        if set(raw) != {"request_id", "status"}:
            raise ConversationProposalMalformed
        return {"request_id": expected_request_id, "status": status}
