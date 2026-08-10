# RFC-001: ארכיטקטורת Hybrid Validation — "Double Brain"
**מסמך:** RFC-001 | **גרסה:** 1.7 | **תאריך:** 2026-05-21
**מחבר:** Dan Ofri (CTO) | **ענף:** `feature/hybrid-validation-contract` → ממוזג ל-`main` (`a66fb42`)
**סטטוס:** רשומת החלטה. התוכנית המואצת הושלמה — מכניקת הליבה שתוארה כאן נמצאת בייצור.

---

## Executive summary (English)

*Sections 1 to 6 of this record are written in Hebrew. This summary carries the two parts
that still govern code today. It is a reading aid, not a substitute for them.*

**The threat that produced this architecture (Section 1).** An architectural audit on
2026-05-20 found that scoring, fraud detection, and points calculation all ran exclusively
on the client, while the server persisted whatever payload it received without ever checking
the contents. Anyone holding a valid JWT could claim a score of 100 and 99,999 points for a
thirty-second trip, and the server would store it. The "Double Brain" model does not replace
the client logic — it adds a server-side examiner that acts as a final judge and cannot be
bypassed.

**Why the client no longer computes a score (Absolute Metrics Decoupling, Section 2.3).**
Through v1.4 the client calculated a score and sent it to the server. Any later change to
the formula would have produced two different numbers for one trip: the in-trip display
showing the installed app's arithmetic, the database storing the server's. A driver would
see one score when the trip ended and a different one in their history. The decision removes
that possibility rather than managing it. The client reports measurements only — speed,
events, distance — and the server is the sole scoring oracle. The trip result appears only
after the server has answered.

**What this means in the code today.** The client is a sensor node: it builds and signs a raw
telemetry digest, and never sends a score or a points total. The server verifies the
signature, checks the payload against physical limits, scores it, and is the only place in
the system where a score or a points total is produced.

---

> **⚠️ Parts of this record are superseded. It is kept for the rationale, not as a guide to
> current behaviour.**
>
> | Section | Status |
> |---|---|
> | 1, 2.1, 2.3, 2.4, 6 | **In force.** The threat model, the sensor-node/oracle split, the two dated decisions, and the standing promises. |
> | 3, 7.2–7.4 | **In force.** The telemetry digest shape and the replay-protection contract. |
> | 3.1 — the `riskMultiplier` field only | **Removed from the digest (CAR-165).** The server always derived the multiplier from `startTime` and discarded the client's copy, so the field audited nothing. Clients from v1.10 on omit it; the server still accepts it from older ones. The rest of the 3.1 schema stands. |
> | 2.2 — the fraud row only | **Superseded by [fraud-detection.md](fraud-detection.md).** Transport-mode detection and the server-side gates are specified there. The rest of the 2.2 responsibility table stands. |
> | 4, 5 | **Completed sprint mechanics.** Per-owner task lists, the accelerated-programme rollout, and its per-person Definition of Done. The work landed; the tasks are history. Note that Section 5 lists "a POST with a `ph:` signature passes" as an acceptance criterion — that was Sprint 1's intent and is no longer the target. |
> | 7 — the `ph:` placeholder posture | **Superseded by [fraud-detection.md](fraud-detection.md).** Sprint 1 accepted an unverified signature deliberately. The target rejects an absent, placeholder, or unverifiable signature outright. Enforcement timing is CAR-13. |
> | 8 | **Superseded by [scoring.md](scoring.md).** The `100 − penalties` formula and its parity test vectors describe the v1 engine, which has since been deleted. |
>
> This is a decision record. It is not edited into currency — read it as what was decided on
> 2026-05-21. Only the metadata, this banner, and the summary above have been updated since.

> **v1.4 Amendment:** Time-Based Nonce + HMAC-SHA256 replay protection added — see §7.
> **v1.5 Amendment:** Absolute Metrics Decoupling — score and points calculation moved
> exclusively to the server. The mobile client is a sensor node only. See §2.3 (revised),
> §3.1 (revised), and §8 (new).
> **v1.7 Amendment:** Distraction Telemetry Paradigm Shift — `phoneSeconds` (passive
> AppState-based screen-time) replaced by `touchEpochs` + `screenInteractionSeconds`
> (IMU-based active-interaction detection). Eliminates Waze/navigation-app false positives.
> See §2.4 (new CTO decision), §3.1 (revised digest), §4.3 (new MAI SDK task), §8.1
> (revised formula), §8.3 (revised test vectors). Code implementation deferred to
> Sprint+1 pending Mai's `PhoneUsageManager` refactor.

---

## 1. רקע ומוטיבציה

דוח האודיט הארכיטקטורי מתאריך 2026-05-20 (commit `c3471ef`) חשף פגיעות P0 יסודית:
**מנוע הניקוד, מנגנון גילוי ההונאה וחישוב הנקודות פועלים אך ורק בצד הלקוח.** השרת מקבל ושומר כל payload שנשלח, ללא אימות תוכן. תוקף עם JWT תקף יכול לשלוח ציון 100 ו-99,999 נקודות על נסיעה בת 30 שניות — והשרת יקבל זאת.

מודל ה-"Double Brain" שמוצע כאן אינו מחליף את הלוגיקה הלקוחית — הוא **מוסיף שכבת בוחן בצד-שרת** שפועלת כשופט עליון ובלתי ניתן לעקיפה.

---

## 2. עיצוב המערכת — מודל ה-Hybrid

### 2.1 עיקרון הפעולה

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  MOBILE CLIENT ("The Sensor Node")                  [v1.5]      │
 │                                                                 │
 │  CarmaDrivingSDK → SensorManager → TripValidationManager       │
 │        ↓ raw events + GPS telemetry                             │
 │  AppContext.processEndTrip()                                    │
 │        ├── HUD: raw event notifications only                    │
 │        │       (no 0–100 score rendered during trip)            │
 │        ├── buildTelemetryDigest() ← raw metrics snapshot        │
 │        └── signTelemetryDigest() ← HMAC-SHA256                  │
 │                    ↓ RawTripPayload + telemetryDigest + sig     │
 └─────────────────────────────────────────────────────────────────┘
                              │  HTTPS POST /api/trips
                              ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  FASTAPI SERVER ("The Sole Scoring Oracle")         [v1.5]      │
 │                                                                 │
 │  1. Timestamp drift check — 401 if |drift| > 5 min             │
 │  2. HMAC-SHA256 verify    — 403 if signature mismatch           │
 │  3. Plausibility gate     — 422 if physics violation            │
 │  4. calculateScore(raw metrics) ← ONLY score engine in system   │
 │  5. Atomic UPDATE user.points   ← Lost Update prevention        │
 │  6. Persist trip row + avg_score + telemetry_digest to DB       │
 └─────────────────────────────────────────────────────────────────┘
