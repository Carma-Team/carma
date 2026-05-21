# RFC-001: ארכיטקטורת Hybrid Validation — "Double Brain"
**מסמך:** RFC-001 | **גרסה:** 1.3 | **תאריך:** 2026-05-20
**מחבר:** Dan Ofri (CTO) | **ענף:** `feature/hybrid-validation-contract` → ממוזג ל-`main` (`a66fb42`)
**סטטוס:** 🚨 CRASH-PROGRAM — כל משימות הליבה מבוצעות בספרינט הנוכחי. אין דחייה לעתיד.

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
}
```

### 3.2 פרוטוקול חתימה

```
canonical_json  = JSON.stringify(digest, sorted_keys)
hmac_input      = APP_SECRET + ":" + canonical_json
signature       = HMAC-SHA256(hmac_input)
header          = "Idempotency-Key: <localTripId>"
body.payloadSignature = "ph:<32-char-hex>"  // placeholder עד להטמעת expo-crypto
```

**ספרינט נוכחי — Phase 1+2 ממוזגים:**
- HMAC-SHA256 פעיל בלקוח (`ph:` prefix לביפאס ספרינט נוכחי) — שרת מקבל ומאגר ל-DB
- Sean מיישם `_verify_signature()` עם bypass זמני ל-`ph:` בלבד
- Dan משדרג ל-HMAC-SHA256 אמיתי דרך `expo-crypto` ברגע שמנגנון הסוד מוכן

**Sprint+1:** `expo-crypto.digestStringAsync(CryptoAlgorithm.HMAC_SHA256, ...)` עם מפתח מנוהל דרך App Attestation (iOS) / Play Integrity (Android) — הסרת ה-`ph:` bypass לחלוטין.

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

*RFC-001 v1.1 | CTO Signature: Dan Ofri | 2026-05-20 | Crash-Program Revision*
