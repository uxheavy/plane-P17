# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce

from plane.db.models import Issue


def with_module_issue_counts(queryset):
    """Annotate modules with the issue counts used by module presentations."""
    cancelled_issues = (
        Issue.issue_objects.filter(
            state__group="cancelled",
            issue_module__module_id=OuterRef("pk"),
            issue_module__deleted_at__isnull=True,
        )
        .values("issue_module__module_id")
        .annotate(cnt=Count("pk"))
        .values("cnt")
    )
    completed_issues = (
        Issue.issue_objects.filter(
            state__group="completed",
            issue_module__module_id=OuterRef("pk"),
            issue_module__deleted_at__isnull=True,
        )
        .values("issue_module__module_id")
        .annotate(cnt=Count("pk"))
        .values("cnt")
    )
    started_issues = (
        Issue.issue_objects.filter(
            state__group="started",
            issue_module__module_id=OuterRef("pk"),
            issue_module__deleted_at__isnull=True,
        )
        .values("issue_module__module_id")
        .annotate(cnt=Count("pk"))
        .values("cnt")
    )
    unstarted_issues = (
        Issue.issue_objects.filter(
            state__group="unstarted",
            issue_module__module_id=OuterRef("pk"),
            issue_module__deleted_at__isnull=True,
        )
        .values("issue_module__module_id")
        .annotate(cnt=Count("pk"))
        .values("cnt")
    )
    backlog_issues = (
        Issue.issue_objects.filter(
            state__group="backlog",
            issue_module__module_id=OuterRef("pk"),
            issue_module__deleted_at__isnull=True,
        )
        .values("issue_module__module_id")
        .annotate(cnt=Count("pk"))
        .values("cnt")
    )
    total_issues = (
        Issue.issue_objects.filter(
            issue_module__module_id=OuterRef("pk"),
            issue_module__deleted_at__isnull=True,
        )
        .values("issue_module__module_id")
        .annotate(cnt=Count("pk"))
        .values("cnt")
    )
    return queryset.annotate(
        completed_issues=Coalesce(
            Subquery(completed_issues[:1]),
            Value(0, output_field=IntegerField()),
        ),
        cancelled_issues=Coalesce(
            Subquery(cancelled_issues[:1]),
            Value(0, output_field=IntegerField()),
        ),
        started_issues=Coalesce(Subquery(started_issues[:1]), Value(0, output_field=IntegerField())),
        unstarted_issues=Coalesce(
            Subquery(unstarted_issues[:1]),
            Value(0, output_field=IntegerField()),
        ),
        backlog_issues=Coalesce(Subquery(backlog_issues[:1]), Value(0, output_field=IntegerField())),
        total_issues=Coalesce(Subquery(total_issues[:1]), Value(0, output_field=IntegerField())),
    )
