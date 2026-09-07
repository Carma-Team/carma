from __future__ import annotations

import asyncio
import logging

from app.config import settings
from app.services.scoring import WeakestFactor

logger = logging.getLogger(__name__)

_MODEL = "gemini-2.5-flash"
# A driver is already looking at the score; a slow save must not hold them up
# waiting on a coaching sentence. Miss the window and the trip still saves —
# just with ai_insight left null, same as a driver with no `weakest_factor`.
_TIMEOUT_SECONDS = 5.0

_FACTOR_LABELS: dict[WeakestFactor, str] = {
    "braking": "בלימות חדות",
    "acceleration": "האצות חדות",
    "cornering": "פניות חדות",
    "speeding": "נסיעה מעל המהירות המותרת",
    "distraction": "שימוש בטלפון תוך כדי נהיגה",
}


def _build_prompt(score: float, weakest_factor: WeakestFactor | None, occurrences: int | None) -> str:
    if weakest_factor is None:
        return (
            f"נהג/ת סיימו נסיעה עם ציון {score:.0f} מתוך 100, בלי שום התנהגות בעייתית בולטת. "
            "כתוב/כתבי משפט אחד קצר בעברית, חם ומעודד, שמשבח את איכות הנהיגה. "
            "בלי שאלות, בלי אימוג'ים, בלי לצטט את המספר."
        )
    label = _FACTOR_LABELS[weakest_factor]
    # A raw count reads as measured, not guessed — "3 בלימות חדות" is a fact
    # about this specific trip, "בלימות חדות" alone is the same sentence every
    # time a driver brakes hard at all. Speeding has no persisted count
    # (Trip stores no ratio/occurrences column for it), so it falls back to
    # the label alone rather than a fabricated number.
    detail = f"{occurrences} מקרים של {label}" if occurrences else label
    return (
        f"נהג/ת סיימו נסיעה עם ציון {score:.0f} מתוך 100. "
        f"ההתנהגות הכי בעייתית בנסיעה הזו הייתה: {detail}. "
        "כתוב/כתבי משפט אחד קצר בעברית עם טיפ פרקטי וממוקד לשיפור, בגובה העיניים. "
        "בלי שאלות, בלי אימוג'ים, בלי לצטט את הציון."
    )


async def generate(score: float, weakest_factor: WeakestFactor | None, occurrences: int | None = None) -> str | None:
    """One personalized Hebrew sentence coaching the driver on this trip.

    `occurrences` is the raw count behind `weakest_factor` (hard_brakes,
    aggressive_accels, sharp_turns or touch_epochs — whichever matches), so the
    tip can cite it. Best-effort only: a missing key, a timeout, or any
    provider error returns None rather than failing the caller — a blank
    insight is a cosmetic gap, not a reason to fail a trip save or a read.
    """
    if not settings.gemini_api_key:
        return None

    try:
        from google import genai

        client = genai.Client(api_key=settings.gemini_api_key)
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=_MODEL, contents=_build_prompt(score, weakest_factor, occurrences)
            ),
            timeout=_TIMEOUT_SECONDS,
        )
        text = (response.text or "").strip()
        return text[:500] or None
    except Exception:
        logger.warning("ai_insight generation failed", exc_info=True)
        return None
