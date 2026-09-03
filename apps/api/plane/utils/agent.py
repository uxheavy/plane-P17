# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from contextlib import contextmanager
from typing import Any, Iterator

from django.db import connection, transaction
from django.db.models import Q


def _agent_bot_type() -> str:
    # Resolve after Django model registration; deletion_task is imported while
    # plane.db.models is still being populated.
    from plane.db.models.user import BotTypeEnum

    return BotTypeEnum.AGENT


def is_agent_user(user: Any) -> bool:
    """Return whether a user is a native Plane agent identity."""

    return bool(getattr(user, "is_bot", False) and getattr(user, "bot_type", None) == _agent_bot_type())


def agent_user_q(prefix: str = "") -> Q:
    """Build the query predicate for native Plane agent identities."""

    return Q(**{f"{prefix}is_bot": True, f"{prefix}bot_type": _agent_bot_type()})


def human_or_agent_user_q(prefix: str = "") -> Q:
    """Build the member visibility predicate for humans and native agents."""

    return Q(**{f"{prefix}is_bot": False}) | agent_user_q(prefix)


@contextmanager
def agent_lifecycle() -> Iterator[None]:
    """Run a native-agent lifecycle unit with the database guard enabled."""

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_setting('plane.agent_lifecycle', true)")
            previous = cursor.fetchone()[0] or "off"
            cursor.execute("SELECT set_config('plane.agent_lifecycle', 'on', true)")
        try:
            yield
        except BaseException:
            # The atomic block is already marked for rollback; any SQL here
            # would mask the original database error with InFailedSqlTransaction.
            raise
        else:
            if not transaction.get_rollback():
                with connection.cursor() as cursor:
                    cursor.execute("SELECT set_config('plane.agent_lifecycle', %s, true)", [previous])
