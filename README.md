# CARMA

CARMA היא אפליקציית מובייל שעוקבת אחר התנהגות נהיגה דרך חיישני GPS ו-IMU, מחשבת ציון CARMA, ומאפשרת לנהגים בטוחים לצבור נקודות להנחות בזמן אמת.

---

## תוכן הריפו

| תיקייה | מה זה | טכנולוגיה |
|---|---|---|
| `server/` | Backend — API, DB, לוגיקה עסקית | Python / FastAPI / PostgreSQL |
| `mobile/` | אפליקציית מובייל | React Native / Expo |
| `mock-server/` | שרת mock לפיתוח offline | Express / json-server |
| `scripts/` | סקריפטי עזר | PowerShell |

---

## דרישות מוקדמות — התקנה חד-פעמית

לפני הכל, וודא שהכלים הבאים מותקנים:

| כלי | לאיזה חלק | הורדה |
|---|---|---|
| **Docker Desktop** | Backend + DB | docker.com |
| **Python 3.12** | Backend | python.org |
| **Node.js 20+** | Mobile | nodejs.org |
| **Android Studio** | Mobile (כולל Android SDK + AVD) | developer.android.com/studio |

> **Backend בלבד?** צריך רק Docker + Python.

---

## Setup פעם ראשונה

**חד פעמי על כל מחשב — הרץ כ-Administrator:**

```powershell
.\scripts\setup.ps1
```

הסקריפט מתקין ומגדיר אוטומטית:
- Docker Desktop, Python 3.12, Node.js (דרך winget אם חסרים)
- ANDROID_HOME, JAVA_HOME, PATH — env vars קבועות
- Python venv + כל התלויות
- יצירת `.env` מ-`.env.example`
- migrations + seed של נתוני demo

> **בטוח להריץ שוב.** אם הכל כבר מותקן, הסקריפט מדלג על כל שלב ומדפיס בסוף:
> `Everything already set up — run .\scripts\dev.ps1`
>
> רק כשיש migration חדש יש להריץ ידנית: `alembic upgrade head`

---

## הפעלה יומיומית

### Full Stack — Backend + Mobile + אמולטור

```powershell
.\scripts\dev.ps1
```

הסקריפט עושה הכל אוטומטית:
1. מפעיל Docker Desktop (אם לא רץ)
2. מפעיל את אמולטור Android
3. מעלה PostgreSQL
4. מעלה FastAPI server על פורט 3000
5. מעלה Expo Metro על פורט 8081

לאחר שהכל עלה — לחץ **`a`** בחלון Metro לפתיחת האפליקציה באמולטור.

---

### Backend בלבד — בלי mobile

```powershell
cd server
docker compose up db          # חלון 1 — PostgreSQL
.venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 3000   # חלון 2 — API
```

API docs: http://localhost:3000/api/docs

---

## נקודות חשובות

| נושא | פרט |
|---|---|
| **Android אמולטור** | נפתח תמיד עם `-no-snapshot-load` (הסקריפט מטפל בזה) |
| **חיבור אמולטור לשרת** | ה-app מתחבר ל-`http://10.0.2.2:3000` (alias ל-localhost מתוך אמולטור) |
| **Docker חייב לרוץ** | ה-DB עולה דרך Docker — בלי Docker אין DB |
| **Migration חדש** | `cd server && alembic upgrade head` |

---

## פקודות שימושיות

```powershell
# בדיקות mobile
cd mobile && npm test -- --no-coverage

# TypeScript check
cd mobile && npx tsc --noEmit

# Lint mobile
cd mobile && npm run lint

# Lint server
cd server && ruff check . && ruff format --check .

# בדיקות server
cd server && pytest
```

---

## תרשים ארכיטקטורה

```
mobile (Expo) ──→ FastAPI :3000 ──→ PostgreSQL :5432
                      ↑
              (10.0.2.2 מהאמולטור)
```