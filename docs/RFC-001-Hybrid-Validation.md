# RFC-001: ארכיטקטורת Hybrid Validation — "Double Brain"
**מסמך:** RFC-001 | **גרסה:** 1.4 | **תאריך:** 2026-05-21
**מחבר:** Dan Ofri (CTO) | **ענף:** `feature/hybrid-validation-contract` → ממוזג ל-`main` (`a66fb42`)
**סטטוס:** 🚨 CRASH-PROGRAM — כל משימות הליבה מבוצעות בספרינט הנוכחי. אין דחייה לעתיד.

> **v1.4 Amendment:** Time-Based Nonce + HMAC-SHA256 replay protection added — see §7.

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
 │  MOBILE CLIENT ("The Fast Brain")                               │
 │                                                                 │
 │  CarmaDrivingSDK → SensorManager → TripValidationManager       │
 │        ↓ events + telemetry                                     │
 │  AppContext.processEndTrip()                                    │
 │        ├── calculateScore()     ← UX/UI מיידי                   │
 │        ├── buildTelemetryDigest() ← תמצית מטריקות נסיעה         │
 │        └── signTelemetryDigest() ← HMAC-SHA256 (placeholder)    │
 │                    ↓ ValidTripPayload + telemetryDigest + sig    │
 └─────────────────────────────────────────────────────────────────┘
                              │  HTTPS POST /api/trips
                              ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  FASTAPI SERVER ("The Supreme Judge")                           │
 │                                                                 │
 │  1. אימות חתימה (HMAC verify) — reject אם לא תואם             │
 │  2. sanity checks: distance/speed/duration plausibility         │
 │  3. atomic UPDATE points — מניעת Lost Update                    │
 │  4. שמירת telemetryDigest ל-DB לצורך audit                     │
 │                                                                 │
 │  ⚠️  השוואת ניקוד לקוח/שרת — נדחתה (ראה §2.3)               │
 └─────────────────────────────────────────────────────────────────┘
