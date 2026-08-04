# שאלות/החלטות לצוות (אישי, לא מסונכרן)

מעקב אחר שאלות שצריך להעלות לחברי הצוות לצורך **החלטה משותפת** — לא bug לתקן, לא issue טכני לפתוח, אלא נקודה שדורשת בחירה בין כמה אפשרויות ואי אפשר להכריע עליה לבד. שונה מ-`ISSUES_TO_OPEN.md` (שם — עבודה שצריך לעשות, כאן — החלטה שצריך לקבל).

## מבנה ה-COMMENT (בנוסף לכללי הכתיבה הכלליים ב-`ISSUES_TO_OPEN.md` — קצר, אנגלית, גוף ראשון)

חמישה חלקים, כל אחד שורה־שתיים:

1. **ההחלטה/השאלה** — מה בדיוק צריך להכריע.
2. **האפשרויות** — לפחות 2, בקצרה, עם הטרייד-אוף המרכזי של כל אחת.
3. **המימוש הנוכחי בקוד** — מה קיים היום (אם בכלל) — כדי שהצד השני יידע מהי נקודת ההתחלה.
4. **האם זה חוסם** — האם יש issue/PR/פיתוח ספציפי שממתין להחלטה הזו כדי להתקדם, ואיזה.
5. **האם זה BUG פעיל** — האם המצב הנוכחי גורם לכשל בפועל בפרויקט עכשיו, או שזו שאלת עיצוב/כיוון בלבד.

## רשימה

| # | הנושא | למי לפנות | סטטוס | COMMENT מוכן |
|---|---|---|---|---|
| 1 | האם להוסיף קריאה נוספת ל-`maybePromptBatteryOptimizationExemption` בתוך `AppContext.loginUser` (בנוסף לקריאה הקיימת ב-`processEndTrip`) — כדי שגם הנסיעה הראשונה של משתמש חדש תהיה מוגנת, לא רק נסיעות מהשנייה ואילך | דן (הועלה כתגובה ל-PR #77, 2026-08-02) | ממתין לתשובתו | ר' `pr77_comment_addendum.md` בתיקיית ה-scratchpad — כבר פורסם/ממתין לפרסום כתגובה ל-PR #77 |
| 2 | **לא שאלה — עמדה:** סיווג ADMIN דחוף וחוסם אותי מלהתקדם בתחום האחריות שלי. "לבטל את ההתניה במקום לממש מנגנון" (כפי שדן כתב ב-#74, ועלה גם בשיחת צוות) אינו פתרון קביל | דן (הגיב על #74, הוריד עדיפות), נווה (מוקצה ל-#74) | לא הועלה עדיין | ר' `admin-mechanism-position.md` (scratchpad) לפירוט מלא + שני המקורות. קומנט מוכן למטה |

**ממתין להחלטת דן — עשוי לדרוש עדכון קוד נוסף ממני:** אם הוא מאשר את ההצעה, יש להוסיף שורת קוד אחת ב-`loginUser` (אותו pattern כמו ב-`processEndTrip`, מוגן ע"י אותו SHOWN_KEY). אם הוא מציע גישה אחרת — לחזור לתכנון. יש גם השלכות נוספות שצוינו בקומנט (לא פורטו לדן) שכדאי לבדוק לפני שמממשים: התנגשות אפשרית בין ה-Alert הזה לבין ה-toast/ניווט שקורים מיד אחרי login/register (למשל toast "ברוך הבא" ב-RegisterScreen) — לבדוק את זה בפועל אם/כשמממשים.

### פירוט שורה 2 — עמדה, לא שאלה פתוחה (חורג מכוונה מהתבנית הרגילה של הקובץ הזה, בכוונה)

זו לא בקשה להחלטה משותפת בין כמה אפשרויות שקולות. זו עמדה שאני מציגה: הסיווג דחוף, וההצעה לבטל את ההתניה במקום לממש מנגנון אינה קבילה.

1. **למה זה דחוף בפועל:** חוסם אותי לגמרי מלהתקדם בפיתוח בתחום האחריות שלי (מסכי נסיעה/סיכום/היסטוריה) — אין לי דרך לבדוק את המסכים האלו בלי לבצע נסיעה אמיתית בכל פעם, שזו לא שיטת בדיקה סבירה (ר' Back Door Manipulation).
2. **למה "לבטל את ההתניה" אינו פתרון קביל:** (א) `debugAddDistance` (`driving-sdk/index.ts:410`) הוא seam לבדיקות בלבד — חשיפתו לכל משתמש הופכת אותו לכלי הזרקת ק"מ מזויפים, בדיוק מה ש-`FraudDetector` קיים כדי לתפוס. (ב) אין היגיון לכתוב קוד עכשיו שמניח "אין סיווג תפקידים", ואז לחזור ולשנות את אותו הקוד שוב כשהמנגנון האמיתי ייכנס — זו עבודה כפולה שאין לה הצדקה.
3. **המימוש הנוכחי:** אין מנגנון API/CLI בכלל להענקת ADMIN, ואף חשבון לא הוסב ידנית ב-DB. `debugAddDistance` ו-`useDriveModeToggle.ts` (לא committed) הם שני המקומות היחידים שתלויים היום ב-`isAdmin()`.
4. **מה זה חוסם בפועל:** CAR-14/#26, CAR-15/#27, CAR-21/#35 (תלויים בבדיקת מסכי היסטוריית/סיכום נסיעה עם נתונים אמיתיים), ובעקיפין בדיקת `useDriveModeToggle` (מנגנון הניטור האוטומטי, עדיין WIP).

**קומנט מוכן (לפרסום על #74, מתייחס רק ל-ADMIN — סיווג בעל עסק נפתח כ-issue נפרד, שורה 9 ב-`ISSUES_TO_OPEN.md`):**

> This is urgent, not P3 — it's blocking me from moving forward on trip-summary/history/gamification work in my area right now, and there's no reasonable way around that without either faking a real drive every time or building on top of a role check that doesn't actually exist yet.
>
> "Nothing depends on ADMIN today" and "drop the check since it's not needed" are not the same claim, and I don't think the second one holds. `debugAddDistance` (`driving-sdk/index.ts:410`) injects arbitrary distance directly into a trip — it's a testing seam ([Back Door Manipulation](http://xunitpatterns.com/Back%20Door%20Manipulation.html)), not a feature. Drop its ADMIN gate and any real driver gets a way to inflate their own distance/points — exactly what `FraudDetector` exists to catch. And beyond that one button: writing code now around "there's no role gating" only holds until this ships — then I'm re-adding the same conditionals I'd have just stripped out. That's not work I'm doing twice.
>
> The env-var promote-command is a fine long-term answer. What I need now, independent of that: @navehtz, flip `mayhajbi` to ADMIN via the manual DB edit option 1 already lists. That unblocks my testing today without either of us waiting on the rest of this.

**מקורות תומכים (מקסימום 2, ר' `admin-mechanism-position.md` לפירוט):** [Back Door Manipulation](http://xunitpatterns.com/Back%20Door%20Manipulation.html) (xUnit Patterns) ו-[Feature Flag](https://martinfowler.com/bliki/FeatureFlag.html) (Martin Fowler) — השני רלוונטי בעיקר למנגנון הניטור האוטומטי (`useDriveModeToggle`), לא ל-#74 עצמו.

## הערות

- כשההחלטה מתקבלת ומיושמת — השורה יורדת מכאן (ואם רלוונטי, עוברת לתיעוד רגיל ב-`ISSUES.local.md`, לא נשארת גם כאן).