```

### 2.2 עקרון הפרדת האחריות — "Sensor Node / Scoring Oracle"

| היבט | לקוח (Sensor Node) | שרת (Scoring Oracle) |
|------|------|------|
| **מטרה** | איסוף נתונים גולמיים + HUD אירועים בלבד | חישוב ציון, שמירת DB, אמת יחיד |
| **ניקוד** | ❌ לא מחשב ציון 0–100. HUD מציג רק אירועים גולמיים. | ✅ מריץ `calculateScore()` — מנוע הניקוד היחיד במערכת |
| **נקודות** | ❌ לא מחשב ולא שולח `points` | ✅ מחשב `points` + מעדכן DB אטומית |
| **הונאה** | FraudDetector: זיהוי רכבת/אוטובוס (לא שולח נסיעה) | Plausibility gate: מרחק, מהירות, משך + HMAC |
| **TelemetryDigest** | מטריקות גולמיות בלבד (ראה §3.1) | מאמת חתימה → מחשב ציון ממטריקות |
| **חתימה** | מייצר HMAC-SHA256 על מטריקות גולמיות | מאמת HMAC-SHA256 + drift window |

### 2.3 החלטת CTO — Absolute Metrics Decoupling (v1.5, supersedes v1.0–v1.4)

**תאריך:** 2026-05-21 | **מחליט:** Dan Ofri (CTO)

**מה מוחלט:**

הלקוח **אינו** מחשב ציון 0–100 ואינו מחשב נקודות — לא לצורך HUD, לא לצורך שליחה לשרת.
השרת הוא **מנוע הניקוד היחיד** במערכת (`server/app/services/scoring.py`).

**הנימוק:**

ב-v1.0–v1.4, הלקוח חישב ציון ושלח אותו לשרת. גרסה עתידית של נוסחת הניקוד
(שינוי מקדמים, הוספת משתנה) הייתה יוצרת חוסר עקביות מיידי:
- ה-HUD היה מציג ציון X (לפי הנוסחה הישנה של גרסת האפליקציה)
- ה-DB היה מאחסן ציון Y (לפי הנוסחה החדשה של השרת)
- המשתמש היה רואה ציון שונה בהיסטוריית הנסיעות מהציון שראה בסיום הנסיעה

ניתוק מוחלט זה **מסיר את הבעיה מהשורש**: הלקוח לעולם לא מציג ציון גולמי
שיכול לסתור את ה-DB. הוא מציג רק עובדות מדידה (מהירות, אירועים, מרחק).

**ה-HUD החדש:**

```
❌ לפני v1.5:  "ציון נסיעה: 87.3 / 100"         ← תצוגה מהנוסחה הלקוחית
✅ אחרי v1.5:  "בלימה חזקה זוהתה"               ← אירוע גולמי בלבד
               "מהירות נוכחית: 68 קמ"ש"          ← מדידה גולמית
               "מרחק: 4.2 ק"מ"                   ← מדידה גולמית
```

תוצאת הנסיעה הסופית (ציון + נקודות) מוצגת **רק לאחר** שהשרת מחזיר תגובה לבקשת POST.

**מה מבוטל:**
- `calculateScore()` בצד לקוח — **אסור** להשתמש בו מחוץ לבדיקות יחידה
- שדות `avgScore` ו-`points` ב-`TelemetryDigest` — **הוסרו** (§3.1)
- שליחת ציון או נקודות מחושבים מהלקוח — **אסור**

**מה נשאר בתוקף:**
- `scoring.ts` נשמר ב-`mobile/src/lib/` (**לצורך בדיקות בלבד** ולהגדרת הממשק)
- `server/app/services/scoring.py` מחייב פריטה אחד-לאחד של הנוסחה (§8)

---

### 2.4 החלטת CTO — Distraction Telemetry Paradigm Shift (v1.7)  **[NEW]**

**תאריך:** 2026-05-21 | **מחליט:** Dan Ofri (CTO)

**הבעיה — Waze False Positive:**

ה-`PhoneUsageManager` הנוכחי מבוסס על `AppState.addEventListener('change')`: כאשר CARMA
עוברת ל-background (למשל — Waze נפתח בחזית), כל זמן הרקע נספר כ-`phone_seconds`. נהג שנוסע
עם Waze כניווט ו-CARMA ברקע מקבל קנס מלא על "שימוש בטלפון" — למרות שלא נגע בטלפון והוא
מונח על תושבת. זהו **False Positive** שמהווה פגם UX יסודי שפוגע בנהגים בטוחים.

**הפתרון — מדדי אינטראקציה אקטיביים:**

`phone_seconds` מבוסס-AppState מוחלף בשני מדדים עצמאיים:

| מדד | עקרון מדידה | הגבלת OS |
|-----|-------------|----------|
| `touchEpochs` | ספירת אירועי אינטראקציה אקטיביים בתוך CARMA; proxy IMU (ניתוח ויברציה) כשה-app ברקע | זיהוי נגיעות ב-apps אחרים — **בלתי אפשרי** ב-iOS/Android (גבול OS) |
| `screenInteractionSeconds` | שניות שבהן הטלפון מזוהה כמוחזק ביד ע"י IMU (שונות אקסלרומטר גבוהה מול חתימת תושבת) | **אפשרי** — ניתוח IMU עצמאי מ-foreground app |

**הנימוק:**

מדידת `phone_seconds` כ-"AppState=background" לא מבחינה בין:
- נהג שהניח את הטלפון על תושבת וניווט עם Waze (לא הפרה)
- נהג שגלש בטלפון בזמן נסיעה (הפרה)

`screenInteractionSeconds` מבוסס-IMU פותר זאת: שונות אקסלרומטר גבוהה = טלפון ביד
(רטט אורגני, תנועות יד), שונות נמוכה = טלפון על תושבת (רטט רגיל של כביש). זהו אות
פיזיקלי אמין שאינו תלוי ב-AppState.

**מה מבוטל:**
- `phoneSeconds` ב-`TelemetryDigest` — **הוסר** (§3.1)
- `(phone_seconds / duration) × 40` מנוסחת העונשים — **מוחלף** (§8.1)

**מה נדחה לSpring+1:**
- עדכון `PhoneUsageManager` ב-SDK — **Mai** (§4.3 — MAI-SDK-v1.7)
- עדכון `scoring.py` עם פרמטרים חדשים — **Dan**
- עדכון `TelemetryDigest` TypeScript interface — **Dan**
- עד שה-SDK מספק את המדדים החדשים, `scoring.py` ממשיך להשתמש ב-`phone_seconds` כ-deprecated fallback

---

## 3. מפרט הטכני — TelemetryDigest

### 3.1 מבנה הנתונים

```typescript
// mobile/src/services/sync/types.ts  [v1.5 — avgScore and points REMOVED]
export interface TelemetryDigest {
  // ── Raw sensor metrics (client-measured) ──────────────────────────────────
  distanceKm:       number;  // GPS-measured distance in km (3 decimal places)
  durationSeconds:  number;  // elapsed trip duration in seconds
  hardBrakes:       number;  // count of IMU hard-braking events
  aggressiveAccels: number;  // count of IMU aggressive-acceleration events
  sharpTurns:       number;  // count of IMU sharp-turn events
  // ── Active interaction metrics (v1.7 — replaces phoneSeconds) ────────────────
  touchEpochs:               number;  // count of discrete active-interaction epochs while CARMA
                                      // is in foreground + IMU vibration proxy when backgrounded.
                                      // Note: cross-app touch detection is OS-restricted on
                                      // iOS/Android — touch events from Waze/Maps cannot be
                                      // intercepted from the background.
  screenInteractionSeconds:  number;  // seconds of confirmed hand-held phone usage derived from
                                      // IMU accelerometer-variance signature.
                                      // High variance = hand-held; low variance = vehicle-mounted.
                                      // Immune to Waze/navigation-app false positives.
  riskMultiplier:            number;  // time-of-day/day-of-week factor sent for audit; server recomputes
  startTime:                 string;  // ISO 8601 UTC — server uses this to derive riskMultiplier
  endTime:                   string;  // ISO 8601 UTC
  // ── Cryptographic nonce (v1.4) ────────────────────────────────────────────
  timestamp:                 number;  // millisecond Unix epoch — Date.now() at signing time

