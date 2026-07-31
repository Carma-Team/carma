"""The rate limiter, in its own module so routers can reach it.

`main` imports the routers, so the routers cannot import `main` to get at the
limiter. One small module breaks the cycle.

The default limits here are the floor for every endpoint. Routes that cost real
money or guard a credential declare a tighter limit of their own — see
`routers/auth.py`.
"""

from __future__ import annotations

import ipaddress

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings

# An IPv6 allocation is a network, not an address. Any VPS or home line with a
# routed /64 can bind 18 quintillion source addresses, so counting the full
# address gives one machine that many budgets — the limit stops existing, and so
# does the per-caller sign-in backoff built on the same key. /64 is the smallest
# block anyone is assigned, which is why Auth0 and Cloudflare group on it too.
# IPv4 has no equivalent: an address there really is one caller, so it is used
# whole.
_IPV6_BUCKET_PREFIX = 64


def _bucket(address: str) -> str:
    """Collapse an address to the unit a budget is actually counted against."""
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        # Not an address at all. Bucket the garbage together rather than letting
        # an arbitrary string through — it is also what reaches a varchar column
        # in `services.auth._record_failure`.
        return address[:45]
    if parsed.version == 6:
        return str(ipaddress.ip_network(f"{parsed}/{_IPV6_BUCKET_PREFIX}", strict=False).network_address)
    return str(parsed)


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

    The result is a *bucket*, not a literal address: IPv6 is grouped on its /64,
    because otherwise one machine holds more budgets than it could ever spend.
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
                return _bucket(hops[-depth] if len(hops) >= depth else hops[0])
    return _bucket(get_remote_address(request))


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


limiter = Limiter(key_func=client_ip, default_limits=["500/hour", "30/minute"])