```

### 2.2 עקרון ה-"חוזה כפול"

| היבט | לקוח | שרת |
|------|------|------|
| **מטרה** | UX מיידי, אנימציות, עדכון UI בזמן אמת | אמת יחיד, הגנת נתונים |
| **ניקוד** | מחשב לצורך תצוגה — הציון שנשלח נשמר כפי שהוא | אינו מחשב מחדש ואינו משווה (ראה §2.3) |
| **הונאה** | מסנן עם FraudDetector (Train/Bus) | מאמת plausibility: מרחק, מהירות, משך, נקודות |
| **נקודות** | מעדכן state מקומי | מעדכן DB באופן אטומי |
| **חתימה** | מייצר HMAC-SHA256 | מאמת HMAC-SHA256 |

### 2.3 החלטת CTO — דחיית השוואת ניקוד לקוח/שרת

**תאריך:** 2026-05-20 | **מחליט:** Dan Ofri (CTO)

**מה נדחה:** חישוב ניקוד עצמאי בשרת (`_server_calculate_score`) והשוואתו לניקוד הלקוח עם דחיית בקשה אם הפער גדול מ-7 נקודות.

**הנימוק:** כל שינוי עתידי בנוסחת הניקוד יגרור סנכרון כפוי בין כל גרסאות האפליקציה הפעילות בחנות לבין השרת. גרסה ישנה שעדיין מותקנת תחשב לפי הנוסחה הישנה, תישלח לשרת שמחשב לפי הנוסחה החדשה, והפער יגרור שגיאת 422 על נסיעות לגיטימיות לחלוטין. המורכבות התפעולית אינה מצדיקה את שכבת ההגנה הנוספת בשלב זה.

**מה נשאר בתוקף:**
- בדיקות plausibility גולמיות (מרחק, מהירות, משך, נקודות) — חוסמות זיופים גסים
- אימות חתימת HMAC-SHA256 — יחסום מניפולציה עדינה ברגע שיממומש במלואו

**תנאי לחזרה לדיון:** כאשר הנוסחה יציבה ויש אסטרטגיית ניהול גרסאות (versioning) מוגדרת לאפליקציה.

---

## 3. מפרט הטכני — TelemetryDigest

### 3.1 מבנה הנתונים

```typescript
// mobile/src/services/sync/types.ts
export interface TelemetryDigest {
  avgScore:         number;  // ציון מחושב מקומית (0–100, עשירית)
  points:           number;  // נקודות גולמיות לפני מכפיל רמה
  distanceKm:       number;  // מרחק בק"מ (3 ספרות אחרי נקודה)
  durationSeconds:  number;  // משך נסיעה בשניות
  hardBrakes:       number;  // ספירת אירועי בלימה חזקה
  aggressiveAccels: number;  // ספירת האצות אגרסיביות
  sharpTurns:       number;  // ספירת פניות חדות
  phoneSeconds:     number;  // שניות שימוש בטלפון (מעוגל)
  riskMultiplier:   number;  // מכפיל סיכון (שעה/יום)
  startTime:        string;  // ISO 8601 UTC
  endTime:          string;  // ISO 8601 UTC
  timestamp:        number;  // [v1.4] millisecond Unix epoch — Date.now() at signing time
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

#### ~~[SEAN-P0] חישוב ציון עצמאי בצד-שרת~~ — נדחה (ראה §2.3)

> החלטת CTO מ-2026-05-20: השוואת ניקוד לקוח/שרת נדחית עקב מורכבות ניהול גרסאות. השרת שומר את הציון שהלקוח שלח כפי שהוא. אין לממש `_server_calculate_score` או `SCORE_MISMATCH` enforcement.

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

> **קריטי:** `phone_weighted_seconds` חיוני לכך ש-Sean יוכל לשחזר את הציון המדויק מהלקוח ב-`_server_calculate_score()`. ללא שדה זה, כל נסיעה עם שימוש בטלפון בפועל תייצר delta שקרי ותיחסם ב-422. **שתי העמודות (`telemetry_digest`, `phone_weighted_seconds`) חייבות להיכנס לאותה Alembic migration בספרינט הנוכחי.**

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

#### [MAI-P0] גשר `currentSpeedKmH` — עדכון State מ-SDK

**מה:** `sdk.onUpdate` ב-`AppContext.tsx` מקבל `data: TripData` מ-`CarmaDrivingSDK` אבל **אינו מעדכן** את `tripState.currentSpeedKmH`. כתוצאה, כל ממשק שמציג מהירות נוכחית מקבל `0 km/h` תמידית.

**תיקון:** הוסף את השדה ל-`sdk.onUpdate` callback:

```typescript
// AppContext.tsx — sdk.onUpdate handler
sdk.onUpdate = (data: TripData) => {
  const phoneWeightedSeconds = computePhoneWeightedSeconds(data)
  setTripState(prev => ({
    ...prev,
    isActive: true,
    currentSpeedKmH: data.averageSpeed, // ← הוסף שורה זו
    durationSeconds: data.durationSeconds,
    ...
  }));
};
```

**הערה:** `CarmaDrivingSDK` לא חושף `currentSpeed` דרך `TripData` כרגע — יש להוסיף שדה `currentSpeedKmH?: number` ל-`TripData` ב-`driving-sdk/types.ts` ולמלא אותו ב-`handleSensorUpdate`. **אסור לשנות קבצים בתוך `driving-sdk/` ישירות** — שלחי PR לדן לאישור גבול ה-SDK.

#### [MAI-P1] Toast/Modal לדחיית נסיעה על-ידי השרת

**מה:** כאשר השרת מחזיר `422 Unprocessable Entity` (ניקוד לא תואם / signature לא תקף), `tripsApi.save()` זורק `ApiError`. כרגע זה מוצנן ל-`SyncManager.enqueue()` — המשתמש לא מקבל שום הסבר.

**תיקון נדרש:** בקוד הטיפול בשגיאות ב-`AppContext.processEndTrip()`:
```typescript
} catch (e) {
  if (e instanceof ApiError && e.status === 422) {
    // trip rejected by server — show error toast, do NOT enqueue for retry
    addToast({ title: 'נסיעה נדחתה', message: 'השרת זיהה חוסר עקביות בנתונים', type: 'error' })
  } else {
    await SyncManager.enqueue(validTripPayload)
  }
}
```

**Mai:** עצבי את ה-modal עם כפתור "פנה לתמיכה" + copy של `trip_id` לשיתוף עם Support.

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

  Sean
    ○ הסרת ph: bypass — סירוב מוחלט לחתימות לא תקפות
    ○ Rate limiting: מקסימום 20 נסיעות ליום / משתמש
    ○ Score delta threshold מ-7.0 → 5.0 (phone_weighted_seconds זמין)

  Naveh
    ○ Composite index: fraud_reports(user_id, reported_at DESC)
    ○ Active-trip checkpoint table (שחזור ממוות סוללה)
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
// mobile/src/context/AppContext.tsx — buildTelemetryDigest()
const digest: TelemetryDigest = {
  avgScore,
  points,
  distanceKm,
  durationSeconds,
  hardBrakes,
  aggressiveAccels,
  sharpTurns,
  phoneSeconds,
  riskMultiplier,
  startTime: startTime.toISOString(),
  endTime:   endTime.toISOString(),
  timestamp: Date.now(),            // millisecond Unix epoch — injected last
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
☐  _check_timestamp_drift: unit test — drift = 299 999 ms → pass
☐  _check_timestamp_drift: unit test — drift = 300 001 ms → HTTP 401
☐  _verify_signature: unit test    — correct HMAC         → pass
☐  _verify_signature: unit test    — flipped bit in digest → HTTP 403
☐  Mobile: timestamp field present in every POST /api/trips payload (log audit)
☐  Mobile: HMAC computed with @noble/hashes, not crypto-js or ph: prefix
☐  npm test inside ./mobile → 125/125 PASS
☐  No files modified under mobile/src/lib/driving-sdk/
```

---

*RFC-001 v1.4 | CTO Signature: Dan Ofri | 2026-05-21 | Time-Based Replay Protection Amendment*