  // REMOVED in v1.5 — now exclusively server-computed:
  // avgScore ← server/app/services/scoring.py:calculate_score()
  // points   ← server/app/services/scoring.py:calculate_score()
  //
  // REMOVED in v1.7 — replaced by touchEpochs + screenInteractionSeconds:
  // phoneSeconds ← scoring.py retains phone_seconds as deprecated fallback until Sprint+1
  //                pending Mai's PhoneUsageManager refactor (§4.3 MAI-SDK-v1.7)
}
```

### 3.2 פרוטוקול חתימה

```
# [v1.4] — timestamp is a field inside digest; canonical JSON includes it naturally.

canonical_json  = JSON.stringify(digest, sorted_keys)   // digest contains timestamp
signature       = HMAC-SHA256(key=APP_SECRET, msg=canonical_json)
header          = "Idempotency-Key: <localTripId>"
body.payloadSignature = "<64-char-hex>"    // ph: prefix active during current sprint
```

**[v1.4] Server verification sequence:**
1. Parse `digest.timestamp` → reject with **HTTP 401** if `|server_now_ms − timestamp| > 300 000 ms`
2. Recompute `HMAC-SHA256(secret, canonical_json(digest))` → reject with **HTTP 403** if hash mismatch

**ספרינט נוכחי — Phase 1+2 ממוזגים:**
- HMAC-SHA256 פעיל בלקוח (`ph:` prefix לביפאס ספרינט נוכחי) — שרת מקבל ומאגר ל-DB
- Sean מיישם `_verify_signature()` ו-`_check_timestamp_drift()` עם bypass זמני ל-`ph:` בלבד
- Dan משדרג ל-HMAC-SHA256 אמיתי דרך `@noble/hashes` ברגע שמנגנון הסוד מוכן

**Sprint+1:** הסרת `ph:` bypass לחלוטין — כל חתימה חייבת לעבור drift check ו-HMAC verify. אכיפה דרך App Attestation (iOS) / Play Integrity (Android).

---

## 4. משימות לפי בעלי תפקידים

---

### 4.1 Sean — Backend Lead

> **🔴 [SEAN-P0] ו-[SEAN-P1] להלן: עדיפות קריטית — לספרינט הנוכחי.** אין המתנה לספרינט הבא. הבקאנד חשוף כעת לזיוף מלא. כל משימה מסומנת P0/P1 מטה חייבת להיסגר לפני merge ל-main.

#### [SEAN-P0 | ספרינט נוכחי] נתיב אימות מהיר — `/api/trips` Validation Gate

**מה:** הוסף לוגיקת validation ב-`trips_service.save()` לפני כתיבה ל-DB.

```python
# server/app/services/trips.py — הוסף:
def _validate_trip_plausibility(dto: SaveTripIn) -> None:
    """Rejects payloads that fail basic physics/math sanity."""
    if dto.avg_score is not None and not (0 <= dto.avg_score <= 100):
        raise HTTPException(422, "avg_score out of range [0, 100]")
    if dto.distance_km is not None and dto.distance_km > 2000:
        raise HTTPException(422, "distance_km implausible (> 2000 km)")
    if dto.duration_seconds is not None and dto.duration_seconds < 0:
        raise HTTPException(422, "negative duration")
    if dto.points is not None and dto.points > 10_000:
        raise HTTPException(422, "points implausible (> 10,000 per trip)")
    if dto.hard_brakes is not None and dto.hard_brakes > 500:
        raise HTTPException(422, "hard_brakes implausible")
    # Speed check: avg_speed = distance_km / (duration_seconds / 3600)
    if dto.distance_km and dto.duration_seconds:
        avg_speed = dto.distance_km / max(dto.duration_seconds / 3600, 0.001)
        if avg_speed > 250:
            raise HTTPException(422, f"avg_speed implausible ({avg_speed:.0f} km/h)")
```

#### [SEAN-P0 | ספרינט נוכחי] Server-Side Scoring Engine — `scoring.py`  **[v1.5 NEW]**

> **מחליף** את ההחלטה הישנה "נדחה" מ-v1.0. זהו P0 חדש — ראה §2.3 (v1.5).

**מה:** צור `server/app/services/scoring.py` — מנוע הניקוד היחיד במערכת. חייב לשקף
את הנוסחה של `mobile/src/lib/scoring.ts` בדיוק מספרי. כל פריט נסיעה שמגיע לשרת
מקבל ציון ונקודות מ-`calculate_score()` — **השרת אינו משתמש בציון שהלקוח שלח**.

```python
# server/app/services/scoring.py
import math
from datetime import datetime


def get_risk_multiplier(start_time: datetime) -> float:
    """Mirrors getRiskMultiplier() in mobile/src/lib/scoring.ts."""
    hour = start_time.hour
    # Python weekday(): Mon=0 … Thu=3, Fri=4, Sat=5, Sun=6
    weekday = start_time.weekday()
    is_night = hour >= 23 or hour < 4
    if not is_night:
        return 1.0
    is_weekend_night = weekday in (3, 4, 5)   # Thu, Fri, Sat — Israeli weekend
    return 2.0 if is_weekend_night else 1.5


