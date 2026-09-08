from __future__ import annotations

import asyncio
import logging
from functools import lru_cache

from google import genai
from google.genai import errors, types

from app.config import settings
from app.services.scoring import WeakestFactor

logger = logging.getLogger(__name__)

# Pinned, not `gemini-flash-latest`: an alias moves the model under a deployed
# revision with no diff to show for it. The cost of pinning is that Google
# retires the pin — `gemini-2.5-flash` started answering 404 "no longer
# available to new users" to our key and every insight silently stopped — so
# whatever holds this string must survive that, which is what InsightRetryableError
# below is for.
_MODEL = "gemini-3.8-flash"
# The 3.x flash models reason before answering, which put a one-sentence tip at
# 5-12s wall clock. `low` measured ~4-8s against production's key; the default
# was consistently over the timeout. One Hebrew sentence needs no deliberation.
_THINKING = types.ThinkingConfig(thinking_level="low")
# Generation happens on first view (trips.ensure_ai_insight), not on save, but
# a driver is still on-screen waiting for the trip detail to render — a hung
# provider call must not hang the page. Miss the window and the read still
# succeeds, just with ai_insight left null, and the next view tries again.
_TIMEOUT_SECONDS = 10.0

# Provider errors that say nothing about this trip: the model name is wrong, the
# key is rejected, the service is down, or we ran out of patience. Retrying the
# same trip later is free and eventually works, so these must not consume the
# one attempt `trips.ensure_ai_insight` records. A 429 deliberately does not
# raise — quota is the exhaustion the attempt marker exists to stop.
_RETRYABLE_STATUS = frozenset({400, 403, 404})


class InsightRetryableError(Exception):
    """The provider never answered about this trip. Ask again on the next view."""


@lru_cache(maxsize=1)
def _client() -> genai.Client:
    # Cached rather than built per call: the SDK opens its own HTTP client
    # underneath, so one instance per process is the intended usage.
    return genai.Client(api_key=settings.gemini_api_key)


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

    Called once per trip, from `trips.ensure_ai_insight` on first view — never
    from the save path. `occurrences` is the raw count behind `weakest_factor`
    (hard_brakes, aggressive_accels, sharp_turns or touch_epochs — whichever
    matches), so the tip can cite it. Best-effort only: no provider error ever
    reaches the caller as a failure — a blank insight is a cosmetic gap, not a
    reason to fail a trip read. What the caller does learn is whether asking
    again could help: `InsightRetryableError` for a call the provider never answered,
    None for a real answer we could not use.
    """
    if not settings.gemini_api_key:
        return None

    try:
        response = await asyncio.wait_for(
            _client().aio.models.generate_content(
                model=_MODEL,
                contents=_build_prompt(score, weakest_factor, occurrences),
                config=types.GenerateContentConfig(thinking_config=_THINKING),
            ),
            timeout=_TIMEOUT_SECONDS,
        )
        text = (response.text or "").strip()
        return text[:500] or None
    except (TimeoutError, errors.ServerError) as exc:
        logger.warning("ai_insight generation did not complete", exc_info=True)
        raise InsightRetryableError from exc
    except errors.ClientError as exc:
        logger.warning("ai_insight generation failed", exc_info=True)
        if exc.code in _RETRYABLE_STATUS:
            raise InsightRetryableError from exc
        return None
    except Exception:
        logger.warning("ai_insight generation failed", exc_info=True)
        return None
