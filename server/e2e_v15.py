"""
E2E smoke test — RFC-001 v1.5 pipeline against local FastAPI + PostgreSQL.

Scenarios:
  A  Normal trip (v1.5)   — server computes and returns score/points
  B  Forged points ignored — client sends avgScore=99/points=99999, server overrides
  C  Stale timestamp       — digest.timestamp > 5 min old -> HTTP 401
  D  Physics violation     — avg_speed > 250 km/h -> HTTP 422
  E  Idempotency           — duplicate Idempotency-Key returns same trip

Run: python e2e_v15.py
"""

import hashlib
import hmac as _hmac
import json
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta

import httpx

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://localhost:3000"
SIGNING_KEY = "CARMA-TRIP-HMAC-KEY-V1__REPLACE_VIA_APP_ATTESTATION"

# ── helpers ───────────────────────────────────────────────────────────────────


def _hmac_hex(key: str, message: str) -> str:
    return _hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()


def ph_sign(digest: dict) -> str:
    canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
    return f"ph:{_hmac_hex(SIGNING_KEY, canonical)}"


def make_digest(
    *,
    hard_brakes=0,
    aggressive_accels=0,
    sharp_turns=0,
    phone_seconds=0,
    duration_seconds=600,
    distance_km=12.0,
    risk_multiplier=1.0,
    start_iso: str,
    end_iso: str,
    timestamp_offset_ms: int = 0,
) -> dict:
    return {
        "distanceKm": distance_km,
        "durationSeconds": duration_seconds,
        "hardBrakes": hard_brakes,
        "aggressiveAccels": aggressive_accels,
        "sharpTurns": sharp_turns,
        "phoneSeconds": phone_seconds,
        "riskMultiplier": risk_multiplier,
        "startTime": start_iso,
        "endTime": end_iso,
        "timestamp": int(time.time() * 1000) + timestamp_offset_ms,
    }


def make_payload(
    digest: dict, *, avg_score=0, points=0, risk_multiplier=1.0, penalties=0, idempotency_key: str | None = None
) -> tuple[dict, str]:
    key = idempotency_key or f"e2e_{uuid.uuid4().hex}"
    body = {
        "startTime": digest["startTime"],
        "endTime": digest["endTime"],
        "distanceKm": digest["distanceKm"],
        "durationSeconds": digest["durationSeconds"],
        "avgScore": avg_score,
        "points": points,
        "hardBrakes": digest["hardBrakes"],
        "aggressiveAccels": digest["aggressiveAccels"],
        "sharpTurns": digest["sharpTurns"],
        "phoneSeconds": digest["phoneSeconds"],
        "riskMultiplier": risk_multiplier,
        "penalties": penalties,
        "telemetryDigest": digest,
        "payloadSignature": ph_sign(digest),
    }
    return body, key


def register_and_login(client: httpx.Client) -> str:
    # Use a random 6-digit suffix so each run gets a fresh user
    suffix = str(uuid.uuid4().int)[:6]
    email = f"e2e_{suffix}@gmail.com"
    pw = f"E2Epw{suffix}!"
    reg = client.post(
        "/api/auth/register",
        json={
            "name": f"E2E {suffix}",
            "email": email,
            "password": pw,
        },
    )
    if reg.status_code not in (200, 201):
        sys.exit(f"Register failed: {reg.status_code} {reg.text}")
    token = reg.json().get("token")
    if not token:
        login = client.post("/api/auth/login", json={"email": email, "password": pw})
        if login.status_code != 200:
            sys.exit(f"Login failed: {login.status_code} {login.text}")
        token = login.json().get("token")
    return token


def ok(label: str, got: int, expect: int, body: dict) -> bool:
    if got == expect:
        print(f"  PASS  {label} -> HTTP {got}")
        return True
    print(f"  FAIL  {label} -> HTTP {got} (expected {expect})")
    print(f"      body: {json.dumps(body, indent=2)[:300]}")
    return False


# ── main ──────────────────────────────────────────────────────────────────────


