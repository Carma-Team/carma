# RFC-001: ארכיטקטורת Hybrid Validation — "Double Brain"
**מסמך:** RFC-001 | **גרסה:** 1.0 | **תאריך:** 2026-05-20
**מחבר:** Dan Ofri (CTO) | **ענף:** `feature/hybrid-validation-contract`
**סטטוס:** פעיל — מיועד לביצוע בשלב ההנדסי הבא

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
 │  2. חישוב ציון עצמאי (Python mirror של scoring.ts)             │
 │  3. השוואת server_score vs client_score — reject אם ∆ > 5      │
 │  4. sanity checks: distance/speed/duration plausibility         │
 │  5. atomic UPDATE points — מניעת Lost Update                    │
 │  6. שמירת telemetryDigest ל-DB לצורך audit                     │
 └─────────────────────────────────────────────────────────────────┘
```

### 2.2 עקרון ה-"חוזה כפול"

| היבט | לקוח | שרת |
|------|------|------|
| **מטרה** | UX מיידי, אנימציות, עדכון UI בזמן אמת | אמת יחיד, הגנת נתונים |
| **ניקוד** | מחשב לצורך תצוגה | מחשב מחדש לצורך שמירה |
| **הונאה** | מסנן עם FraudDetector (Train/Bus) | מאמת telemetry plausibility |
| **נקודות** | מעדכן state מקומי | מעדכן DB באופן אטומי |
| **חתימה** | מייצר HMAC-SHA256 | מאמת HMAC-SHA256 |

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

**Phase 1 (current):** FNV-1a hash placeholder — deterministic, מספיק לפיתוח ולבדיקות.
**Phase 2 (Production):** `expo-crypto.digestStringAsync(CryptoAlgorithm.HMAC_SHA256, ...)` עם מפתח שמנוהל דרך App Attestation (iOS) / Play Integrity (Android).

---

## 4. משימות לפי בעלי תפקידים

---

### 4.1 Sean — Backend Lead (עדיפות יורדת)

#### [SEAN-P0] נתיב אימות מהיר — `/api/trips` Validation Gate

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

#### [SEAN-P0] חישוב ציון עצמאי בצד-שרת

**מה:** מרר את נוסחת הניקוד של `scoring.ts` ב-Python ב-`server/app/services/trips.py`. השוה בין ציון הלקוח לציון השרת.

```python
def _server_calculate_score(dto: SaveTripIn) -> float:
    dur = max(dto.duration_seconds or 1, 1)
    phone_w = dto.phone_seconds or 0  # Phase 2: accept phoneWeightedSeconds
    penalties = (
        (dto.hard_brakes or 0) * 5 +
        (dto.aggressive_accels or 0) * 3 +
        (dto.sharp_turns or 0) * 2 +
        (phone_w / dur) * 40
    )
    return max(0.0, min(100.0, 100.0 - penalties))

# בתוך save():
server_score = _server_calculate_score(dto)
if dto.avg_score is not None:
    delta = abs(server_score - dto.avg_score)
    if delta > 5.0:  # סבלנות 5 נקודות לעיגולים/פרמטרים שחסרים בשרת
        audit("trips.score_mismatch", user_id=user.id,
              client=dto.avg_score, server=server_score, delta=delta)
        raise HTTPException(422, f"Score mismatch: client={dto.avg_score}, server={server_score:.1f}")
trip.avg_score = round(server_score, 1)  # שרת קובע — לא הלקוח
```

#### [SEAN-P1] אימות חתימת HMAC-SHA256

**מה:** לאחר שמנגנון ניהול המפתחות ייקבע (Phase 2), הוסף middleware לאימות `payloadSignature` ב-`routers/trips.py`.

```python
# server/app/routers/trips.py
import hmac, hashlib

SHARED_SECRET = settings.trip_signing_secret  # env var, Vault/KeyVault

