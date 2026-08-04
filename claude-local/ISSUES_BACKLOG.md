# ISSUES ממתינים לטיפול — May (אישי, לא מסונכרן ל-git)

תמונת מצב (snapshot) של ISSUES שמוקצים לי ב-Linear ועדיין **לא** התחלתי לעבוד עליהם — סטטוס "ממתין" בלבד. קפואה עד סריקה מפורשת חדשה, לא מתעדכנת אוטומטית. ISSUES פעילים (בתהליך/דרוש שינוי) נמצאים ב-`ISSUES.local.md`.

**לא כלולים כאן:** CAR-96, CAR-88, CAR-31, CAR-89, CAR-103 — כולם דורשים תיאום/הכרעה לפני שאפשר בכלל להתחיל, מתועדים במלואם בסעיף "בדיקת שיוך" ב-`ISSUES.local.md`.

**סריקה אחרונה:** 2026-08-01.

## איך להשתמש בקובץ הזה

כשמתחילים לעבוד על ISSUE מכאן: **מעבירים** את השורה שלו (לא מעתיקים) לטבלה "פעיל" ב-`ISSUES.local.md` עם סטטוס "בתהליך", ומוחקים אותה מכאן. הקובץ הזה אמור להתקצר עם הזמן ככל שמתקדמים, עד שמבקשים סריקה חדשה שממלאת אותו מחדש.

## Urgent

| Linear | נושא | הערות |
|---|---|---|
| CAR-50 | UI | role checks מתים — server שולח UPPERCASE, client משווה lowercase |
| CAR-66 | UI/Infra | expo-camera + dev build כדי שה-scanner ירוץ בכלל |
| CAR-68 | UI | מסך redemption של שובר: scan/review/confirm/redeem |

## High