def main():
    passed = 0
    failed = 0

    with httpx.Client(base_url=BASE, timeout=10) as client:
        # ── auth ──────────────────────────────────────────────────────────────
        print("\n[Setup] Registering E2E user ...")
        token = register_and_login(client)
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        print(f"  token: {token[:24]}...\n")

        # common timestamps
        now = datetime.now(UTC)
        start_iso = (now - timedelta(seconds=600)).isoformat()
        end_iso = now.isoformat()

        # ─────────────────────────────────────────────────────────────────────
        # Scenario A — Normal trip: server computes score/points
        # Input: 12km, 600s, 2 hard brakes, no phone, daytime -> expected score≈90
        # ─────────────────────────────────────────────────────────────────────
        print("Scenario A — Normal trip (server scores)")
        digest_a = make_digest(
            hard_brakes=2, distance_km=12.0, duration_seconds=600, start_iso=start_iso, end_iso=end_iso
        )
        body_a, key_a = make_payload(digest_a)
        r = client.post("/api/trips", content=json.dumps(body_a), headers={**headers, "Idempotency-Key": key_a})
        trip_a = r.json()
        if ok("POST /api/trips", r.status_code, 201, trip_a):
            passed += 1
            srv_score = trip_a.get("avgScore", trip_a.get("avg_score"))
            srv_points = trip_a.get("points")
            print(f"       server_score={srv_score}, server_points={srv_points}")
            # 2 hard brakes = 10 penalty -> score = 90.0
            assert srv_score == 90.0, f"Expected score 90.0, got {srv_score}"
            assert srv_points > 0, f"Expected points > 0, got {srv_points}"
            print(f"  PASS  score=90.0 ✓  points={srv_points} > 0 ✓")
        else:
            failed += 1

        # ─────────────────────────────────────────────────────────────────────
        # Scenario B — Forged points: client sends 99999, server overrides
        # ─────────────────────────────────────────────────────────────────────
        print("\nScenario B — Forged avgScore=99/points=99999 ignored by server")
        digest_b = make_digest(
            hard_brakes=0, distance_km=5.0, duration_seconds=300, start_iso=start_iso, end_iso=end_iso
        )
        body_b, key_b = make_payload(digest_b, avg_score=99, points=99999)
        r = client.post("/api/trips", content=json.dumps(body_b), headers={**headers, "Idempotency-Key": key_b})
        trip_b = r.json()
        if ok("POST /api/trips", r.status_code, 201, trip_b):
            passed += 1
            srv_score = trip_b.get("avgScore", trip_b.get("avg_score"))
            srv_points = trip_b.get("points")
            print(f"       server_score={srv_score}, server_points={srv_points}")
            assert srv_score != 99, "Server should have overridden score 99"
            assert srv_points != 99999, "Server should have overridden points 99999"
            assert srv_score == 100.0, f"Expected score 100.0 (clean trip), got {srv_score}"
            print(f"  PASS  client's 99/99999 overridden -> score={srv_score}, points={srv_points} ✓")
        else:
            failed += 1

        # ─────────────────────────────────────────────────────────────────────
        # Scenario C — Stale timestamp -> HTTP 401
        # ─────────────────────────────────────────────────────────────────────
        print("\nScenario C — Stale timestamp (6 min old) -> 401")
        digest_c = make_digest(
            distance_km=8.0,
            duration_seconds=600,
            start_iso=start_iso,
            end_iso=end_iso,
            timestamp_offset_ms=-(6 * 60 * 1000),
        )  # 6 min ago
        body_c, key_c = make_payload(digest_c)
        r = client.post("/api/trips", content=json.dumps(body_c), headers={**headers, "Idempotency-Key": key_c})
        if ok("stale timestamp", r.status_code, 401, r.json()):
            passed += 1
        else:
            failed += 1

        # ─────────────────────────────────────────────────────────────────────
        # Scenario D — Physics violation: 300km/1min -> avg_speed 18000 km/h -> 422
        # ─────────────────────────────────────────────────────────────────────
        print("\nScenario D — Physics violation (18000 km/h) -> 422")
        digest_d = make_digest(distance_km=300.0, duration_seconds=60, start_iso=start_iso, end_iso=end_iso)
        body_d, key_d = make_payload(digest_d)
        r = client.post("/api/trips", content=json.dumps(body_d), headers={**headers, "Idempotency-Key": key_d})
        if ok("physics violation", r.status_code, 422, r.json()):
            passed += 1
        else:
            failed += 1

        # ─────────────────────────────────────────────────────────────────────
        # Scenario E — Idempotency: same Idempotency-Key returns identical trip
        # ─────────────────────────────────────────────────────────────────────
        print("\nScenario E — Idempotency (duplicate key)")
        r2 = client.post("/api/trips", content=json.dumps(body_a), headers={**headers, "Idempotency-Key": key_a})
        trip_a2 = r2.json()
        if ok("duplicate POST", r2.status_code, 201, trip_a2):
            passed += 1
            id1 = trip_a.get("id")
            id2 = trip_a2.get("id")
            assert id1 == id2, f"Idempotency broken: {id1} != {id2}"
            print(f"  PASS  same trip ID {id1} returned ✓")
        else:
            failed += 1

        # ─────────────────────────────────────────────────────────────────────
        # Scenario F — Weekend night multiplier: Thu 23:00, score=100 -> rm=2.0
        # ─────────────────────────────────────────────────────────────────────
        print("\nScenario F — Weekend-night multiplier (Thu 23:00, rm=2.0)")
        # Jan 8, 2026 = Thursday
        thu_start = datetime(2026, 1, 8, 23, 0, 0, tzinfo=UTC).isoformat()
        thu_end = datetime(2026, 1, 8, 23, 10, 0, tzinfo=UTC).isoformat()
        digest_f = make_digest(
            hard_brakes=0,
            distance_km=10.0,
            duration_seconds=600,
            risk_multiplier=2.0,
            start_iso=thu_start,
            end_iso=thu_end,
        )
        body_f, key_f = make_payload(digest_f, risk_multiplier=2.0)
        r = client.post("/api/trips", content=json.dumps(body_f), headers={**headers, "Idempotency-Key": key_f})
        trip_f = r.json()
        if ok("Thu night trip", r.status_code, 201, trip_f):
            passed += 1
            srv_rm = trip_f.get("riskMultiplier", trip_f.get("risk_multiplier"))
            srv_score = trip_f.get("avgScore", trip_f.get("avg_score"))
            srv_points = trip_f.get("points")
            print(f"       server_rm={srv_rm}, server_score={srv_score}, server_points={srv_points}")
            assert srv_rm == 2.0, f"Expected rm=2.0, got {srv_rm}"
            assert srv_score == 100.0, f"Expected score=100.0, got {srv_score}"
            assert srv_points > 0, "Expected points > 0"
            print(f"  PASS  rm=2.0 ✓  score=100.0 ✓  points={srv_points} ✓")
        else:
            failed += 1

    # ── summary ───────────────────────────────────────────────────────────────
    total = passed + failed
    print(f"\n{'='*50}")
    print(f"  E2E result: {passed}/{total} passed")
    if failed:
        print(f"  {failed} FAILED — see output above")
        sys.exit(1)
    else:
        print("  All scenarios green PASS")


if __name__ == "__main__":
    main()
