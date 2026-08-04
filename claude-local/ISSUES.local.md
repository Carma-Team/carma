# מעקב ISSUES פעילים — May (אישי, לא מסונכרן ל-git)

קובץ עבודה אישי למעקב אחר ISSUES **פעילים בלבד**: כאלה שכבר התחלתי לעבוד עליהם (בתהליך / דרוש שינוי / הסתיים), או שדורשים החלטה/תיאום לפני שאפשר להתחיל. ISSUES שעוד לא ניגשתי אליהם בכלל נמצאים ב-`ISSUES_BACKLOG.md` — לא כאן, כדי שהקובץ הזה יישאר קצר ומרוכז בזמן פיתוח שוטף.

**מקור:** Linear. מזהה ראשי = Linear ID (`CAR-XX`). מספרי GitHub הישנים מצוינים בסוגריים היכן שיש התאמה ודאית (label `Migrated` + כותרת/תאריך תואמים).

## כללי עבודה

1. **סריקה** — רק כשאני מבקשת במפורש נבצע סריקה מחדש (Linear כרגע, `assignee: me`). אין לסרוק מיוזמתך בתחילת שיחה. סריקה אחרונה: 2026-08-01.
2. **התחלת עבודה על ISSUE חדש** — לוקחים את הבא בתור לפי סדר עדיפות מ-`ISSUES_BACKLOG.md`, **מעבירים** (לא מעתיקים) את השורה שלו לטבלה כאן עם סטטוס "בתהליך", ומוחקים אותה מה-backlog.
3. **PR לכל ISSUE** — כשמטפלים ב-ISSUE, פותחים PR מתאים ומעדכנים כאן את מספרו. ISSUES קשורים (קבצים דומים / מנגנון זהה / מאפיין משותף אחד) מצוינים בעמודת "ISSUE קשור" בטבלה, ומאוחדים לאותו PR כשזה הגיוני.
4. **סדר טיפול** — לפי סדר העדיפות/דחיפות שנקבע ב-`CLAUDE.local.md` (urgent-labeled → P0 → P1, SDK לפני UI, functionality לפני cosmetic), בעזרת שדה ה-priority של Linear (Urgent/High/Medium/Low) ככלי מיון. כשה-backlog מתרוקן — להודיע לי, ואשקול סריקה חדשה.
5. **שאר ההנחיות** — כפי שמפורטות ב-`CLAUDE.local.md` (git/gh ידני בלבד, לא להריץ טסטים בלי לשאול, tsc מותר בלי לשאול, וכו').
6. **עדכונים ושינויים נדרשים** — כל דבר שמזוהה תוך כדי עבודה שדורש שינוי קוד אך לא מטופל מיד, נכנס לטבלת "עדכונים ושינויים נדרשים" למטה. עדכונים שצריכים להפוך ל-ISSUE חדש → `ISSUES_TO_OPEN.md`. שאלות שדורשות החלטה משותפת → `QUESTIONS_TO_RAISE.md`.
7. **ISSUES מסומנים ⚠️ בסעיף "בדיקת שיוך"** — לא לעבוד עליהם עד שאני מעדכנת שהשיוך ב-Linear טופל. כרגע: CAR-96, CAR-88, CAR-31 (ממתינות להעברה), CAR-89 (ממתין להחלטת צוות). הם **לא** מופיעים ב-`ISSUES_BACKLOG.md` — נשארים כאן בלבד עד שנפתרים.

## הערות על המעבר ל-Linear

- `CAR-6` = GitHub #13, `CAR-7` = GitHub #17, `CAR-5` = GitHub #7, `CAR-41` = GitHub #72 (שונה שם ל-"Business join request form in the mobile app").
- GitHub #12 ו-#14 — לא נמצא עבורם ticket נפרד ב-Linear. כנראה נסגרו/לא הוגרו כי PR #48 כבר פותר אותם.
- GitHub #47 — לא הוגר כ-ticket אחד; במקומו כמה tickets ממוקדים יותר (CAR-103, CAR-46, CAR-82, CAR-62, CAR-100).
- GitHub #43 (phone-touch counting) → `CAR-28`, כבר **Done**.

## בדיקת שיוך — סריקה מלאה + אימות שני-שלבי הושלמה (2026-08-01)

עברתי על **כל 45 ה-issues** בתוכן מלא (לא רק תוויות), ואז ביצעתי סבב אימות שני: השוואה מול כל ה-issues בעלי תווית `security` בכל הארגון, בדיקת companion tickets קיימים ל-CAR-103/19/26, וקריאה מלאה של CAR-19/CAR-26 שבסבב הראשון נבדקו רק לפי תווית.

### שיוך מוטעה לגמרי — להסיר הקצאה, לפרט לצוות

| Linear | למה זה לא בתחום | תחום נכון | COMMENT מוכן לפרסום |
|---|---|---|---|
| **CAR-96** | תווית security — חתימת HMAC. **אומת:** מתוך 21 issues עם תווית security בכל הארגון, **כולם** מוקצים ל-Dan/Shaun/Naveh חוץ מזה. חריגה יחידה | Security / Dan או Naveh | "This is a security mechanism (HMAC trip-signature verification), not UI or driving-sdk sensor integration — outside my role (Mobile \& Frontend UI Lead: UI + device-sensor integration). It happens to live in `mobile/src/context/AppContext.tsx`, but the domain is security/trust infrastructure, sequenced with CAR-13/CAR-95 — every other security-labelled issue in the workspace sits with Dan, Shaun or Naveh. Reassigning; whoever picks it up will need someone with mobile access for the file itself." |
| **CAR-88** | תשתית בדיקות/CI — Jest לא מריץ `.test.tsx` בכלל | Infra / Naveh | "This is Jest/CI test-runner infrastructure, not UI or driving-sdk work — matches the cluster Naveh already owns (CAR-91, CAR-92, CAR-121, CAR-122, CAR-123, CAR-90). Suggest this joins them." |
| **CAR-31** | איסוף/תיוג נתוני נהיגה לכיול אלגוריתם הציון — לא UI, לא driving-sdk קוד. נוצר ע"י נווה | Data/Scoring / Naveh או Dan | "This is a data-collection/labelling exercise to calibrate the scoring algorithm, not UI or driving-sdk library work. Created by Naveh — suggest confirming with him or Dan (scoring) whether it should move." |

### לא reassign — שאלת חלוקת עבודה, לא שיוך שגוי

| Linear | למה זה שונה מהשלושה למעלה | COMMENT מוכן (לניסוח בלבד, לא reassign) |
|---|---|---|
| **CAR-89** | component tests למסכי UI **שאני הבעלים שלהם** — זה לא "לא בתחום שלי" באמת, זו רק הגבלה שהצבתי לעצמי (בדיקות רק בגבולות driving-sdk). לא ברור מי אמור לקחת את זה אם לא אני | "I'm scoping my own test-writing to driving-sdk internals only — these are component tests for screens I own, not a different domain, so this isn't a clean reassignment. Raising it so the team can decide who covers UI component-test coverage; happy to keep it if no one else picks it up." |

### שיוך חלקי — נשאר אצלי, רק צריך ticket/תיאום לחלק החסר

| Linear | **החלק שלי (לבצע)** | מה לא שלי | COMMENT מוכן (לתיאום, לא reassign) |
|---|---|---|---|
| **CAR-103** | ב-`SensorManager.ts`: לשנות שלושת ה-thresholds ב-`DEFAULT_MOTION_THRESHOLDS` ל-⅓g (0.333) בשלושתם. ב-`AppContext.tsx`: לעדכן שלושת רישומי ה-`minSpeedKmh` (hard-brake→10, accel→10, turn→25). ב-`index.ts:293`: ליישר את ה-cooldown (500ms→2-3s לפי הערת ה-SDK עצמה) | `server/app/services/telemetry.py` (thresholds, floors, merge window) — **בדקתי: אין ticket קיים לזה בכלל**, לא רק "לא שלי" | ר' `ISSUES_TO_OPEN.md` שורה 1 — פותחים issue חדש (מוקצה לדן), לא רק מבקשים ממנו בקומנט |
| **CAR-19** | הכל — תצוגת UI בלבד | **תוקן באימות:** ⚠️ לא בהכרח נדרש backend. נקודות ומרחק כנראה כבר קיימים ב-payload; תווית ה-backend כנראה ישנה. **לבדוק בעצמי את מבנה ה-leaderboard API לפני שפונים לשון** | (לא צריך COMMENT ל-Shaun עדיין — קודם לבדוק את ה-payload) |
| **CAR-26** | הכל — תצוגת UI בלבד | **תוקן באימות:** ⚠️ כנראה כבר לא נדרש. Ties ל-CAR-22/CAR-44, ו-CAR-44 מאשר ש-`GET /api/leaderboard/locations` **כבר קיים** ומחזיר רשימת ערים. סביר שהתווית backend נשארה מלפני שה-endpoint הזה עלה | (לא צריך COMMENT ל-Shaun — סביר שאפשר להתחיל ישר עם ה-endpoint הקיים) |

**סיכום פעולה:** 3 הראשונות (CAR-96/88/31) — COMMENT + הסרת הקצאה. CAR-89 — COMMENT לדיון, לא reassign. CAR-103 — COMMENT לתיאום + תיעוד חלק שלך. CAR-19/CAR-26 — **לא לפנות לשון עדיין**, קודם לבדוק אם ה-backend כבר קיים. שים לב: CAR-19/CAR-26 עצמם **כן** מופיעים ב-`ISSUES_BACKLOG.md` (Low/Medium) — רק ה"בדיקה לפני" מתועדת כאן.

## טבלת מעקב — פעיל בלבד

| Linear | GitHub # | נושא | סטטוס עבודה | PR # | ISSUE קשור | הערות |
|---|---|---|---|---|---|---|
| CAR-5  | #7 | UX | בתהליך | #71 | — | ממתין לסקירה — admin-gated kill switch ל-BT drive-mode. ראו גם "הרחבה מתוכננת" למטה — עוד לא התחיל מימוש |
| CAR-6  | #13 | Driving-SDK | בתהליך | #48 | CAR-7, CAR-103 | orientation-invariant detection — תוקן, ממתין לסקירה חוזרת של דן |
| CAR-7  | #17 | Driving-SDK | ממתין לתשובת דן | #77 | CAR-6, CAR-103 | שני התיקונים שדן ביקש בוצעו ונדחפו (timing של ה-Alert → trip-summary flow; סדר כתיבת דגל AsyncStorage). הצעתו השלישית (מיזוג `PowerManagement.ts` ל-`BatteryOptimizationPrompt.ts`) — נדחתה, קובץ נפרד נשאר; זו החלטתי כבעלת driving-sdk, לא פתוחה יותר לדיון ב-PR. **⚠️ ממתין להחלטת דן:** העלתי בקומנט נוסף (2026-08-02) סוגיה שהטיימינג החדש (trip-summary) לא מגן על הנסיעה שרק הסתיימה — כולל הנסיעה הראשונה של משתמש חדש — ומשליכה גם על scoring (טלמטריה פגומה אפשרית). הצעה: קריאה נוספת ל-prompt גם מ-`loginUser`. אם דן מאשר — יש להוסיף שורת קוד + לבדוק התנגשות אפשרית עם ה-toast/ניווט שאחרי login/register לפני שדוחפים. ר' `QUESTIONS_TO_RAISE.md` שורה 1. מיטיגציה בלבד, נשאר פתוח גם אחרי מיזוג |

## הרחבה מתוכננת ל-CAR-5/#7 (PR #71) — טרם התחיל מימוש

גובש בשיחה על PR #77 (2026-08-02), שייך לענף `fix/bt-manual-end-trip` (PR #71, טרם ממוזג ל-develop). לא קשור ל-driving-sdk — שינויים ב-UI/AppContext בלבד.

1. **כפתור כפול במסך הבית:** לשכפל את כפתור ה-drive-mode toggle הקיים ב-`SettingsScreen.tsx` (`handleDriveModeToggle`) — להציג אותו גם ב-`DashboardScreen.tsx`, מעל כפתור "התחל נסיעה". חייב להפעיל בדיוק את אותו handler (אותו admin-gate + apology alert) — לא implementation כפול/נפרד.

2. **תנאים חדשים לספירת PHONE_TOUCH לפי מצב הכפתור/הנסיעה:**
   - כיבוי המנגנון (מ"פעיל" ל"כבוי") — לעולם לא נספר כאירוע PHONE_TOUCH חריג.
   - הפעלת המנגנון (מ"כבוי" ל"פעיל") **לפני** לחיצה על "התחל נסיעה" (`tripState.isActive === false`) — לא נספר כאירוע חריג.
   - הפעלת המנגנון **אחרי** לחיצה על "התחל נסיעה" (`tripState.isActive === true`) — **כן** נספר כאירוע PHONE_TOUCH חריג.

3. **לא ליישם בקוד — רק להעלות כ-COMMENT/דיון עם דן כשמגיעים לזה:** הרציונל לכלל #2 השלישי — לפי אלגוריתם הציון של דן (הפחתה פרופורציונלית למהירות), הפעלת המנגנון מיד עם "התחל נסיעה" ב-0 קמ"ש לא תפגע משמעותית בציון. אבל אחרי שהנסיעה כבר בעיצומה זה כן צריך להיספר — אחרת פרצת רמאות: נהג שעוצר ברמזור אדום (0 קמ"ש, באמצע נסיעה) יכול להפעיל את המנגנון בלי שזה יירשם, למרות שזו עבירה חוקית בישראל (איסור נגיעה בנייד תוך כדי נהיגה, גם בעצירה). ייתכן שדן יצטרך פתרון מורכב יותר לזה מבחינת האלגוריתם.

## עדכונים ושינויים נדרשים (למעקב שוטף)

דברים שזוהו תוך כדי עבודה שצריכים להידחף לתוך PR/ISSUE **קיים**. עדכונים שצריכים להפוך ל-ISSUE **חדש** (טרם נפתח ב-Linear) עברו ל-`ISSUES_TO_OPEN.md` — לא לשכפל כאן.

(ריק — שני הפריטים שהיו כאן, timing של ה-Alert וסדר כתיבת דגל AsyncStorage, בוצעו ב-2026-08-02 וממתינים לדחיפה+קומנט. ר' סטטוס CAR-7/#17 בטבלה למעלה.)

## שאלות פתוחות / החלטות ממתינות

שאלות שדורשות החלטה משותפת עם הצוות (לא רק "מה עלי לעשות") עברו ל-`QUESTIONS_TO_RAISE.md` — לא לשכפל כאן.
