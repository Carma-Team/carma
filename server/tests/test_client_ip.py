"""Which address a rate limit is counted against, once a proxy is in front.

Two ways to get this wrong, and they fail in opposite directions:

1. Count the socket peer while behind an ingress, and every user shares one
   bucket — the app stops answering for everybody at 30 requests a minute.
2. Trust the left end of `X-Forwarded-For`, and the limit stops existing — the
   caller writes that end, so a new value per request means a new bucket per
   request.

`client_ip` walks in from the right instead, past exactly as many entries as we
have proxies. These tests pin that down, because the failure in case 2 is
invisible: everything looks fine until someone tries.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from app.config import settings
from app.core.limiter import client_ip


@dataclass
class _FakeRequest:
    """Just the two things `client_ip` reads."""

    headers: dict[str, str]
    peer: str | None = "10.0.0.9"

    @property
    def client(self) -> Any:
        if self.peer is None:
            return None
        return type("C", (), {"host": self.peer})()


@pytest.fixture
def proxy_depth(monkeypatch: pytest.MonkeyPatch):
    def _set(depth: int) -> None:
        monkeypatch.setattr(settings, "trusted_proxy_count", depth)

    return _set


def test_no_proxy_ignores_the_header_entirely(proxy_depth) -> None:
    """Locally nothing is in front of us, so the header is just a client claim."""
    proxy_depth(0)
    req = _FakeRequest(headers={"x-forwarded-for": "1.2.3.4"}, peer="203.0.113.7")

    assert client_ip(req) == "203.0.113.7"


def test_one_proxy_reads_the_address_the_proxy_appended(proxy_depth) -> None:
    proxy_depth(1)
    req = _FakeRequest(headers={"x-forwarded-for": "203.0.113.7"})

    assert client_ip(req) == "203.0.113.7"


def test_spoofed_prefix_does_not_win(proxy_depth) -> None:
    """The attack this whole function exists for.

    The caller sends `X-Forwarded-For: 1.2.3.4`; our ingress appends what it
    actually saw. Reading the front of the list would let them mint a fresh
    bucket per request by changing that one header.
    """
    proxy_depth(1)
    req = _FakeRequest(headers={"x-forwarded-for": "1.2.3.4, 203.0.113.7"})

    assert client_ip(req) == "203.0.113.7"


def test_a_long_spoofed_chain_still_resolves_to_the_real_caller(proxy_depth) -> None:
    proxy_depth(1)
    req = _FakeRequest(headers={"x-forwarded-for": "9.9.9.9, 8.8.8.8, 7.7.7.7, 203.0.113.7"})

    assert client_ip(req) == "203.0.113.7"


def test_two_proxies_step_past_both(proxy_depth) -> None:
    proxy_depth(2)
    req = _FakeRequest(headers={"x-forwarded-for": "1.2.3.4, 203.0.113.7, 10.0.0.1"})

    assert client_ip(req) == "203.0.113.7"


def test_missing_header_behind_a_proxy_falls_back_to_the_peer(proxy_depth) -> None:
    proxy_depth(1)
    req = _FakeRequest(headers={}, peer="10.0.0.9")

    assert client_ip(req) == "10.0.0.9"


def test_shorter_chain_than_configured_does_not_index_off_the_front(proxy_depth) -> None:
    """Two proxies configured, one entry present — take what there is, don't wrap."""
    proxy_depth(2)
    req = _FakeRequest(headers={"x-forwarded-for": "203.0.113.7"})

    assert client_ip(req) == "203.0.113.7"


def test_whitespace_and_empty_entries_are_ignored(proxy_depth) -> None:
    proxy_depth(1)
    req = _FakeRequest(headers={"x-forwarded-for": " 1.2.3.4 , , 203.0.113.7 "})

    assert client_ip(req) == "203.0.113.7"