def calculate_score(
    hard_brakes:       int,
    aggressive_accels: int,
    sharp_turns:       int,
    phone_seconds:     int,
    duration_seconds:  int,
    distance_km:       float,
    start_time:        datetime,
) -> tuple[float, float, float]:
    """
    Returns (avg_score, points, risk_multiplier).
    Mirrors calculateScore() in mobile/src/lib/scoring.ts exactly.

    Formula:
      penalties = hardBrakes*5 + aggressiveAccels*3 + sharpTurns*2
                  + (phoneSeconds/duration)*40
      score  = clamp(100 - penalties, 0, 100)
      factor = log(distanceKm + 1) / log(11)
      points = score * factor * riskMultiplier
    """
    safe_duration = max(duration_seconds, 1)
    penalties = (
        hard_brakes * 5
        + aggressive_accels * 3
        + sharp_turns * 2
        + (phone_seconds / safe_duration) * 40
    )
    score = max(0.0, min(100.0, 100.0 - penalties))
    distance_factor = math.log(distance_km + 1) / math.log(11)
    risk_multiplier = get_risk_multiplier(start_time)
    points = score * distance_factor * risk_multiplier

    return (
        round(score * 10) / 10,
        round(points * 10) / 10,
        risk_multiplier,
    )
```

**שילוב ב-`trips.py`:** לאחר HMAC verification, לפני INSERT:

```python
from app.services.scoring import calculate_score

# inside save(), after all gates pass:
avg_score, points, risk_mul = calculate_score(
    hard_brakes       = dto.hard_brakes or 0,
    aggressive_accels = dto.aggressive_accels or 0,
    sharp_turns       = dto.sharp_turns or 0,
    phone_seconds     = dto.phone_seconds or 0,
    duration_seconds  = dto.duration_seconds or 0,
    distance_km       = dto.distance_km or 0.0,
    start_time        = start,
)
# avg_score and points now come from the server formula — ignore client-sent values.
```

> **קריטי:** הנוסחה בפייתון חייבת לייצר תוצאות זהות לנוסחת TypeScript בכל מקרי הקצה.
> בדיקות paritry בין שני המנועים — ראה §8.3.

#### [SEAN-P0 | ספרינט נוכחי] אימות חתימת HMAC-SHA256

**מה:** לאחר שמנגנון ניהול המפתחות ייקבע (Phase 2), הוסף middleware לאימות `payloadSignature` ב-`routers/trips.py`.

```python
# server/app/routers/trips.py
import hmac, hashlib

SHARED_SECRET = settings.trip_signing_secret  # env var, Vault/KeyVault

def _verify_signature(digest: dict, signature: str | None) -> None:
    # ספרינט נוכחי: קבל ph: prefix (HMAC-SHA256 מהלקוח, bypass זמני) — אל תדחה
    if not signature or signature.startswith("ph:"):
        return
    canonical = json.dumps(digest, sort_keys=True)
    expected = hmac.new(
        SHARED_SECRET.encode(), (SHARED_SECRET + ":" + canonical).encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(403, "Invalid payload signature")
```

> **הערה לספרינט:** הוסף `TRIP_SIGNING_SECRET` ל-Azure Key Vault ול-`.env.example`. אסור לקשור ערך ברירת מחדל (empty string) שיגרום ל-bypass בשגגה בסביבת production.

#### [SEAN-P1 | ספרינט נוכחי] שמירת אירועי נסיעה ל-Event table

**מה:** `trips_service.save()` כרגע מקבל `dto.events` אבל לא כותב לטבלת `events`. **כל נתוני האירועים אובדים.** הוסף bulk insert.

```python
from app.models.event import Event
# בתוך save(), לאחר db.add(trip):
if dto.events:
    for raw in dto.events:
        ev = Event(
            trip_id=trip.id,
            event_type=raw.get("type"),
            timestamp=raw.get("timestamp"),
            severity=raw.get("severity"),
            speed_kmh=raw.get("speedKmh"),
        )
        db.add(ev)
```

#### [SEAN-P2 | Sprint+1] Rate Limiting על `/api/trips`

**מה:** הוסף middleware rate limit — לא יותר מ-20 נסיעות ביום למשתמש.

---

### 4.2 Naveh — Database Lead

> **🔴 [NAVEH-P0] להלן: עדיפות קריטית — לספרינט הנוכחי.** ה-Lost Update bug ב-`user.points` הוא race condition פעיל שמגיע לייצור עם כל flush של SyncManager. ה-migration חייב לרוץ לפני שה-validation endpoint של Sean עולה לאוויר.

#### [NAVEH-P0 | ספרינט נוכחי] עדכון אטומי של נקודות משתמש — מניעת Lost Update

**מה:** שורות 72–75 ב-`trips_service.save()` מבצעות read-modify-write שאינו אטומי. תחת עומס (50 נסיעות בתור) זה גורם לאובדן נקודות מובטח.

```python
# במקום:
user.points += trip.points
user.total_points += trip.points
user.total_distance += trip.distance_km

# הוסף לאחר db.add(trip):
from sqlalchemy import update
if trip.points > 0 or trip.distance_km > 0:
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            points=User.points + trip.points,
            total_points=User.total_points + trip.points,
            total_distance=User.total_distance + trip.distance_km,
        )
    )
```

**הסבר:** `UPDATE ... SET points = points + ?` מתורגם ל-SQL שהמנוע מבצע בתוך single lock — אטומי לחלוטין, ללא race condition.

#### [NAVEH-P0 | ספרינט נוכחי] Migration: הוסף עמודות `telemetry_digest` ו-`phone_weighted_seconds` לטבלת `trips`

**מה:** שמירת ה-TelemetryDigest כ-JSONB לצורך audit trail ו-retroactive analysis.

```python
# server/app/models/trip.py — הוסף עמודה:
from sqlalchemy.dialects.postgresql import JSONB

