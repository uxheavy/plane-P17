# Public identity

## Status

Company Runner's public identity is planned, not yet live. This document owns
the intended identifiers; it does not assert that a domain, account, route, or
content currently exists.

| Surface | Planned identifier                               |
| ------- | ------------------------------------------------ |
| Website | `https://company-runner.com`                     |
| X       | `@companyrunner` (`https://x.com/companyrunner`) |

## Ownership

- `packages/constants/src/metadata.ts` owns canonical product and Publish
  metadata when the corresponding public destinations are live.
- `packages/constants/src/endpoints.ts` owns environment-supplied runtime
  destinations such as the website and support email.
- Billing, documentation, forum, status, legal, and support routes have their
  own deployed owners. Do not infer their paths from the planned website host.

## Activation

Do not emit these identifiers in application metadata or link users to them
until the relevant destination is deployed and verified. At launch, verify DNS
and an HTTP journey for each published route, then update metadata and runtime
configuration in the same reviewed change. Keep existing functional external
destinations in place until their Company Runner replacements are live.
