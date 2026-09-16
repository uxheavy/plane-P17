# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import hmac
import json
import uuid
from urllib.parse import urlsplit, urlunsplit

import requests
from django.conf import settings

from plane.db.models import Webhook
from plane.utils.url_security import pinned_fetch


class BridgeTransportError(ValueError):
    pass


class BridgeTransportNotFound(BridgeTransportError):
    pass


class BridgeTransportConflict(BridgeTransportError):
    pass


class BridgeTransportForbidden(BridgeTransportError):
    pass


class BridgeTransportCanonicalInvalid(BridgeTransportError):
    pass


class BridgeTransportMalformed(BridgeTransportError):
    pass


class BridgeTransportUnavailable(BridgeTransportError):
    pass


def configured_webhook(workspace):
    try:
        webhook_id = uuid.UUID(str(getattr(settings, "AGENT_PROFILE_WEBHOOK_ID", "")))
    except (AttributeError, TypeError, ValueError) as error:
        raise BridgeTransportUnavailable from error
    webhook = Webhook.objects.filter(id=webhook_id, workspace=workspace, is_active=True).first()
    if webhook is None:
        raise BridgeTransportUnavailable
    return webhook


def bridge_url(webhook, path):
    try:
        parsed = urlsplit(webhook.url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError
        return urlunsplit((parsed.scheme, parsed.netloc, f"{parsed.path.rstrip('/')}/{path.lstrip('/')}", "", ""))
    except (TypeError, ValueError) as error:
        raise BridgeTransportUnavailable from error


def post_signed(*, webhook, target_url, payload, max_response_bytes, fetch=pinned_fetch):
    body = json.dumps(payload).encode("utf-8")
    signature = hmac.new(webhook.secret_key.encode("utf-8"), body, hashlib.sha256).hexdigest()
    try:
        response = fetch(
            "POST",
            target_url,
            allowed_ips=settings.WEBHOOK_ALLOWED_IPS,
            allowed_hosts=settings.WEBHOOK_ALLOWED_HOSTS,
            headers={"Content-Type": "application/json", "X-Plane-Signature": signature},
            json=payload,
            stream=True,
            timeout=5,
        )
    except (requests.RequestException, ValueError, UnicodeError) as error:
        raise BridgeTransportUnavailable from error

    try:
        if response.status_code == 404:
            raise BridgeTransportNotFound
        if response.status_code == 409:
            raise BridgeTransportConflict
        if response.status_code == 403:
            raise BridgeTransportForbidden
        if response.status_code == 422:
            raise BridgeTransportCanonicalInvalid
        if response.status_code < 200 or response.status_code >= 300:
            raise BridgeTransportUnavailable
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            try:
                if int(content_length) > max_response_bytes:
                    raise BridgeTransportMalformed
            except (TypeError, ValueError) as error:
                raise BridgeTransportMalformed from error
        raw_body = bytearray()
        for chunk in response.iter_content(chunk_size=8192):
            if not chunk:
                continue
            raw_body.extend(chunk)
            if len(raw_body) > max_response_bytes:
                raise BridgeTransportMalformed
        try:
            return json.loads(bytes(raw_body).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BridgeTransportMalformed from error
    except requests.RequestException as error:
        raise BridgeTransportUnavailable from error
    finally:
        response.close()