telemetry_digest: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
payload_signature: Mapped[str | None]  = mapped_column(String(128), nullable=True)
```

```python
# server/app/schemas/trip.py — הוסף ב-SaveTripIn:
telemetry_digest: dict[str, Any] | None = Field(
    default=None,
    validation_alias=AliasChoices("telemetryDigest", "telemetry_digest")
)
payload_signature: str | None = Field(
    default=None,
    validation_alias=AliasChoices("payloadSignature", "payload_signature")
)
```

```python
# server/app/models/trip.py — הוסף גם phone_weighted_seconds באותה migration:
phone_weighted_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
```

```python
# server/app/schemas/trip.py — SaveTripIn — הוסף:
phone_weighted_seconds: float | None = Field(
    default=None,
    validation_alias=AliasChoices("phoneWeightedSeconds", "phone_weighted_seconds")
)
```

> **v1.5 note:** `phone_weighted_seconds` is no longer needed for client/server score reconciliation (client no longer sends a score). It remains a useful audit column for retroactive analysis. Its migration can be deferred to Sprint+1.

```bash
# Migration — ספרינט נוכחי:
alembic revision --autogenerate -m "hybrid-validation: add telemetry_digest, payload_signature, phone_weighted_seconds to trips"
alembic upgrade head
```

#### [NAVEH-P1 | ספרינט נוכחי] איחוד מערכת הרמות — Single Source of Truth

**מה:** כרגע `gamification.ts` ו-`constants.ts` מגדירים שתי מפות רמות שונות לחלוטין (pragot שונים). יש ליצור endpoint `/api/levels` שמחזיר מפה אחת סמכותית מה-DB, ולהבטיח ש-`gamification.ts` משתמשת בנתוני השרת ולא בקבועים קשיחים.

**Alembic migration:** הוסף טבלת `levels` עם `min_points`, `multiplier`, `label`.

#### [NAVEH-P2 | Sprint+1] Index על `fraud_reports.user_id + reported_at`

**מה:** כבר קיים `ix_fraud_reports_reported_at` — הוסף composite index `(user_id, reported_at DESC)` לשאילתות analytics.

---

### 4.3 Mai — Frontend Lead (עדיפות יורדת)

#### [MAI-P0] HUD Redesign — Raw Events Only, No 0–100 Score  **[v1.5 NEW]**

**מה:** תצוגת ה-HUD הנוכחית מציגה ציון 0–100 בזמן אמת (מחושב ע"י `calculateScore()` בלקוח).
**יש להסיר** תצוגת ציון גולמי זו ולהחליפה בתצוגת אירועים ומדידות בלבד.

```
HUD פעיל — מה להציג (✅) ומה לא (❌):

  ✅ מהירות נוכחית (קמ"ש)          ← GPS raw
  ✅ מרחק שנסעת (ק"מ)              ← GPS accumulated
  ✅ זמן נסיעה (mm:ss)              ← elapsed timer
  ✅ "בלימה חזקה זוהתה" (toast)     ← IMU event
  ✅ "האצה אגרסיבית" (toast)        ← IMU event
  ✅ "פנייה חדה" (toast)            ← IMU event
  ✅ אינדיקטור שימוש בטלפון         ← PhoneUsageManager event

  ❌ ציון נסיעה (0–100)             ← REMOVED — server-computed only
  ❌ "X נקודות" מצטברות              ← REMOVED — server-computed only
  ❌ אינדיקטור "Excellent / Good"    ← REMOVED — server-computed only
```

**טיפול בסיום נסיעה:**

```typescript
// AppContext.tsx — processEndTrip()
// לאחר שליחת הבקשה לשרת, הציג "מחשב..." עד שהשרת מחזיר תגובה:

setTripState(prev => ({ ...prev, status: 'calculating' }))

try {
  const result = await tripsApi.save(payload)
  // result.avgScore ו-result.points מגיעים מהשרת — לא מחושבים מקומית
  setTripState(prev => ({
    ...prev,
    status: 'completed',
    finalScore: result.avgScore,       // ← מה-DB, לא מ-calculateScore()
    finalPoints: result.points,
  }))
} catch (e) { ... }
```

#### [MAI-SDK-v1.7 | Sprint+1] PhoneUsageManager Refactor — IMU-Based Active Interaction Detection  **[v1.7 NEW]**

**מה:** החלף את מנגנון `AppState.addEventListener` ב-`PhoneUsageManager.ts` בשני מדדים חדשים
שפותרים את ה-Waze false-positive (§2.4):

**מדד 1 — `touchEpochs`:**
ספירת אירועי נגיעה אקטיביים בתוך CARMA בחזית + אנליזה של ויברציית IMU כשה-app ברקע
(proxy בלבד — זיהוי נגיעות ב-apps אחרים הוא **בלתי אפשרי** ב-iOS/Android ברמת OS).

**מדד 2 — `screenInteractionSeconds`:**
שניות שבהן הטלפון מזוהה כמוחזק ביד לפי חתימת אקסלרומטר:
- Sample window: 500 ms
- Accumulate when `accelerometerVariance > HANDHELD_THRESHOLD` (threshold TBD empirically — Dan מאשר לפני merge)
- גבוהה = ביד; נמוכה = על תושבת / מונח בשקית

**עדכוני SDK נדרשים:**

```typescript
// mobile/src/lib/driving-sdk/types.ts — הוסף ל-TripData:
touchEpochs:              number;   // v1.7
screenInteractionSeconds: number;   // v1.7
// phoneSeconds: number  ← deprecated, הסר לאחר Sprint+1
```

**גבולות SDK:**
- שינויים ב-`PhoneUsageManager.ts` — מותר (חלק ממנוע הסנסורים)
- הוספת שדות ל-`TripData` בתוך `driving-sdk/types.ts` — מותר
- לוגיקה עסקית של CARMA (סף עונשים, מקדמים, fraud rules) — **אסור** בתוך `driving-sdk/`

**תנאי כניסה לSpring+1:** Dan מאשר calibration של `HANDHELD_THRESHOLD` ממדידות ניסיוניות
(נסיעות בדיקה — טלפון ביד מול טלפון על תושבת) לפני merge.

---

#### [MAI-P0b] גשר `currentSpeedKmH` — עדכון State מ-SDK

**מה:** `sdk.onUpdate` ב-`AppContext.tsx` מקבל `data: TripData` מ-`CarmaDrivingSDK` אבל **אינו מעדכן** את `tripState.currentSpeedKmH`. כתוצאה, כל ממשק שמציג מהירות נוכחית מקבל `0 km/h` תמידית.

**הערה:** `CarmaDrivingSDK` לא חושף `currentSpeed` דרך `TripData` כרגע — יש להוסיף שדה `currentSpeedKmH?: number` ל-`TripData` ב-`driving-sdk/types.ts` ולמלא אותו ב-`handleSensorUpdate`. **אסור לשנות קבצים בתוך `driving-sdk/` ישירות** — שלחי PR לדן לאישור גבול ה-SDK.

#### [MAI-P1] Toast/Modal לדחיית נסיעה על-ידי השרת

**מה:** כאשר השרת מחזיר שגיאה, `tripsApi.save()` זורק `ApiError`. הוסף טיפול ל-401/403/422:

```typescript
} catch (e) {
  if (e instanceof ApiError) {
    if (e.status === 401) {
      addToast({ title: 'שגיאת שעון', message: 'שעון המכשיר אינו מסונכרן. תקן ונסה שוב.', type: 'error' })
    } else if (e.status === 403) {
      addToast({ title: 'נסיעה נדחתה', message: `בדיקת אבטחה נכשלה. מזהה נסיעה: ${localTripId}`, type: 'error' })
      // 403 = permanent failure — אין retry
    } else if (e.status === 422) {
      addToast({ title: 'נסיעה נדחתה', message: 'נתוני נסיעה אינם תקינים.', type: 'error' })
    } else {
      await SyncManager.enqueue(validTripPayload)
    }
  } else {
    await SyncManager.enqueue(validTripPayload)
  }
}
```

#### [MAI-P2] Toast גילוי הונאה — "נסיעה בתחבורה ציבורית"

**מה:** `sdk.onFraudDetected` מפעיל `setTripState(INITIAL_TRIP_STATE)` אבל ה-TODO לתצוגת הודעה למשתמש עדיין פתוח. הוסף toast/modal נוח שמסביר למשתמש מה קרה.

---

### 4.4 Dan — CTO (ממוזג ל-main ✅)

#### [DAN-P0] שכבת Telemetry Digest + Payload Signing ✅

**מה:** הוטמע ב-`AppContext.tsx` ו-`sync/types.ts` — ממוזג ל-`main` בקומיט `a66fb42`.

- `buildTelemetryDigest()` — מחשב snapshot נקי של מטריקות הנסיעה
- `signTelemetryDigest()` — HMAC-SHA256 מלא (FIPS 198-1 / FIPS 180-4, pure-JS, ללא תלויות חיצוניות)
- `TelemetryDigest` interface — מוסיף לסכמת `ValidTripPayload` כשדות אופציונליים
- **לא נגעו** בשום קובץ תחת `mobile/src/lib/driving-sdk/`

---

## 5. פרוטוקול ה-Rollout — ספרינט מואץ (Crash-Program)

> **v1.1 — Phase 1 ו-Phase 2 מוזגו לספרינט הנוכחי.** ה-backend חשוף כעת. אין המתנה.

```
══════════════════════════════════════════════════════════════
  ספרינט נוכחי  [Phase 1 + Phase 2 — ממוזגים]
══════════════════════════════════════════════════════════════

  Dan (בוצע ✅ — ממוזג ל-main)
    ✅ Client HMAC-SHA256 digest + payloadSignature ('ph:' prefix לביפאס ספרינט נוכחי)
    ✅ TelemetryDigest interface (11 שדות per RFC-001 §3.1) + ValidTripPayload fields
    ✅ try/catch סביב digest pipeline — signing failure לא קורס את processEndTrip
    ✅ 125 tests green, merged to main @ a66fb42

  Naveh (🔴 פתוח — ספרינט נוכחי)
    ○ Alembic migration: telemetry_digest (JSONB) +
      payload_signature (String 128) +
      phone_weighted_seconds (Float) → trips table
    ○ Atomic SQL UPDATE לנקודות משתמש (מניעת Lost Update)
    ○ איחוד מערכת רמות — /api/levels כ-Single Source of Truth

  Sean (🔴 פתוח — ספרינט נוכחי)
    ○ _validate_trip_plausibility() — sanity checks לפני DB write
    ○ _verify_signature() + ph: bypass (תואם לפלייסהולדר הלקוח)
    ○ bulk insert אירועים ל-events table
    ○ TRIP_SIGNING_SECRET → Azure Key Vault + .env.example
    ✗ _server_calculate_score() — נדחה (ראה §2.3)
    ✗ Score mismatch enforcement — נדחה (ראה §2.3)

  Mai (🟡 פתוח — ספרינט נוכחי)
    ○ 422 SCORE_MISMATCH → toast "נסיעה נדחתה" (לא retry)
    ○ 403 INVALID_SIGNATURE → toast + trip_id copy לתמיכה

══════════════════════════════════════════════════════════════
  Sprint+1  [קשיחה ואבטחה מלאה]
══════════════════════════════════════════════════════════════

  Dan
    ○ שדרוג ל-expo-crypto HMAC-SHA256 אמיתי
    ○ App Attestation (iOS) / Play Integrity (Android)
    ○ [v1.7] עדכון TelemetryDigest TypeScript: touchEpochs + screenInteractionSeconds (phoneSeconds הוסר)
    ○ [v1.7] עדכון AppContext.buildTelemetryDigest() לשדות החדשים
    ○ [v1.7] עדכון scoring.py: phone_seconds → touch_epochs + screen_interaction_seconds
    ○ [v1.7] עדכון test_scoring.py: 5 וקטורי בדיקה חדשים לנוסחה v1.7

  Sean
    ○ הסרת ph: bypass — סירוב מוחלט לחתימות לא תקפות
    ○ Rate limiting: מקסימום 20 נסיעות ליום / משתמש

  Naveh
    ○ Composite index: fraud_reports(user_id, reported_at DESC)
    ○ Active-trip checkpoint table (שחזור ממוות סוללה)

  Mai
    ○ [v1.7] PhoneUsageManager refactor — IMU-based touchEpochs + screenInteractionSeconds
    ○ [v1.7] Calibrate HANDHELD_THRESHOLD: נסיעות בדיקה (טלפון ביד מול תושבת)
    ○ [v1.7] עדכון TripData types ב-driving-sdk עם שדות חדשים
══════════════════════════════════════════════════════════════
```

### קריטריוני כניסה ל-Sprint+1 (Definition of Done — ספרינט נוכחי)

| בעל תפקיד | קריטריון | בדיקה |
|-----------|---------|-------|
| Naveh | Migration הורץ ב-staging, `alembic current` = head | `alembic history` |
| Sean | POST `/api/trips` עם `avg_score=150` מחזיר 422 | curl test |
| Sean | POST עם `distance_km=5000` מחזיר 422 | curl test |
| Sean | POST עם `ph:` signature עובר ✓ | integration test |
| Dan | `payloadSignature` שנשלח ≠ `undefined` בכל POST | log audit |

---

## 6. הבטחות שאסור לשבור

1. **Mai's SDK Boundary:** אין לוגיקה עסקית של CARMA תחת `mobile/src/lib/driving-sdk/` — גבול זה נצחי וסגור לכל פולש.
2. **No Breaking Schema Changes:** שדות `telemetryDigest` ו-`payloadSignature` הם אופציונליים לאורך כל ספרינט הנוכחי — אין שבירת תאימות לאחור עם גרסאות app ישנות שעדיין ב-store.
3. **125 Tests Must Stay Green:** כל שינוי ב-`ValidTripPayload` שומר תאימות מלאה עם `makePayload()` בבדיקות — הוספת שדות אופציונליים בלבד.
4. **Idempotency is Sacred:** ה-Idempotency-Key protocol אינו משתנה — retry בטוח נשמר גם אחרי 422.
5. **422 לעולם לא גורם לאובדן נסיעה:** נסיעה שנדחית ב-422 (plausibility או חתימה לא תקפה) אינה נכנסת לתור SyncManager. היא נרשמת ל-audit log עם `trip_id` ומוצגת למשתמש — לא נשלחת שוב.
6. **Permanent 422 ≠ Network Error:** `SyncManager.PERMANENT_FAILURE_STATUSES` כבר מכיל `422` — הגדרה זו נשמרת ונאכפת.

---

---

## 7. Cryptographic Upgrade — Time-Based Replay Protection (v1.4)

> This section is the authoritative English specification for the replay-protection layer
> added in v1.4. All implementation work in §4.1 (Sean) and Layer 2 (Dan/Mai) must
> conform exactly to this contract.

### 7.1 Threat Model

The `ph:` bypass introduced in Sprint 1 was an intentional placeholder. Two attack vectors
remain open until this section is fully implemented:

| Attack | Vector | Mitigation |
|--------|--------|------------|
| **Replay attack** | Attacker captures a valid signed request and resubmits it later with a different `idempotency_key` to earn duplicate points | Timestamp drift window (§7.3) |
| **Data tampering** | Attacker intercepts a request in transit and modifies `points` or `distanceKm` without re-signing | HMAC integrity check (§7.4) |

### 7.2 Payload Mutation — Timestamp Injection

Before the signing step, the mobile client **must** append a `timestamp` field to the
`TelemetryDigest` object:

```typescript
// mobile/src/context/AppContext.tsx — buildTelemetryDigest()  [v1.7 — no avgScore, no points, no phoneSeconds]
const digest: TelemetryDigest = {
  distanceKm,
  durationSeconds,
  hardBrakes,
  aggressiveAccels,
  sharpTurns,
  touchEpochs,               // v1.7 — SDK-provided active interaction count
  screenInteractionSeconds,   // v1.7 — SDK-provided IMU hand-held detection
  riskMultiplier,
  startTime: startTime.toISOString(),
  endTime:   endTime.toISOString(),
  timestamp: Date.now(),      // millisecond Unix epoch — replay nonce, injected last
  // avgScore and points are NOT included — server computes them from the raw fields above
  // phoneSeconds REMOVED in v1.7 — see §2.4
};
```

`Date.now()` is injected **after** all trip metrics are finalized and **before** the HMAC
is computed. The timestamp becomes part of the signed payload — any server that replays
the request after the drift window will be rejected without needing to track nonces.

### 7.3 Drift Control — Replay Attack Mitigation (HTTP 401)

```python
# server/app/services/trips.py
import time

_REPLAY_WINDOW_MS = 5 * 60 * 1000  # ±5 minutes in milliseconds

def _check_timestamp_drift(digest: dict | None) -> None:
    """Rejects payloads whose embedded timestamp falls outside the ±5-minute window.

    This makes captured requests non-replayable after 5 minutes regardless of whether
    the idempotency key has been seen before.
    """
    if digest is None:
        return
    ts = digest.get("timestamp")
    if ts is None:
        return  # unsigned legacy payload — plausibility gate is the only backstop
    now_ms = int(time.time() * 1000)
    drift = abs(now_ms - int(ts))
    if drift > _REPLAY_WINDOW_MS:
        audit("trips.signature.replay", ts=ts, now_ms=now_ms, drift_ms=drift)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            f"Timestamp outside ±5-minute window (drift={drift // 1000}s) — replay rejected",
        )
