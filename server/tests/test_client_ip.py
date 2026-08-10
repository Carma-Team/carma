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


def test_one_ipv6_machine_cannot_mint_a_bucket_per_request(proxy_depth) -> None:
    """The v6 version of case 2, and it needs no header at all.

    A routed /64 is the smallest block anyone is assigned, and it holds 2**64
    addresses that one machine can bind at will. Counted whole, each is a fresh
    budget — the limit, and the sign-in backoff keyed the same way, stop
    existing. They share a /64, so that is what we count.
    """
    proxy_depth(0)
    first = _FakeRequest(headers={}, peer="2001:db8:abcd:1234::1")
    second = _FakeRequest(headers={}, peer="2001:db8:abcd:1234::dead:beef")

    assert client_ip(first) == client_ip(second)
    assert client_ip(first) == "2001:db8:abcd:1234::"


def test_a_different_ipv6_network_is_a_different_bucket(proxy_depth) -> None:
    """Grouping must not go so wide that unrelated callers share a budget."""
    proxy_depth(0)
    here = _FakeRequest(headers={}, peer="2001:db8:abcd:1234::1")
    elsewhere = _FakeRequest(headers={}, peer="2001:db8:abcd:9999::1")

    assert client_ip(here) != client_ip(elsewhere)


def test_ipv6_from_the_forwarded_header_is_grouped_too(proxy_depth) -> None:
    proxy_depth(1)
    first = _FakeRequest(headers={"x-forwarded-for": "2001:db8:abcd:1234::1"})
    second = _FakeRequest(headers={"x-forwarded-for": "2001:db8:abcd:1234::2"})

    assert client_ip(first) == client_ip(second) == "2001:db8:abcd:1234::"


def test_an_ipv4_caller_in_mapped_form_keeps_its_own_bucket(proxy_depth) -> None:
    """`::ffff:203.0.113.9` is an IPv4 caller, however `ipaddress` classifies it.

    Its top 80 bits are zero, so grouping it on a /64 like any other v6 address
    puts *every* IPv4 caller on `::` — case 1 rebuilt out of an address family,
    and the sign-in backoff becomes one wait the whole user base shares. This is
    express-rate-limit's GHSA-46wh-pxpv-q5gq; unmap before bucketing.
    """
    proxy_depth(1)
    here = _FakeRequest(headers={"x-forwarded-for": "::ffff:203.0.113.9"})
    there = _FakeRequest(headers={"x-forwarded-for": "::ffff:198.51.100.7"})

    assert client_ip(here) == "203.0.113.9"
    assert client_ip(there) == "198.51.100.7"


def test_something_that_is_not_an_address_is_bounded(proxy_depth) -> None:
    """`caller_ip` is a varchar(45); an oversized value must not reach it.

    A failed INSERT would escape `_record_failure` as a 500 with the failure
    unrecorded — untracked guessing, and a 200-vs-500 oracle to go with it.
    """
    proxy_depth(2)
    req = _FakeRequest(headers={"x-forwarded-for": "A" * 500})

    assert len(client_ip(req)) <= 45
