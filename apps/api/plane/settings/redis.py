# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import redis
from django.conf import settings
from urllib.parse import urlparse


def redis_instance(**connection_options):
    # connect to redis
    if settings.REDIS_SSL:
        url = urlparse(settings.REDIS_URL)
        ri = redis.Redis(
            host=url.hostname,
            port=url.port,
            password=url.password,
            ssl=True,
            ssl_cert_reqs=None,
            **connection_options,
        )
    else:
        ri = redis.Redis.from_url(settings.REDIS_URL, db=0, **connection_options)

    return ri