```

**Call site in `save()`** — drift check must precede HMAC verification:

```python
_validate_plausibility(dto)
_check_timestamp_drift(dto.telemetry_digest)    # 401 — stale / replayed
_verify_signature(                               # 403 — tampered / forged
    dto.telemetry_digest,
    dto.payload_signature,
    settings.trip_signing_secret,
)
```

### 7.4 Integrity Check — Tamper / Forgery Mitigation (HTTP 403)

The canonical string for HMAC computation is the **stable JSON serialisation of the entire
`TelemetryDigest` object** (including the embedded `timestamp`). The shared secret is the
HMAC *key*, not part of the message.

```python
# server/app/services/trips.py — updated _verify_signature()
def _verify_signature(digest: dict | None, signature: str | None, secret: str) -> None:
    if not signature:
        return
    if signature.startswith("ph:"):
        audit("trips.signature.bypass", reason="ph-placeholder-sprint1")
        return
    if not secret:
        return
    if digest is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "payloadSignature present but telemetryDigest is absent",
        )
    canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
    expected = _hmac.new(
        secret.encode(),
        canonical.encode(),      # message = canonical JSON of digest (timestamp included)
        hashlib.sha256,
    ).hexdigest()
    if not _hmac.compare_digest(expected, signature):
        audit("trips.signature.rejected", reason="hmac-mismatch")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid payload signature")
