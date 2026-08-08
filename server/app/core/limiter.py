"""The rate limiter, in its own module so routers can reach it.

`main` imports the routers, so the routers cannot import `main` to get at the
limiter. One small module breaks the cycle.

The default limits here are the floor for every endpoint. Routes that cost real
money or guard a credential declare a tighter limit of their own — see
`routers/auth.py`.
"""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings


def client_ip(request: Request) -> str:
    """The address a rate limit is counted against.

    Behind a proxy every request arrives from the ingress, so counting the
    socket peer would drop the entire user base into one bucket — the whole app
    stops answering after 30 requests in a minute, and it looks like an outage
    rather than a limit.

    `X-Forwarded-For` reads left to right, oldest first, and the left end is
    written by whoever called us. Anyone can send `X-Forwarded-For: 1.2.3.4`;
    the proxy then appends the address it actually saw, to the *right* of it.
    So the trustworthy entries are the last `trusted_proxy_count` ones, and we
    step past exactly that many. Reading the leftmost entry instead — which is
    what uvicorn does under `--forwarded-allow-ips='*'` — hands an attacker a
    fresh bucket on every request just by varying a header.

    At `trusted_proxy_count = 0` the header is ignored entirely, which is what
    we want in local development where nothing sits in front of us.
    """
    depth = settings.trusted_proxy_count
    if depth:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            hops = [h.strip() for h in forwarded.split(",") if h.strip()]
            if hops:
                # Fewer hops than proxies means the header did not come from our
                # own chain. Fall back to the oldest entry rather than indexing
                # off the front of the list.
                return hops[-depth] if len(hops) >= depth else hops[0]
    return get_remote_address(request)


def business_key(request: Request) -> str:
    """Count a business's requests against the business, not against its address.

    Several tills in one shop sit behind a single router, and a whole street can
    sit behind one carrier NAT. Counting by address there gets it wrong in both
    directions: a busy shop is throttled because of its neighbours, and an abuser
    spread over a few addresses is not throttled at all.

    `deps.current_business` puts the id on the request for us — a key function
    only ever receives the Request, so there is no other way to reach it. The
    address is the fallback for a route that has no business behind it, which
    today means none: both callers depend on `CurrentBusiness`.
    """
    business_id: str | None = getattr(request.state, "business_id", None)
    return f"business:{business_id}" if business_id else client_ip(request)


# `key_style="endpoint"` counts against the handler rather than against the URL,
# and on a route with a path parameter those are not the same thing. On the URL,
# `/api/trips/1` and `/api/trips/2` are separate counters, so walking the ids is
# never refused however fast it goes — which is the sweep a default limit exists
# to stop. The decorated routes are unaffected: they name their own scope.
SUSTAINED_LIMIT = "500/hour"
BURST_LIMIT = "30/minute"

limiter = Limiter(
    key_func=client_ip,
    default_limits=[SUSTAINED_LIMIT, BURST_LIMIT],
    key_style="endpoint",
)