כל הקבוצה הבאה (כולל CAR-6/CAR-7 הפעילים ו-CAR-31/CAR-103 שבסעיף "בדיקת שיוך" ב-`ISSUES.local.md`) שייכת רשמית לפרויקט Linear **"Distraction scoring we can defend"** (הובלת דן) — קיבוץ רשמי של הצוות, לא ניחוש. שרשרת תלויות אמיתית: CAR-52 (מה בכלל ניתן למדוד) → CAR-31 (איסוף נתונים מתויגים, ר' ISSUES.local.md) → CAR-46 (החלטת שיטת זיהוי handheld) ← תשתית: CAR-82 (gyroscope plumbing, מוכן במפורש כתשתית ל-CAR-46). **CAR-45 + CAR-46 + CAR-62 + CAR-82 נוגעים כולם ב-`PhoneUsageManager.ts` — מועמדים טובים לאיחוד ל-PR אחד או רצף PRs קטן.**

| Linear | נושא | ISSUE קשור | הערות |
|---|---|---|---|
| CAR-134 | Driving-SDK | — | SDK boundary דולף fraud signals ומשנה שם לציון. יש שורה מאושרת מראש מחוץ ל-driving-sdk/ (AppContext.tsx:515) |
| CAR-45 | Driving-SDK | CAR-46, CAR-62, CAR-82 — מועמד לאיחוד PR | handheld seconds נספרים רק כש-CARMA ברקע |
| CAR-46 | Driving-SDK | CAR-45, CAR-62, CAR-82 — מועמד לאיחוד PR; תלוי ב-CAR-31 (נתונים) ו-CAR-82 (gyroscope plumbing) | טלפון רופף על המושב נקרא כ-handheld — variance לבד לא מספיק. **תלוי ב-CAR-82 ו-CAR-31 לפני שאפשר להחליט שיטה** |
| CAR-52 | Driving-SDK/UX | CAR-45, CAR-46, CAR-82, CAR-62 | לא ניתן למדוד phone touches כמו שצריך — להגדיר מה כן ניתן למדוד, per platform. השקעה בזה קודם עשויה לחסוך עבודה כפולה |
| CAR-62 | Driving-SDK | CAR-45, CAR-46, CAR-82 — מועמד לאיחוד PR | PhoneUsageManager אין לו גישה למהירות הרכב. Plumbing בלבד — פירוש הנתון הוא CAR-54 של דן, לא כאן |
| CAR-82 | Driving-SDK | CAR-45, CAR-46, CAR-62 — מועמד לאיחוד PR | להזין את הגירוסקופ ל-PhoneUsageManager — כבר רץ ולא בשימוש. **תשתית מפורשת ל-CAR-46**, plumbing בלבד |
| CAR-86 | Driving-SDK | — | לוודא ש-Bluetooth עדיין autolink על device build — Expo SDK 54 שינה כללים |
| CAR-16 | Driving-SDK/UX | — | טיפול בסירוב הרשאת מיקום Always (רקע) |
| CAR-67 | UI | — | להוסיף peek/consume voucher ל-business API client |
| CAR-69 | UI | — | לטפל בכל מצב כשל של redemption שובר בכנות |
| CAR-59 | UI | — | משתמשי עברית רואים טקסט שגיאה באנגלית — התרגומים שכתבנו לא מוצגים |
| CAR-112 | UI | — | מחזור חיים של שובר driver מכרטיס התגמול |
| CAR-113 | UI | — | הצגת יתרה זמינה + נקודות שמורות בשוברים חיים |
| CAR-116 | UI | — | ניווט ופעולות מבוססי-role עבור OWNER/MANAGER/CASHIER |

## Medium

| Linear | נושא | ISSUE קשור | הערות |
|---|---|---|---|
| CAR-100 | Driving-SDK/Docs | — | README של driving-sdk מתאר חיישנים שונים ממה ש-SensorManager.ts בפועל משתמש |
| CAR-14 | UI | — | אירועי נסיעה חסרים מהמפה בהיסטוריית נסיעות (פונקציונלי) |
| CAR-18 | UI | — | אייקוני level tier מוצגים כ-? ב-iOS (קוסמטי) |
| CAR-22 | UI | — | בורר סינון עיר קטן מדי (קוסמטי) |
| CAR-26 | UI | — | בחירת עיר מרשימה בהרשמה — backend כנראה כבר קיים (`/api/leaderboard/locations`, ר' "בדיקת שיוך" ב-ISSUES.local.md) |
| CAR-29 | UI | — | קומפוננטת trip stat גולשת מעל 100 ק"מ (קוסמטי) |
| CAR-30 | UI | — | משך מעל שעה מציג רק דקות (קוסמטי) |
| CAR-44 | UI | — | להסיר בורר מדינה מיותר מטבלת המובילים |
| CAR-80 | UI | — | מסך היסטוריית redemption לאפליקציית העסק |
| CAR-114 | UI | — | הצגת תגמולים שאזלו כלא-זמינים, להזיז לסוף הרשימה |
| CAR-115 | UI | — | הסרת תגמול: אזהרת אישור לגבי שוברים חיים |
| CAR-117 | UI | — | מסך ניהול הרשאות redemption שובר |
| CAR-118 | UI | — | יצירה/קבלה של הזמנת הרשאה עסקית |

## Low

| Linear | נושא | הערות |
|---|---|---|
| CAR-41 | UI | טופס בקשת הצטרפות עסק במובייל — לא לחבר submit אמיתי עד שחוזה ה-backend (CAR-42) יוחלט |
| CAR-9  | UI | ליטוש UI: עקביות אייקונים, תוויות level-progress, קיפול רשימת אירועים |
| CAR-15 | UI | מחוון טעינה בזמן חישוב ציון נסיעה |
| CAR-19 | UI | מדד נקודות-לק"מ בטבלת המובילים — backend כנראה לא נדרש, לבדוק payload קיים לפני פנייה לשון (ר' "בדיקת שיוך" ב-ISSUES.local.md) |
| CAR-20 | UI | הסרת פילטר מיותר מטבלת המובילים הארצית |
| CAR-21 | UI | מפת נסיעה: זום + פתיחה באפליקציית מפות |
| CAR-23 | UI | הגבלת מכשירים לא נתמכים (אזור וגרסת OS) |
| CAR-119 | UI | סטטיסטיקות redemption בדשבורד העסק |
| CAR-125 | UI | "+0 points" בלי הסבר כשמגיעים לתקרה |