```

> **Breaking change from v1.3:** The v1.3 prototype used `f"{secret}:{canonical}"` as the
> HMAC message — prepending the secret to the message string. v1.4 uses `canonical` alone
> as the message, with `secret` passed exclusively as the HMAC *key*. Both client and
> server implementations must adopt the same convention simultaneously during the Sprint+1
> cut-over.

### 7.5 Client-Side HMAC (Sprint+1 — removes `ph:` placeholder)

```typescript
// mobile/src/context/AppContext.tsx — signTelemetryDigest()
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils";

function signTelemetryDigest(digest: TelemetryDigest, secret: string): string {
  const canonical = stableStringify(digest);   // JSON.stringify with sorted keys
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(canonical));
  return bytesToHex(mac);
}
```

`@noble/hashes` is a zero-dependency, audited pure-TypeScript cryptography library
(MIT license, ~8 kB gzip). It is the only approved HMAC library for the mobile client.
Do **not** use `crypto-js` (outdated, slow) or attempt to call a native module from inside
`driving-sdk/`.

### 7.6 Error Response Contract

| Condition | HTTP Status | Body |
|-----------|-------------|------|
| `timestamp` absent (unsigned payload) | `200` / proceeds normally | — |
| `|drift| > 300 000 ms` | `401 Unauthorized` | `"Timestamp outside ±5-minute window"` |
| HMAC mismatch | `403 Forbidden` | `"Invalid payload signature"` |
| `payloadSignature` present, `telemetryDigest` absent | `403 Forbidden` | `"payloadSignature present but telemetryDigest is absent"` |
| `ph:` prefix (sprint placeholder) | `200` / proceeds | audit log entry |

### 7.7 Definition of Done — Sprint+1 Gate

All of the following must pass before `ph:` bypass is removed from production:

```
Cryptographic gates
  ☐  _check_timestamp_drift: unit test — drift = 299 999 ms → pass
  ☐  _check_timestamp_drift: unit test — drift = 300 001 ms → HTTP 401
  ☐  _verify_signature: unit test    — correct HMAC         → pass
  ☐  _verify_signature: unit test    — flipped bit in digest → HTTP 403
  ☐  Mobile: timestamp field present in every POST /api/trips payload (log audit)
  ☐  Mobile: HMAC computed with @noble/hashes, not crypto-js or ph: prefix

Scoring decoupling (v1.5)
  ☐  server/app/services/scoring.py exists and calculate_score() passes parity tests (§8.3)
  ☐  trips.save() uses server-computed avg_score / points — client-sent values ignored
  ☐  Active trip HUD contains no 0–100 score render
  ☐  Trip summary shows server-returned score (not a locally calculated value)