def _verify_signature(digest: dict, signature: str | None) -> None:
    if not signature or signature.startswith("ph:"):
        return  # Phase 1 placeholder — accept without verification
    canonical = json.dumps(digest, sort_keys=True)
    expected = hmac.new(
        SHARED_SECRET.encode(), (SHARED_SECRET + ":" + canonical).encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(403, "Invalid payload signature")
```

#### [SEAN-P1] שמירת אירועי נסיעה ל-Event table

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

#### [SEAN-P2] Rate Limiting על `/api/trips`

**מה:** הוסף middleware rate limit — לא יותר מ-20 נסיעות ביום למשתמש.

---

### 4.2 Naveh — Database Lead (עדיפות יורדת)

#### [NAVEH-P0] עדכון אטומי של נקודות משתמש — מניעת Lost Update

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

#### [NAVEH-P0] Migration: הוסף עמודת `telemetry_digest` לטבלת `trips`

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

```bash
# Migration:
alembic revision --autogenerate -m "add telemetry_digest and payload_signature to trips"
alembic upgrade head
```

#### [NAVEH-P1] הוסף עמודת `phone_weighted_seconds` לטבלת `trips`

**מה:** הלקוח שולח `phoneSeconds` (גולמי) ומשתמש ב-`phoneWeightedSeconds` לחישוב הציון. השרת שומר רק את הגולמי. ללא השדה המשוקלל, השרת לא יכול לשחזר את הציון.

```python
# server/app/models/trip.py
phone_weighted_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
```

```python
# server/app/schemas/trip.py — SaveTripIn
phone_weighted_seconds: float | None = Field(
    default=None,
    validation_alias=AliasChoices("phoneWeightedSeconds", "phone_weighted_seconds")
)
```

#### [NAVEH-P1] איחוד מערכת הרמות — Single Source of Truth

**מה:** כרגע `gamification.ts` ו-`constants.ts` מגדירים שתי מפות רמות שונות לחלוטין (pragot שונים). יש ליצור endpoint `/api/levels` שמחזיר מפה אחת סמכותית מה-DB, ולהבטיח ש-`gamification.ts` משתמשת בנתוני השרת ולא בקבועים קשיחים.

**Alembic migration:** הוסף טבלת `levels` עם `min_points`, `multiplier`, `label`.

#### [NAVEH-P2] Index על `fraud_reports.user_id + reported_at`

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

### 4.4 Dan — CTO (בוצע בענף זה)

#### [DAN-P0] שכבת Telemetry Digest + Payload Signing ✅

**מה:** הוטמע ב-`AppContext.tsx` ו-`sync/types.ts` בענף זה.

- `buildTelemetryDigest()` — מחשב snapshot נקי של מטריקות הנסיעה
- `signTelemetryDigest()` — FNV-1a placeholder חד-כיווני (Phase 2: HMAC-SHA256 אמיתי)
- `TelemetryDigest` interface — מוסיף לסכמת `ValidTripPayload` כשדות אופציונליים
- **לא נגעו** בשום קובץ תחת `mobile/src/lib/driving-sdk/`

---

## 5. פרוטוקול ה-Rollout

```
Phase 1 (current — ענף זה):
  ✅ Client signs payload with FNV-1a placeholder
  ✅ Server accepts but ignores signature (ph: prefix)
  ✅ TelemetryDigest stored in DB (after Naveh migration)

Phase 2 (Sprint+1):
  ○ Sean implements server-side score recalculation
  ○ Sean implements plausibility validation
  ○ Naveh adds telemetry_digest column + atomic points UPDATE
  ○ Dan upgrades to real HMAC-SHA256 via expo-crypto

Phase 3 (Sprint+2):
  ○ Sean enforces signature rejection (remove ph: bypass)
  ○ App Attestation / Play Integrity key provisioning
  ○ Rate limiting on /api/trips
```

---

## 6. הבטחות שאסור לשבור

1. **Mai's SDK Boundary:** אין לוגיקה עסקית של CARMA תוך `mobile/src/lib/driving-sdk/`
2. **No Breaking Schema Changes:** כל שדות ה-`telemetryDigest` ו-`payloadSignature` הם אופציונליים עד Phase 3
3. **125 Tests Must Stay Green:** כל שינוי ב-`ValidTripPayload` חייב לשמור על תאימות לאחור עם `makePayload()` הקיים בבדיקות
4. **Idempotency is Sacred:** ה-Idempotency-Key protocol אינו משתנה — retry בטוח נשמר

---

*RFC-001 | CTO Signature: Dan Ofri | 2026-05-20*
