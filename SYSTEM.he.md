# CARMA — תיעוד מערכת מלא

> מסמך זה מתאר את צד-השרת של CARMA, את האינטגרציה עם אפליקציית המובייל, ואת התשתית סביב (DB, Docker, CI/CD, Azure, Monitoring). הגרסה האנגלית: [SYSTEM.md](SYSTEM.md).

---

## תוכן עניינים

1. [תקציר מנהלים](#1-תקציר-מנהלים)
2. [סקירת אדריכלות](#2-סקירת-אדריכלות)
3. [Tech Stack](#3-tech-stack)
4. [מבנה הריפו](#4-מבנה-הריפו)
5. [מסד הנתונים — סכמה והסבר](#5-מסד-הנתונים--סכמה-והסבר)
6. [מודולי השרת (Routers + Services)](#6-מודולי-השרת-routers--services)
7. [זרימות אימות](#7-זרימות-אימות)
8. [רפרנס API מלא](#8-רפרנס-api-מלא)
9. [אינטגרציה עם הפרונט](#9-אינטגרציה-עם-הפרונט)
10. [הרצה לוקאלית — צעד אחר צעד](#10-הרצה-לוקאלית--צעד-אחר-צעד)
11. [CI/CD ו-Deploy ל-Azure](#11-cicd-ו-deploy-ל-azure)
12. [Monitoring ו-Observability](#12-monitoring-ו-observability)
13. [מפת תאימות לאפיון](#13-מפת-תאימות-לאפיון)
14. [Out of Scope](#14-out-of-scope)
15. [הצעדים הבאים](#15-הצעדים-הבאים)

---

## 1. תקציר מנהלים

**מה זה:** Backend REST API ל-CARMA — פלטפורמת תגמולים לנהיגה בטוחה. השרת מספק לאפליקציית המובייל (Expo / React Native) את כל הפעולות: הרשמה והתחברות, שמירת נסיעות, חנות הפרסים (Marketplace), טבלת מובילים, וסטטיסטיקות.

**Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL 16 עם PostGIS + JWT auth + Twilio (אופציונלי).

**שני מסלולי אימות במקביל:**
- **Email + Password** — מה שהפרונט קורא לו בפועל.
- **Phone + OTP via SMS** — לפי האפיון הפורמלי (סעיף 4.2.1). מוכן לעתיד.

שני המסלולים מייצרים אותו JWT — לקוח שמחזיק token יכול לקרוא לכל ה-API ללא קשר לאיך התחבר.

**Deployment:** מבוסס קונטיינר — Dockerfile רב-שלבי, מתאים ל-Azure Container Apps. Postgres ב-Azure Database for PostgreSQL Flexible Server (תומך ב-PostGIS). Application Insights ל-monitoring.

**CI/CD:** שני workflows ב-`.github/workflows/`:
- `ci-server.yml` — ב-PR רץ רק lint (מהיר ובטוח). mypy/pytest/smoke ב-`workflow_dispatch` או label `run-full-ci` עד שהפייפליין מוכח.
- `ci-mobile.yml` — `npm ci` + tsc תמיד; tests בגייט.
- `deploy.yml` — מותנה ב-secret של Azure, ודילג בכל הרצה עד היום. המנוי הוא חשבון Azure for Students ואין בו service principal, ולכן ה-deploy ידני — ראו §11.

**נקודה חשובה:** הפרונט מערבב snake_case וcamelCase (כמו `start_time`, `avg_score`, `events_array`). Pydantic schemas משתמשים ב-`alias_generator=to_camel` שיוצא camelCase על החוט, ו-trip-save מקבל את שני הסגנונות דרך `AliasChoices`. הפרונט עובד ללא שינויים.

---

## 2. סקירת אדריכלות

```
┌────────────────────┐         ┌────────────────────┐
│ Expo / React Native│  HTTPS  │   FastAPI Server   │
│  (Mobile app)      │ ─────►  │  (server/, :3000)  │
│  AsyncStorage:     │ Bearer  │                    │
│  carma_token (JWT) │  token  │  Routers:          │
└────────────────────┘         │   auth · users     │
                               │   trips · rewards  │
                               │   vouchers ·       │
                               │   leaderboard ·    │
                               │   notifications    │
                               │   health           │
                               └─────────┬──────────┘
                                         │ SQLAlchemy async (asyncpg)
                                         ▼
                          ┌──────────────────────────┐
                          │ PostgreSQL + PostGIS 16  │
                          │  - users · otp_codes     │
                          │  - trips · events        │
                          │  - businesses · rewards  │
                          │  - redemptions · levels  │
                          └──────────────────────────┘

   ┌────────────┐                              ┌──────────────────────┐
   │  Twilio    │ ◄── SMS (כאשר SMS_PROVIDER= │ Application Insights │
   │ (OTP SMS)  │      twilio בפרודקשן)        │ (OpenTelemetry)      │
   └────────────┘                              └──────────────────────┘
```

**עקרונות:**
- האימות נאכף **לפי route** דרך ה-`CurrentUser` dependency של FastAPI. routes ללא ה-dependency הזה (auth/register, auth/login, OTP routes, health) הם פומביים.
- ה-DB ניגש רק דרך async SQLAlchemy sessions, מוזרק דרך `Depends(get_db)`.
- השרת stateless — אין session memory, ה-JWT נושא את הזהות.

---

## 3. Tech Stack

| שכבה | טכנולוגיה | למה |
|---|---|---|
| Runtime | Python 3.12 (slim במכולה) | מודרני, מהיר, תואם ל-`.venv` של הסדנה |
| Framework | FastAPI 0.115 | Async, OpenAPI אוטומטי, ילידי Pydantic |
| שפה | Python עם type hints + mypy strict | בטיחות טיפוסים |
| ORM | SQLAlchemy 2.0 (async, עם `asyncpg`) | סטנדרט פרודקשן, type-safety מלא ב-2.0 |
| Migrations | Alembic | סכמה-כקוד, autogenerate מהמודלים |
| DB | PostgreSQL 16 + PostGIS 3.4 | תמיכה במיקומים גיאוגרפיים (Marketplace ברדיוס) |
| Validation | Pydantic v2 + `pydantic-settings` | DTOs ו-env validation במודל אחד |
| Auth | `python-jose` (JWT) + `passlib[bcrypt]` | טוקנים stateless, hashing מאובטח לסיסמאות ו-OTP |
| SMS | Twilio (אופציונלי) | OTP בפרודקשן. בפיתוח `ConsoleSmsSender` מדפיס ל-stdout |
| Rate limit | `slowapi` | חניקת קצב לפי IP על endpoints של auth |
| Monitoring | `azure-monitor-opentelemetry` + OpenTelemetry instrumentations | אינסטרומנטציה אוטומטית של requests, DB, exceptions |
| Server | `uvicorn[standard]` | ASGI server |
| Tests | `pytest` + `pytest-asyncio` + `httpx` ASGITransport | מבחני async ללא שרת חי |
| Container | Docker multi-stage | image קטן לפרודקשן, מריץ migrations בעלייה |
| Local DB | Docker Compose (`postgis/postgis:16-3.4`) | אין צורך להתקין Postgres על Windows |
| CI | GitHub Actions | חינמי, אינטגרציה טבעית עם Azure |
| Cloud | Azure (Container Apps + Postgres Flexible + ACR + App Insights) | בחירת המשתמש |

---

## 4. מבנה הריפו

```
carma/                                # Carma-Team/carma (root של המונורפו)
├── .github/
│   ├── workflows/
│   │   ├── ci-server.yml             # lint תמיד; mypy/pytest/smoke בגייט (label/dispatch)
│   │   ├── ci-mobile.yml             # tsc תמיד; npm test בגייט
│   │   └── deploy.yml                # Azure Container Apps — מותנה ב-AZURE_CREDENTIALS
│   └── pull_request_template.md
│
├── server/                           # Backend פייתון (FastAPI)
│   ├── app/
│   │   ├── main.py · config.py · database.py · monitoring.py · seed.py
│   │   ├── models/                   # SQLAlchemy 2.0 (User, Trip, Event,
│   │   │                             #   Reward, Business, Redemption, Level, OtpCode)
│   │   ├── schemas/                  # Pydantic DTOs (CamelModel; פלט camelCase)
│   │   ├── core/                     # security (bcrypt + JWT), deps (DbSession, CurrentUser)
│   │   ├── services/                 # לוגיקה: auth, users, trips, rewards, leaderboard, sms
│   │   └── routers/                  # FastAPI routers: auth, users, trips, rewards,
│   │                                 #   leaderboard, notifications, health
│   ├── alembic/                      # Migrations
│   ├── tests/                        # pytest
│   ├── Dockerfile · docker-compose.yml
│   ├── requirements.txt · requirements-dev.txt · pyproject.toml
│   ├── .env.example
│   └── README.md
│
├── mobile/                           # Frontend Expo / React Native
│   ├── src/
│   │   ├── app/                      # expo-router screens (auth, tabs, admin, business)
│   │   ├── screens/, components/, context/, hooks/
│   │   ├── services/api/             # client.ts (Bearer), auth.api.ts, trips.api.ts, ...
│   │   │   └── generated.ts          # נוצר אוטומטית מ-/api/openapi.json (gitignored)
│   │   ├── lib/driving-sdk/          # סימולציית IMU/GPS/BLE
│   │   └── types/                    # interfaces משותפים ב-TS
│   ├── package.json                  # `npm run gen:api` מחדש את הטיפוסים מהשרת
│   ├── metro.config.js               # proxy ל-localhost:3000
│   └── app.json
│
├── mock-server/                      # Express + db.json mock — deprecated (offline-dev בלבד)
│   └── local-server/
│
├── scripts/
│   ├── dev.ps1                       # פקודה אחת ל-local dev (DB + server + Metro)
│   └── smoke.sh                      # smoke test end-to-end
│
├── CHANGELOG.md                      # שינויי contract לכל release
├── SYSTEM.md                         # English version
├── SYSTEM.he.md                      # ← אתה כאן
└── README.md                         # intro ברמת הריפו
```

---

## 5. מסד הנתונים — סכמה והסבר

### הישויות

| Entity | תפקיד | סעיף באפיון |
|---|---|---|
| `User` | משתמש קצה (driver/business/admin). מאחד את שני מסלולי האימות. | 5.3.1.1 |
| `OtpCode` | קודי OTP זמניים, hashed. ישנים נצרכים אוטומטית כשמנופק חדש. | 4.2.1 + 5.2.4-5.2.5 |
| `Level` | טבלת דרגות 1–10 עם ספי נקודות והנחות. | נספח ד׳ |
| `Trip` | נסיעה בודדת (התחלה, סיום, ציון, ספירות). | 5.3.1.2 |
| `Event` | אירוע חריג בנסיעה (בלימה, פנייה וכו') + JSONB sensor data. | 5.3.1.6 |
| `Business` | בית עסק (Marketplace) עם מיקום. | 5.3.1.4 |
| `Reward` | הטבה ספציפית בעסק. | 5.3.1.3 |
| `Redemption` | מימוש הטבה — QR + status + חלון תוקף (`VOUCHER_TTL_DAYS`). | 5.3.1.5 |

### שדות מרכזיים ב-`User`

```python
class User(Base, TimestampMixin):
    id, name, email?, password_hash?, phone?,        # אימות: email+password או phone+OTP
    role: UserRole,                                  # DRIVER | BUSINESS | ADMIN
    language: Language,                              # HE | EN
    age?, city?, license_year?, avatar_url?,

    points: int,                                     # יתרה נוכחית למימוש
    total_points: int,                               # צבירה היסטורית (קובעת דרגה)
    total_distance: float,                           # ק"מ מצטברים
    level: int,                                      # 1–10 (denormalized; מחושב מ-total_points)

    drive_mode_enabled, bluetooth_device_id, bluetooth_device_name,
    last_lat, last_lng, last_location_at,            # מיקום אחרון של הנהג
    last_cleared_history,                            # סינון היסטוריה ב-UI

    is_phone_verified, locked_until, lockout_reset_at,   # אכיפת spec 5.2.4
```

**למה גם `points` וגם `total_points`?** הפרונט משתמש בשניהם: `points` היא היתרה הנוכחית הניתנת למימוש (יורדת ברכישה ב-Marketplace), `total_points` היא הצבירה ההיסטורית שעליה נשענת הדרגה. בעת מימוש שובר מורידים רק מ-`points`.

### מיקומים ו-PostGIS

PostGIS מותקן ב-image של ה-DB (`postgis/postgis:16-3.4`) ומופעל לכל מסד נתונים. ל-MVP מאחסנים `location_lat`/`location_lng` כ-`Float` רגיל. בקנה מידה גבוה ניתן להוסיף עמודה generated מסוג `geography(Point, 4326)` עם GIST index (`geoalchemy2` כבר ב-requirements), ולעבור לחיפושי `ST_DWithin` למרחבית יעילים.

המיקום האחרון של הנהג (`User.last_lat`/`last_lng`) מתעדכן דרך `PUT /api/users/me/location`. באפליקציה הוא מוזן מ-`expo-location`.

### אינדקסים שכבר הוגדרו

- `users (phone)`, `users (email)`, `users (role)`
- `otp_codes (phone, purpose, consumed_at)` — חיפוש OTP פעיל
- `otp_codes (expires_at)` — לפינוי קודים שפג תוקפם
- `login_failures (user_id, caller_ip, created_at)` — השהיית כניסה לפי כתובת הפונה
- `login_failures (created_at)` — לפינוי שורות שפג תוקפן
- `trips (user_id, start_time)`, `trips (status)`
- `events (trip_id, timestamp)`, `events (type)`
- `businesses (category)`, `businesses (location_lat, location_lng)`
- `rewards (business_id, is_active)`, `rewards (category)`
- `redemptions (user_id, status)`, `redemptions (qr_code)`

---

## 6. מודולי השרת (Routers + Services)

| Router (HTTP) | Service (לוגיקה) | מה עושה |
|---|---|---|
| `routers/auth.py` | `services/auth.py` | Register, login, /me. שני מסלולים: email+password ו-phone+OTP. משהה פונה לפי (חשבון, כתובת) אחרי 5 כשלונות; נועל את החשבון עצמו רק ב-100. |
| `routers/users.py` | `services/users.py` | פרופיל `/users/me`, עדכון מיקום, GDPR delete, ו-`/user/stats`. |
| `routers/trips.py` | `services/trips.py` | רשימה, שמירה (מקבל snake_case וגם camelCase), שליפה לפי id. מעדכן אוטומטית `points`/`total_points`/`total_distance`. |
| `routers/rewards.py` | `services/rewards.py` | רשימת הטבות (פילטר קטגוריה), מימוש (QR base64 רנדומלי, תוקף לפי `VOUCHER_TTL_DAYS`), השוברים שלי. |
| `routers/leaderboard.py` | `services/leaderboard.py` | national/city/friends, ממוין לפי `total_points`. |
| `routers/notifications.py` | — | Stub. מחזיר רשימה ריקה עד שייווסף מודל. |
| `routers/health.py` | — | `/health` (DB ping), `/health/live` (uptime). |
| — | `services/sms.py` | אבסטרקציה לשליחת SMS — Twilio בפרודקשן, Console בפיתוח. |

### Middleware גלובלי (ב-`app/main.py`)

1. **CORS** — `CORSMiddleware`, origins מ-`CORS_ORIGINS` (ברירת מחדל `*`). הרשאות נשלחות רק כשהמקורות מפורטים במפורש — התקן אוסר על שילוב של כוכבית עם הרשאות, ולכן `settings.cors_allows_credentials` מכבה אותן יחד.
2. **SlowAPI** — rate limit לפי IP. ברירת מחדל: 30/דקה, 500/שעה; מסלולי האימות מוגבלים ל-5/דקה. ה-limiter יושב ב-`app/core/limiter.py` כדי שה-routers יוכלו לייבא אותו בלי מעגל. תקרה שנייה, לפי מספר טלפון (`OTP_MAX_PER_HOUR`), נמצאת ב-`services/auth.py` — היא שורדת החלפת כתובות, וזו זו שמגנה על חשבון ה-SMS.
3. **Unhandled-exception handler** — תופס כל מה שבורח מ-route ומחזיר 500 נקי עם הנתיב בלוג.

האימות הוא **לא** middleware — הוא ה-`CurrentUser` dependency שמוטמע בכל route מוגן.

---

## 7. זרימות אימות

### א. Email + Password (מה שהפרונט קורא)

```
Mobile App                                   Server
   │                                            │
   │  POST /api/auth/register                   │
   │  { name, email, password, phone?,          │
   │    city?, age?, licenseYear? }             │
   │ ─────────────────────────────────────────► │
   │                                            │ passlib bcrypt.hash(password)
   │                                            │ INSERT INTO users
   │                                            │ jose.jwt.encode({sub, email, role}, secret, HS256)
   │  201 { token, user }                       │
   │ ◄───────────────────────────────────────── │
   │                                            │
   │  AsyncStorage.setItem('carma_token', token)│
   │                                            │
   │  POST /api/auth/login                      │
   │  { email, password }                       │
   │ ─────────────────────────────────────────► │
   │                                            │ scalar(select(User).where(email=...))
   │                                            │ passlib bcrypt.verify()
   │                                            │ jose.jwt.encode(...)
   │  200 { token, user }                       │
   │ ◄───────────────────────────────────────── │
   │                                            │
   │  GET /api/auth/me                          │
   │  Authorization: Bearer <token>             │
   │ ─────────────────────────────────────────► │
   │  200 user                                  │
   │ ◄───────────────────────────────────────── │
```

### ב. Phone + OTP (לפי האפיון 4.2.1)

```
Mobile App                                   Server                 Twilio (prod)
   │                                            │                        │
   │  POST /api/auth/otp/register               │                        │
   │  { phone: +972501234567, name, ... }       │                        │
   │ ─────────────────────────────────────────► │                        │
   │                                            │ secrets.randbelow → 6 ספרות│
   │                                            │ passlib bcrypt.hash    │
   │                                            │ INSERT OtpCode         │
   │                                            │ ─── SMS body ────────► │
   │  200 { message, expiresInSeconds: 300 }    │                        │
   │ ◄───────────────────────────────────────── │                        │
   │                                            │                        │
   │  POST /api/auth/otp/verify                 │                        │
   │  { phone, code }                           │                        │
   │ ─────────────────────────────────────────► │                        │
   │                                            │ passlib bcrypt.verify  │
   │                                            │ on fail: INSERT LoginFailure│
   │                                            │   (user_id, caller_ip) │
   │                                            │ 5+ מהכתובת הזו: סירוב, │
   │                                            │   ההמתנה מוכפלת        │
   │                                            │ 100 ברמת החשבון:       │
   │                                            │   locked_until = now+15min │
   │                                            │ on success: צרוך,      │
   │                                            │    סמן is_phone_verified│
   │  200 { token, user }                       │                        │
   │ ◄───────────────────────────────────────── │                        │
```

### פרטי JWT

- **HMAC SHA256** עם `JWT_SECRET` (לפחות 16 תווים, נאכף ב-Pydantic Settings).
- ברירת מחדל: `JWT_EXPIRES_MINUTES=10080` (= 7 ימים).
- Payload: `{ sub, email, phone, role, iat, exp }`.
- אין refresh token כרגע — בפקיעת token המשתמש מתחבר מחדש.

### הגנות

| הגנה | היכן ממומשת |
|---|---|
| OTP מאוחסן כ-bcrypt hash (אף פעם לא בטקסט!) | `services/auth.py::_issue_otp` |
| OTP אחד פעיל בלבד (קודמים נצרכים אוטומטית) | טרנזקציית `UPDATE otp_codes SET consumed_at = now()` |
| 10 כשלונות → נעילה ל-15 דק' | `services/auth.py::_record_failure` (רצפת NIST; האפיון ב-5.2.4 דורש 5) |
| Rate-limit על register/login/verify | `slowapi` גלובלי (30/דקה) + 5/דקה על מסלולי האימות |
| מספר טלפון יכול להזמין 5 קודים בשעה | `services/auth.py::_assert_otp_quota` — נספר מ-`otp_codes`, ולכן מחזיק גם כשהפונה מחליף כתובות |
| ‏`otp/verify` לא מגלה אם מספר רשום | `services/auth.py::_rejected` — מספר לא מוכר, קוד שפג, קוד שגוי וחשבון נעול מחזירים את אותו 401. הסיבה האמיתית נשמרת בלוג הביקורת |
| סיסמאות עם bcrypt salt (passlib אוטומטי) | `core/security.py::hash_password` |
| TLS 1.3 | Termination ב-Azure Container Apps ingress |
| מחיקת חשבון מלאה (GDPR) | `DELETE /api/users/me` — cascade על trips/redemptions |

---

## 8. רפרנס API מלא

> כל ה-endpoints חוץ מ-`/health/*` ו-`/api/auth/{register,login,otp/*}` דורשים `Authorization: Bearer <token>`.

### Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password, phone?, city?, age?, licenseYear? }` | `201 { token, user }` |
| POST | `/api/auth/login` | `{ email, password }` | `200 { token, user }` |
| GET | `/api/auth/me` | — | `200 user` |
| POST | `/api/auth/otp/register` | `{ phone, name, language?, age?, city? }` | `200 { message, expiresInSeconds }` |
| POST | `/api/auth/otp/request` | `{ phone }` | `200 { message, expiresInSeconds }` |
| POST | `/api/auth/otp/verify` | `{ phone, code }` | `200 { token, user }` |

### Users

| Method | Path | תיאור |
|---|---|---|
| GET | `/api/users/me` | פרופיל המשתמש |
| PATCH | `/api/users/me` | עדכון name/language/age/city |
| PUT | `/api/users/me/location` | עדכון מיקום אחרון `{ lat, lng }` |
| DELETE | `/api/users/me` | מחיקת חשבון (GDPR) → 204 |
| GET | `/api/user/stats` | סטטיסטיקות מצטברות |

### Trips

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/trips` | — | `{ trips }` |
| POST | `/api/trips` | `{ start_time \| startTime, end_time \| endTime, distance \| distanceKm, avg_score \| avgScore \| score, events \| events_array, ... }` | trip |
| GET | `/api/trips/{id}` | — | `{ trip }` (כולל events) |

### Rewards & Vouchers

| Method | Path | תיאור |
|---|---|---|
| GET | `/api/rewards?category=fuel\|food\|eco\|entertainment\|shopping` | הטבות פעילות + השוברים של המשתמש |
| POST | `/api/rewards/{id}/redeem` | מימוש — מוריד נקודות, מנפק QR בתוקף `VOUCHER_TTL_DAYS` |
| GET | `/api/vouchers` | השוברים שלי |

### Leaderboard

| Method | Path | תיאור |
|---|---|---|
| GET | `/api/leaderboard?type=national\|city\|friends` | `friends` כרגע מחזיר רק את המשתמש עצמו (מודל חברים עוד לא הוסף). |

### Notifications

| Method | Path | תיאור |
|---|---|---|
| GET | `/api/notifications` | `[]` — stub עד שייווסף מודל |

### System

| Method | Path | תיאור |
|---|---|---|
| GET | `/health` | DB ping — readiness probe |
| GET | `/health/live` | uptime |
| GET | `/api/docs` | Swagger UI |
| GET | `/api/openapi.json` | OpenAPI schema |

---

## 9. אינטגרציה עם הפרונט

### מבנה הקוד של הפרונט (Expo / React Native)

```
mobile/src/
├── services/api/
│   ├── client.ts          # fetch wrapper + Bearer token + fallback ל-mocks
│   ├── auth.api.ts        # login/register/me
│   ├── trips.api.ts       # list/save/getById
│   ├── rewards.api.ts     # list/redeem/myVouchers
│   ├── leaderboard.api.ts # get
│   ├── notifications.api.ts
│   ├── user.api.ts        # stats
│   └── mocks/mockData.ts  # נתוני fallback כשהשרת לא נגיש
├── screens/auth/
│   ├── LoginScreen.tsx    # שולח { email, password }, שומר { token, user }
│   └── RegisterScreen.tsx # שולח { name, email, password, phone?, city?, age?, licenseYear? }
└── context/AppContext.tsx # state גלובלי, שולח טריפים דרך tripsApi.save
```

### איך לחבר את האפליקציה לשרת

כתובת השרת מוגדרת ב-`mobile/src/constants/serverConfig.ts`:
```ts
export const USE_REAL_SERVER = true;
export const STAGING_SERVER_URL = 'http://10.0.2.2:3000'; // alias של האמולטור למחשב המארח
```

- **אמולטור Android** (ברירת מחדל): `10.0.2.2` הוא alias מובנה של האמולטור למחשב המארח — כבר מוגדר.
- **מכשיר פיזי** באותו Wi-Fi: שנה את `STAGING_SERVER_URL` ל-IP של המחשב, למשל `http://192.168.1.42:3000`.
- **iOS Simulator**: שנה ל-`http://localhost:3000`.
- **Azure** (אחרי deploy): שנה ל-`https://carma-api.<region>.azurecontainerapps.io`.

### השוואת חוזה API (Frontend ↔ Backend)

| Endpoint שהפרונט קורא | מה הוא מצפה | מה השרת מחזיר | תאימות |
|---|---|---|---|
| `POST /api/auth/login` | `{ token, user }` | `{ token, user }` | ✅ |
| `POST /api/auth/register` | `{ token, user }` | `{ token, user }` | ✅ |
| `GET /api/auth/me` | user | user | ✅ |
| `GET /api/trips` | `{ trips }` | `{ trips }` | ✅ |
| `POST /api/trips` | trip | trip | ✅ |
| `GET /api/rewards` | `{ rewards, vouchers }` | `{ rewards, vouchers }` | ✅ |
| `POST /api/rewards/:id/redeem` | `{ voucher }` | `{ voucher }` | ✅ |
| `GET /api/vouchers` | `{ vouchers }` | `{ vouchers }` | ✅ |
| `GET /api/leaderboard?type=...` | `{ entries, currentUserId }` | `{ entries, currentUserId }` | ✅ |
| `GET /api/notifications` | array | `[]` (stub) | ✅ |
| `GET /api/user/stats` | `{ stats }` | `{ stats }` | ✅ |

### טיפול בערבוב snake_case ↔ camelCase

Pydantic schemas יורשים מ-`CamelModel` (`app/schemas/_base.py`):
```python
model_config = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,
    from_attributes=True,
)
```

זה גורם לפורמט camelCase על החוט (תכונות Python נשארות snake_case). Routes מגדירים `response_model_by_alias=True`, אז הפלט תמיד camelCase. ל-trip-save שמערבב סגנונות, ה-DTO מגדיר את שניהם דרך `AliasChoices`:

```python
distance_km: float | None = Field(
    default=None,
    validation_alias=AliasChoices("distanceKm", "distance"),
)
avg_score: float | None = Field(
    default=None,
    validation_alias=AliasChoices("avgScore", "avg_score", "score"),
)
```

שני הסגנונות מקובלים בקלט.

---

## 10. הרצה לוקאלית — צעד אחר צעד

### פעם ראשונה

```powershell
# מ-root של ה-repo — מתקין את כל הדרישות, יוצר venv,
# מריץ migrations, מזריע נתוני דמו, מוסיף חוק firewall.
.\scripts\setup.ps1   # דרוש: הרצת PowerShell כ-Administrator
```

### כל יום

```powershell
# מפעיל Docker, DB, שרת FastAPI ו-Expo Metro בפקודה אחת.
.\scripts\dev.ps1
```

לאחר מכן לחץ **`a`** בחלון Metro כדי לפתוח את האפליקציה באמולטור Android.

- API: `http://localhost:3000/api/...`
- Swagger: `http://localhost:3000/api/docs`
- Health: `http://localhost:3000/health`

### משתמש דמו

```
email:    daniel@carma.app
password: password123
```

### Smoke test מהיר (PowerShell)

```powershell
# Login
$body = '{"email":"daniel@carma.app","password":"password123"}'
$res = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login `
  -ContentType 'application/json' -Body $body
$token = $res.token
$res.user.name   # "דניאל כהן"

# GET /me
Invoke-RestMethod -Uri http://localhost:3000/api/auth/me `
  -Headers @{ Authorization = "Bearer $token" }
```

### פקודות שימושיות

```powershell
uvicorn app.main:app --reload          # dev server
ruff check . ; ruff format .           # lint + format
mypy app                               # typecheck
pytest                                 # tests
alembic revision --autogenerate -m "msg"   # migration חדש
alembic upgrade head                   # החלת migrations
alembic downgrade -1                   # rollback אחד
python -m app.seed                     # reseed
```

---

## 11. CI/CD ו-Deploy ל-Azure

### CI Workflow (`.github/workflows/ci-server.yml`)

רץ על כל PR ו-push ל-main. בנייה מדורגת:

1. **lint** — תמיד רץ (ruff). מהיר ובטוח.
2. **typecheck-test** — mypy + alembic + pytest. רץ ב-push ל-main, ב-workflow_dispatch ידני, או כשמוסיפים את ה-label `run-full-ci` ל-PR.
3. **smoke** — מרים שרת חי + מריץ `scripts/smoke.sh`. בגייט כמו typecheck-test.
4. **docker-build** — בונה את ה-image מבלי לדחוף.

מטרת השלביות: לקיים פייפליין שלא יחסום merges אם משהו שביר ביום הראשון, ולשדרג ל-required-status-check אחרי שבוע ירוק.

### Deploy Workflow (`.github/workflows/deploy.yml`)

רץ ב-push ל-main או ידני. **מותנה** בקיום ה-secret `AZURE_CREDENTIALS` — מדלג בשקט אחרת.

כשרץ:
1. `azure/login@v2` עם service principal.
2. `az acr login` ל-ACR.
3. `docker build` + `docker push` עם tag `:${{ github.sha }}`.
4. `az containerapp update --image` להחלפת ה-image, ומגדיר `TRUSTED_PROXY_COUNT=1`.

> **ה-workflow הזה לא רץ היום.** המנוי הוא חשבון Azure for Students, שלא יכול
> להחזיק את ה-service principal שה-workflow מתחבר איתו — ולכן `AZURE_CREDENTIALS`
> ריק וכל הרצה נגמרת ב-`deploy=skipped`. גרסאות עולות לאוויר ידנית, ראו
> [Deploy ידני](#deploy-ידני) למטה. כל מה שה-workflow היה עושה — מישהו צריך לעשות
> בעצמו.

### משתני סביבה ב-Container App

אלה מה שה**שרת** צריך כדי לעלות, וזו רשימה אחרת מה-GitHub Secrets שלמטה. כאשר
`ENV=production`, משתנה חסר גורם ל-`ValueError` בעלייה ולקריסה בלולאה — בכוונה,
כדי ששרת עם הגדרה שגויה לא יגיש תעבורה בזמן שהוא נראה תקין (`app/config.py`).

| משתנה | נדרש | למה הוא נופל ברעש |
|---|---|---|
| `ENV=production` | כן | מפעיל את שתי הבדיקות שלמטה. בלעדיו הן לא נדלקות. |
| `DATABASE_URL` | כן | Postgres, דרייבר `asyncpg`. דרך secret reference. |
| `JWT_SECRET` | כן | 16 תווים ומעלה. דרך secret reference. |
| `TRIP_SIGNING_SECRET` | כן בפרודקשן | 32 תווים ומעלה. ריק פירושו שהחתימה על נסיעות מקבלת כל דבר — ראו #24. |
| `TRUSTED_PROXY_COUNT=1` | כן בפרודקשן | 1 = ה-ingress של Container Apps. ב-0 כל בקשה נספרת על כתובת ה-ingress, כך שכל המשתמשים חולקים דלי אחד של מגבלת קצב — 30 בקשות בדקה לכולם יחד, ובלתי ניתן להבחנה מהשבתה. |
| `SMS_PROVIDER`, `TWILIO_*` | רק ל-SMS אמיתי | ברירת המחדל היא שליחה לקונסול. |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | אופציונלי | כשלא מוגדר זה no-op שקט. |

### Setup ב-Azure (חד-פעמי)

```bash
RG=carma-rg
LOC=westeurope
ACR=carmaregistry         # ייחודי גלובלית
APP=carma-api
DB=carma-pg

az group create -n $RG -l $LOC

az acr create -n $ACR -g $RG --sku Basic --admin-enabled true

az postgres flexible-server create -g $RG -n $DB -l $LOC \
  --tier Burstable --sku-name Standard_B1ms \
  --admin-user carma_admin --admin-password "ChangeMeStrong123!" \
  --version 16 --public-access 0.0.0.0
az postgres flexible-server parameter set -g $RG -s $DB \
  --name azure.extensions --value POSTGIS
az postgres flexible-server db create -g $RG -s $DB -d carma

az containerapp env create -n carma-env -g $RG -l $LOC
az containerapp create -n $APP -g $RG --environment carma-env \
  --image $ACR.azurecr.io/carma-server:bootstrap \
  --target-port 3000 --ingress external \
  --registry-server $ACR.azurecr.io \
  --secrets db-url="postgresql+asyncpg://..." jwt-secret="<random>" \
            trip-secret="<random, 32+ תווים>" \
  --env-vars ENV=production DATABASE_URL=secretref:db-url \
             JWT_SECRET=secretref:jwt-secret \
             TRIP_SIGNING_SECRET=secretref:trip-secret \
             TRUSTED_PROXY_COUNT=1 SMS_PROVIDER=twilio
```

### Deploy ידני

**באחריות נוה** — הוא מעלה את השרת וגם משחרר את גרסאות האפליקציה. עד שיהיה
service principal, כך גרסה באמת מגיעה לפרודקשן. מריצים ממכונה שמחוברת עם
`az login`.

> שווה עשר דקות לפני שמקבלים את זה כמצב קבוע: מנוי סטודנט משתמש באותו מנגנון
> הרשאות כמו מנוי בתשלום, ומגביל תקציב ואזורים — לא אוטומציה. מה שחוסם בדרך כלל
> הוא ארגון שמנוהל על ידי האוניברסיטה ולא מאפשר לסטודנטים לרשום אפליקציות.
> `az ad app create --display-name carma-ci` נותן את התשובה — אם היא מצליחה,
> אפשר להדליק את כל ה-workflow עם אימות מבוסס אמון ובלי סוד שמור.

```bash
RG=carma-rg
ACR=carmaregistry
APP=carma-api
TAG=$(git rev-parse --short HEAD)

az acr login -n $ACR
docker build -t $ACR.azurecr.io/carma-server:$TAG ./server
docker push $ACR.azurecr.io/carma-server:$TAG

az containerapp update -n $APP -g $RG \
  --image $ACR.azurecr.io/carma-server:$TAG
```

לפני ה-deploy הראשון שכולל את עבודת מגבלות הקצב, וכל פעם שה-app נוצר מחדש, יש
להגדיר את מה שה-workflow היה מגדיר:

```bash
az containerapp update -n $APP -g $RG \
  --set-env-vars TRUSTED_PROXY_COUNT=1
```

ואז לוודא שהשרת באמת עלה, במקום להניח שכן:

```bash
az containerapp revision list -n $APP -g $RG -o table   # הרוויזיה החדשה תקינה?
curl -fsS https://<app-fqdn>/health                      # השרת עונה?
az containerapp logs show -n $APP -g $RG --tail 50       # ValueError = משתנה חסר
```

קריסה בלולאה מיד אחרי deploy כמעט תמיד אומרת שאחד המשתנים בטבלה למעלה חסר. זו
הכשילה המכוונת — קוראים את הלוג, מגדירים את המשתנה, מעלים שוב.

### GitHub Secrets

| Secret | מה זה |
|---|---|
| `AZURE_CREDENTIALS` | פלט JSON של `az ad sp create-for-rbac --sdk-auth` |
| `AZURE_RESOURCE_GROUP` | למשל `carma-rg` |
| `AZURE_CONTAINER_APP` | למשל `carma-api` |
| `AZURE_CONTAINER_REGISTRY` | למשל `carmaregistry` (בלי `.azurecr.io`) |

כל עוד `AZURE_CREDENTIALS` לא מוגדר — Deploy workflow מדלג. **CI עדיין עובד.**

### Migrations בפרודקשן

ה-Dockerfile מסתיים ב:
```dockerfile
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
```
כל deploy מריץ migrations חדשים לפני שהשרת עולה. Alembic migrations הם idempotent.

---

## 12. Monitoring ו-Observability

### Application Insights

`app/monitoring.py::configure_monitoring` מחבר `azure-monitor-opentelemetry` יחד עם ה-OpenTelemetry instrumentations של FastAPI ו-SQLAlchemy. אם `APPLICATIONINSIGHTS_CONNECTION_STRING` לא מוגדר — no-op שקט.

נאסף אוטומטית:
- **Requests** — כל בקשת HTTP: משך, status, route.
- **Dependencies** — כל query ל-Postgres, כל קריאה ל-Twilio.
- **Exceptions** — exceptions שלא נתפסו (גם נתפס בהנדלר הגלובלי).
- **Live Metrics** — CPU/RPS/latency בזמן אמת בפורטל Azure.

### Health Endpoints

| Endpoint | מטרה |
|---|---|
| `GET /health` | בדיקת DB — readiness probe ב-Container Apps. |
| `GET /health/live` | uptime — liveness probe. |

### Logs

`uvicorn` ו-`logging` מדפיסים ל-stdout/stderr. Azure Container Apps שולח ל-Log Analytics. KQL שימושי:
```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "carma-api"
| where TimeGenerated > ago(1h)
| order by TimeGenerated desc
```

---

## 13. מפת תאימות לאפיון

| סעיף באפיון | מה נדרש | היכן ממומש |
|---|---|---|
| 4.1.1 תמיכת פלטפורמה | iOS 14+ / Android 11+ | בפרונט (Expo) |
| 4.1.2 BT pairing | עד 2 רכבים | `User.bluetooth_device_id` (ניתן להרחיב) |
| **4.2.1 אימות בטלפון + OTP** | SMS עם קוד | `services/auth.py::register_with_otp / verify_otp` |
| 4.2.2 פרטי הרשמה | שם, גיל, רישיון | `schemas/auth.py::RegisterIn / OtpRegisterIn` |
| 4.3.5 ניקוד וגיימיפיקציה | Score + נקודות | `Trip.avg_score`, `Trip.points`, `User.points` / `total_points` |
| 4.3.5.3 Roadmap 10 levels | טבלת דרגות | `Level` model + `app/seed.py` |
| 4.3.6 Marketplace | קטלוג + QR | `services/rewards.py` |
| 4.3.6.2 QR חד-פעמי | חד-פעמי; פג בתום `VOUCHER_TTL_DAYS` | `consume_voucher` + `VOUCHER_TTL_DAYS` |
| 4.4.4 צבירת נקודות | מתעדכנת ב-sync | `services/trips.py::save` |
| 4.5 / 5.2.3 GDPR | מחיקה עצמית | `DELETE /api/users/me` |
| **5.2.1 TLS 1.3** | כל התעבורה | Azure Container Apps ingress |
| **5.2.4 הגבלת ניסיונות** | 5 כשלונות → 15 דק' | `services/auth.py::_record_failure` — נועל ב-10, ר' להלן |
| **5.2.5 תוקף QR** | `VOUCHER_TTL_DAYS`, לא 5 דק' (ר' להלן) | `Redemption.expires_at` + `VOUCHER_TTL_DAYS` |
| **5.3 ישויות נתונים** | כל הטבלאות באפיון | `app/models/` |

### לא תואם 1:1 לאפיון — בכוונה

- **שמות שדות:** האפיון משתמש למשל ב-`cost_points`, המודלים ב-Python באותו `cost_points`, פורמט החוט הוא `costPoints` (camelCase).
- **אימות מבוסס email:** האפיון מכסה רק טלפון. הוספנו email+password כי הפרונט כבר מחווט לזה. שני המסלולים פעילים.
- **Friendships:** האפיון לא מגדיר טבלת חברים, אבל הפרונט קורא ל-`leaderboard?type=friends`. כרגע מחזיר רק את המשתמש עצמו עד שייווסף מודל.
- **תוקף שובר — ימים, ולא 5 הדקות שבאפיון 4.3.6.2 / 5.2.5.** החלון עצמו הוא `VOUCHER_TTL_DAYS` ב-`services/rewards.py`, ומכוונים אותו שם בלבד. האפיון מאחד שני שעונים שהתעשייה מפרידה ביניהם: כמה זמן הזכאות של הנהג להטבה קיימת, וכמה זמן קוד מוצג מתקבל בסורק. מטרת האבטחה שלו מושגת על ידי `consume_voucher`, שמוציא שובר מ-`PENDING` פעם אחת בלבד — קוד ששותף או צולם חסר ערך אחרי שמומש, ולא משנה מה כתוב בתוקף. הצמדת השעון הקצר לזכאות עלתה לנהגים בנקודות ששילמו: אין החזר על שובר שפג (CAR-24). חסום ולא פתוח לגמרי, כי שובר שלא מומש תופס יחידה מהמלאי של העסק לכל אורך חייו.
- **נעילה אחרי 10 ניסיונות כושלים, ולא 5 כמו באפיון 5.2.4.** תקן NIST SP 800-63B §5.2.2 קובע 10 כרצפה, ונעילה ב-5 הכניסה משתמש שהקליד שגוי לנעילה בערך פי שניים יותר ממה שהתקן מתכוון אליו. הנעילה עצמה נשארה 15 דקות. הפער שנותר מול NIST הוא שספירת הכשלונות היא לפי חשבון בלבד ולא גם לפי מקור — CAR-51.

---

## 14. Out of Scope

תואם לסעיף 8 באפיון:

- **OBD-II integration**
- **Offline redemption**
- **צ'אט בין נהגים**
- **שיתוף ברשתות חברתיות**
- **Web admin panel** — אדמינים משתמשים באותה אפליקציית מובייל.

בכוונה נדחה:

- **חישוב Score CARMA המלא** (נספח ג') — ✅ ממומש בצד השרת ב-`app/services/scoring.py` (v2.1). השרת הוא oracle הניקוד היחיד; הלקוח שולח טלמטריה גולמית בלבד. מנוע v1 שהוחלף נמחק ב-#53; שרד ממנו רק מכפיל סיכון הלילה, ב-`app/services/risk.py`.
- **מודלי Notification + Achievement + Friendship**.
- **העלאת תמונת רישיון** (דורש Azure Blob Storage). השדה `license_img_url` קיים בסכמה.
- **Refresh tokens** — כרגע JWT יחיד ל-7 ימים.

---

## 15. הצעדים הבאים

### עכשיו (אינטגרציה עם הפרונט)

1. הרצת `.\scripts\dev.ps1` מ-root של ה-repo — מפעיל הכל. דפדפן ל-`http://localhost:3000/api/docs`.
2. האמולטור כבר מוגדר מראש להגיע לשרת ב-`http://10.0.2.2:3000` דרך `serverConfig.ts` — אין צורך לשנות כלום.
3. התחברות באפליקציה עם `daniel@carma.app` / `password123` — אמור להגיע לשרת אמיתי.
4. הרצת נסיעה באפליקציה ואימות שהיא נשמרה ב-DB (`docker exec -it carma_db psql -U carma -d carma -c "SELECT id, user_id, distance_km, avg_score FROM trips ORDER BY created_at DESC LIMIT 5;"`).

### בקרוב

5. ~~מימוש אלגוריתם ה-Score המלא~~ ✅ בוצע — scoring oracle בצד השרת פעיל מאז v1.5.
6. הוספת מודלי `Notification`, `Achievement`, `Friendship` + migrations.
7. החלפת stub ה-notifications במשהו אמיתי + push notifications (Expo Push).
8. הוספת e2e tests ל-auth + trips + rewards.
9. הקמת Azure בפקודות לעיל וריצת ה-deploy הראשון.
10. הגדרת `APPLICATIONINSIGHTS_CONNECTION_STRING` ואימות שזרימת telemetry עובדת.

### בעתיד

11. **PostGIS GEOGRAPHY** על `businesses` + GIST index לחיפושי Marketplace ברדיוס.
12. **Refresh tokens** עם rotation.
13. **Rate limiting per-user** (slowapi עם Redis storage).
14. **תבניות SMS רב-לשוניות**.
15. **Admin endpoints** לכוונון פרמטרי scoring (נספח ג'-ו').

---

> **שאלות / משוב:** המסמך הזה הוא single source of truth של איך השרת בנוי ומתחבר לפרונט. אם משהו משתנה בקוד אבל לא כאן — לעדכן.