Distraction telemetry v1.7 (Sprint+1 gate — requires Mai's SDK delivery first)
  ☐  PhoneUsageManager refactored: touchEpochs + screenInteractionSeconds provided by SDK
  ☐  HANDHELD_THRESHOLD calibrated and approved by Dan from empirical drive tests
  ☐  TelemetryDigest TypeScript interface updated (phoneSeconds removed, new fields added)
  ☐  AppContext.buildTelemetryDigest() passes touchEpochs + screenInteractionSeconds
  ☐  scoring.py calculate_score() updated with touch_epochs + screen_interaction_seconds
  ☐  test_scoring.py: 5 v1.7 parity vectors pass (replaces phone_seconds vectors)
  ☐  e2e_v17.py: Scenario covering touchEpochs=5, screenInteractionSec=60 → expected score=78.0

Baseline
  ☐  npm test inside ./mobile → 125/125 PASS
  ☐  npx tsc --noEmit → exit 0
  ☐  No files modified under mobile/src/lib/driving-sdk/
```

---

## 8. Server Scoring Algorithm Specification (v1.5)

> This section is the authoritative contract for `server/app/services/scoring.py`.
> The Python implementation must produce identical outputs to `mobile/src/lib/scoring.ts`
> for every valid input. Any divergence between the two is a bug in the Python port.

### 8.1 Formula Contract

The scoring formula is a deliberate design choice locked by Dan. It must not be
altered on either side without a versioned RFC amendment.

```
safe_duration   = max(durationSeconds, 1)

penalties       = hardBrakes                                × 5
                + aggressiveAccels                          × 3
                + sharpTurns                                × 2
                + touchEpochs                               × 4
                + (screenInteractionSeconds / safe_duration) × 40

score           = clamp(100 − penalties, 0.0, 100.0)     // [0, 100] inclusive

distance_factor = ln(distanceKm + 1) / ln(11)            // ln = natural log

risk_multiplier = get_risk_multiplier(startTime)         // 1.0 | 1.5 | 2.0

points          = score × distance_factor × risk_multiplier

// Both score and points are rounded to 1 decimal place before storage:
avg_score_stored = round(score × 10) / 10
points_stored    = round(points × 10) / 10
```

> **Sprint+1 implementation note:** The current `scoring.py` uses `phone_seconds` as a
> deprecated compatibility parameter while `PhoneUsageManager` is being refactored by Mai.
> The v1.7 formula above (`touch_epochs` + `screen_interaction_seconds`) goes live in Sprint+1
> simultaneously with the SDK delivery. Until then, `phone_seconds` serves as a
> structural placeholder — no code changes required on the server side before Sprint+1.

### 8.2 Risk Multiplier Table

| Condition | Multiplier |
|-----------|-----------|
| Not night (04:00–22:59 local) | `1.0` |
| Night (23:00–03:59) — weekday | `1.5` |
| Night (23:00–03:59) — Thu / Fri / Sat (Israeli weekend) | `2.0` |

```python
# Weekday mapping — must match JavaScript's Date.getDay() semantics:
# JavaScript: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
# Python:     Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
# Israeli weekend nights:
#   JS   → day in (4, 5, 6)   → Thu, Fri, Sat
#   Python → weekday() in (3, 4, 5) → Thu, Fri, Sat  ✓
```

### 8.3 Cross-Language Parity Test Vectors

The following inputs must produce identical outputs in both TypeScript and Python.
Use these as the acceptance test for `scoring.py`:

| # | hardBrakes | aggrAccels | sharpTurns | touchEpochs | screenInteractionSec | durSec | distKm | startTime (UTC) | Expected score | Expected points |
|---|-----------|-----------|-----------|------------|---------------------|--------|--------|-----------------|---------------|-----------------|
| 1 | 0 | 0 | 0 | 0 | 0 | 1800 | 15.0 | Tue 14:00 | 100.0 | 115.6 |
| 2 | 3 | 2 | 1 | 3 | 30 | 600 | 5.0 | Mon 10:00 | 63.0 | 47.1 |
| 3 | 10 | 5 | 3 | 20 | **900** | 900 | 8.0 | Fri 23:30 | 0.0 | 0.0 |
| 4 | 1 | 0 | 0 | 0 | 0 | 3600 | 50.0 | Thu 23:00 | 95.0 | 311.5 |
| 5 | 0 | 0 | 0 | 5 | 60 | 1200 | 12.0 | Sat 01:00 | 78.0 | 166.9 |

> Vector 2: penalties = 15+6+2 + (3×4) + (30/600)×40 = 23+12+2 = 37 → score=63.0, points=63.0×0.747×1.0=47.1
> Vector 3 demonstrates score flooring: penalties = 50+15+6 + (20×4) + (900/900)×40 = 71+80+40 = 191 → score=0.0
> Vector 4/5 demonstrate the ×2.0 weekend-night multiplier. Vectors 1/4 unchanged (no distraction events).
> Vector 5: penalties = 0+0+0 + (5×4) + (60/1200)×40 = 0+20+2 = 22 → score=78.0, points=78.0×1.070×2.0=166.9
>
> **Sprint+1 note:** These vectors reflect the v1.7 formula target state. The current
> `server/tests/test_scoring.py` (14/14 green) tests the `phone_seconds` implementation
> and will be replaced in Sprint+1 when `calculate_score()` is updated with the new parameters.

### 8.4 `TripOut` Response — Score Fields

After `calculate_score()` runs, the server writes `avg_score` and `points` to the `Trip`
row and returns them to the mobile client in the `TripOut` response body:

```python
# trips.save() — after gate checks:
avg_score, points, risk_mul = calculate_score(
    hard_brakes       = dto.hard_brakes or 0,
    aggressive_accels = dto.aggressive_accels or 0,
    sharp_turns       = dto.sharp_turns or 0,
    phone_seconds     = dto.phone_seconds or 0,
    duration_seconds  = dto.duration_seconds or 0,
    distance_km       = dto.distance_km or 0.0,
    start_time        = start,
)

trip = Trip(
    ...
    avg_score        = avg_score,   # ← server-computed, not dto.avg_score
    points           = points,      # ← server-computed, not dto.points
    risk_multiplier  = risk_mul,
    ...
)
```

The mobile client receives `avg_score` and `points` in the `POST /api/trips` response
and displays them in the post-trip summary screen. These values are the single source
of truth — they match what is stored in the DB.

---

*RFC-001 v1.7 | CTO Signature: Dan Ofri | 2026-05-21*
*Amendments: v1.4 Time-Based Nonce · v1.5 Absolute Metrics Decoupling · v1.7 Distraction Telemetry Paradigm Shift*
