/**
 * @fileoverview Global application state manager — AppContext
 * @module context/AppContext
 *
 * @description
 * Central context managing all global state:
 * - **User**: loaded from AsyncStorage, refreshed from server on auth, logout
 * - **Trip**: `processEndTrip` — server persistence, points/level update. The payload
 *   itself is shaped in `lib/tripPayload.ts`; nothing here computes a score.
 * - **Trip list**: synced with server on login, persisted to AsyncStorage
 * - **UI**: toasts, language, loading state
 * - **SDK**: registers conditional event listeners on DrivingSDK
 *
 * @server
 * - `authApi.me()` — GET /api/auth/me — refresh user details on startup
 * - `tripsApi.list()` — GET /api/trips — sync trips on login
 * - `tripsApi.save()` — POST /api/trips — persist a completed trip
 * Every call goes to the real server either way — USE_REAL_SERVER only chooses
 * between the local one and the deployed one (constants/serverConfig.ts).
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, I18nManager } from 'react-native'
import type { AppUser, Language, ToastMessage, Trip } from '@/types'
import type { AuthResponse } from '@/services/api/auth.api'
import { DrivingSDK, TripData, RawExportFailure, checkDeviceCapabilities } from '@/lib/driving-sdk'
import { TripValidationManager } from '@/lib/TripValidationManager'
import { maybePromptBatteryOptimizationExemption } from '@/lib/BatteryOptimizationPrompt'
import * as Location from 'expo-location'
import { tripsApi } from '@/services/api/trips.api'
import { authApi } from '@/services/api/auth.api'
import { ApiError } from '@/services/api/client'
import { levelsApi } from '@/services/api/levels.api'
import { pingServer } from '@/services/api/health.api'
import { getLevelByPoints, setLevels } from '@/lib/constants'
import { availableBalance } from '@/lib/utils'
import { fromLocalTrip, mergeUnsentTrips, TOO_SHORT_SUMMARY, type TripSummary } from '@/lib/tripSummary'
import { buildValidTripPayload } from '@/lib/tripPayload'
import { vehicleKeyHash } from '@/lib/vehicleKey'
import Constants from 'expo-constants'
import he from '@/i18n/he'
import en from '@/i18n/en'
import { SyncManager } from '@/services/sync/SyncManager'
import { levelDisplay, detectLevelChange } from '@/lib/gamification'
import type { GamificationLevel } from '@/lib/gamification'
import { INITIAL_TRIP_STATE, type TripState } from './tripState'
import { useSdkBindings } from './sdkBindings'
import { useScoringEvents } from './scoringEvents'
import { useFraudBinding } from './fraudBinding'
import { useRegionBinding } from './regionBinding'

export type { TripState } from './tripState'

/**
 * The Bluetooth device the driver picked as "their car", held locally only.
 * The server has columns for it, but no endpoint writes them — and a re-install
 * should force a fresh pick anyway, since a new handset is paired to different
 * devices and stale settings are worse than none.
 */
export type BluetoothTarget = { id: string; name?: string } | null

interface AppContextValue {
  user: AppUser | null
  setUser: (user: AppUser | null) => void
  patchUser: (fields: UserPatch | ((prev: AppUser) => UserPatch)) => void
  loginUser: (data: AuthResponse) => Promise<void>
  lang: Language
  setLang: (lang: Language) => void
  toasts: ToastMessage[]
  addToast: (toast: Omit<ToastMessage, 'id'>) => void
  removeToast: (id: string) => void
  isLoading: boolean
  deviceBlocked: boolean
  tripState: TripState
  endTrip: () => Promise<TripState>
  recentTrips: Trip[]
  simulateBTConnect: () => void
  simulateBTDisconnect: () => void
  lastTripSummary: TripSummary | null
  setLastTripSummary: (v: TripSummary | null) => void
  startTrip: () => Promise<void>
  debugAddDistance: (km: number) => void
  startRawRecording: (scenario: string, platform: string) => Promise<void>
  stopRawRecording: () => Promise<void>
  exportRawRecording: (filePath?: string) => Promise<string | RawExportFailure>
  deleteTrips: (tripIds: string[]) => Promise<void>
  sdk: DrivingSDK
  btDevice: BluetoothTarget
  setBtDevice: (device: BluetoothTarget) => Promise<void>
  // TODO: Mai — subscribe to `userLevelState` for level-up animations and progress bar UI
  userLevelState: GamificationLevel
}

type UserPatch = Partial<AppUser>

// Stamped on a staged recording's header so an offline reader can tell which handset
// produced a drive (CAR-212). The device *name* rather than a model string: the app has
// no device-info dependency to add one, and this label only has to tell the handful of
// phones that record calibration drives apart from each other.
const DEVICE_MODEL = Constants.deviceName ?? 'unknown'

// Everything that belongs to whoever is signed in, cleared together whenever a
// session ends. A key added here is a key the next logout will not forget.
const SESSION_KEYS = ['carma_user', 'carma_token', 'carma_trips']

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AppUser | null>(null)
  const [lang, setLangState] = useState<Language>('HE')
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deviceBlocked, setDeviceBlocked] = useState(false)
  const [recentTrips, setRecentTrips] = useState<Trip[]>([])
  const [tripState, setTripState] = useState<TripState>(INITIAL_TRIP_STATE)
  const [lastTripSummary, setLastTripSummary] = useState<TripSummary | null>(null)
  const [btDevice, setBtDeviceState] = useState<BluetoothTarget>(null)
  // Derived, not tracked: a level held beside the user is a second copy that can
  // disagree with `user.level`, and the offline trip path is where it did (CAR-263).
  // Every write that moved this state also wrote the level it came from.
  const userLevelState = useMemo<GamificationLevel>(() => levelDisplay(user?.level ?? 1), [user?.level])

  /**
   * Applies a partial change to the user against whatever the state holds now.
   *
   * The alternative — building `{ ...user, field }` from the `user` a screen or a
   * callback closed over — reverts anything that landed while its request was in
   * flight, and a trip finishing mid-request is exactly that. Callers whose new
   * value depends on the old one (points arithmetic) pass a function and get the
   * same guarantee for the read.
   *
   * Declared here, above its consumers: several of them are effects and callbacks
   * defined further down.
   */
  const patchUser = useCallback((fields: UserPatch | ((prev: AppUser) => UserPatch)) => {
    setUserState(prev => {
      if (!prev) return prev;
      const merged = { ...prev, ...(typeof fields === 'function' ? fields(prev) : fields) };
      // Written from inside the updater because this is the only place the latest
      // user is visible. Non-blocking, like the other writes here — a storage
      // failure must not take the state change down with it.
      AsyncStorage.setItem('carma_user', JSON.stringify(merged)).catch(e =>
        console.error('[AppContext] Failed to persist user patch', e)
      );
      return merged;
    });
  }, []);

  // Two hides, not deletes: the server has no way to remove a trip (CAR-307). The
  // cutoff is what the old settings-wide reset left behind on devices that used it,
  // and is kept so those trips do not reappear; new deletions are per trip.
  const filteredTrips = useMemo(() => {
    const cutoff = user?.lastClearedHistory ? new Date(user.lastClearedHistory).getTime() : null;
    const deleted = new Set(user?.deletedTripIds ?? []);
    if (cutoff === null && deleted.size === 0) return recentTrips;
    return recentTrips.filter(trip =>
      !deleted.has(trip.id) &&
      (cutoff === null || new Date(trip.startTime).getTime() > cutoff)
    );
  }, [recentTrips, user?.lastClearedHistory, user?.deletedTripIds]);

  // TripValidationManager (30s-start/3min-end/fraud rules) is CARMA-specific business
  // logic — the SDK itself only ships a trivial default. This is the app "wrapping"
  // the generic library with its own trip-validation rules, per the driving-sdk
  // boundary: nothing CARMA-specific lives inside src/lib/driving-sdk/ itself.
  const sdk = useMemo(() => new DrivingSDK({
    tripValidator: new TripValidationManager(),
    // The salt is CARMA's, so the hashing is CARMA's — the SDK is handed the function and
    // never the secret, the same shape the validator is injected in (CAR-310).
    vehicleKeyHasher: vehicleKeyHash,
  }), []);
  // Bumped on every identity change — login, driver switch, logout. An async path
  // copies it on entry and drops its write if the number moved while it awaited;
  // without that, a request the previous driver started lands on the current one.
  const sessionRef = useRef(0)
  const tripRef = useRef(tripState)
  useEffect(() => { tripRef.current = tripState; }, [tripState])
  // Raw TripData from the SDK's onTripEnd callback — holds waypoints and events with locations
  const lastTripDataRef = useRef<TripData | null>(null);

  /**
   * Refreshes the trip list from the server, keeping what the device already has if
   * the call fails. `gen` is the session the caller started in — a list that arrives
   * after the driver changed belongs to nobody on screen and is dropped.
   *
   * The cache is read unfiltered: `setUser` drops it on a driver change, so whatever
   * is left is this driver's own.
   *
   * The server's answer is merged into the cache rather than replacing it. A trip still
   * in the sync queue is not on the server, and this runs before the queue is flushed on
   * a cold start — replacing the list wholesale erased an offline trip on the first
   * online launch after recording it, so neither sync outcome had a row left to update.
   */
  const refreshTrips = useCallback(async (gen: number) => {
    try {
      const [serverData, raw] = await Promise.all([
        tripsApi.list(),
        AsyncStorage.getItem('carma_trips'),
      ]);
      if (gen !== sessionRef.current) return;
      const merged = mergeUnsentTrips(raw ? (JSON.parse(raw) as Trip[]) : [], serverData.trips);
      setRecentTrips(merged);
      await AsyncStorage.setItem('carma_trips', JSON.stringify(merged));
    } catch {
      const cached = await AsyncStorage.getItem('carma_trips');
      if (gen !== sessionRef.current || !cached) return;
      setRecentTrips(JSON.parse(cached) as Trip[]);
    }
  }, []);

  const addToast = useCallback((t: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { ...t, id }])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.duration ?? 3500)
  }, [])

  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  const processEndTrip = useCallback(async () => {
    const finalState = { ...tripRef.current };
    if (!finalState.isActive) return null;

    // #17 — one-time nudge, Android only; no-ops after the first trip (AsyncStorage-gated).
    // Fires here in the trip-summary flow (after the trip has actually ended), not on trip
    // start, so it never pops up in front of a driver who is mid-drive.
    maybePromptBatteryOptimizationExemption(lang === 'HE' ? he : en).catch(() => {});

    if (finalState.distanceKm < 0.1) {
      setLastTripSummary(TOO_SHORT_SUMMARY);
      return finalState;
    }

    const tripStartTime = finalState.startTime?.toISOString()
      ?? new Date(Date.now() - finalState.durationSeconds * 1000).toISOString();
    const endTime = new Date().toISOString();

    const validTripPayload = buildValidTripPayload(
      finalState, lastTripDataRef.current, tripStartTime, endTime,
    );

    let savedTrip: Trip | null = null;
    let isPermanentFailure = false;
    try {
      savedTrip = await tripsApi.save(validTripPayload);
    } catch (e) {
      const httpStatus = e instanceof ApiError ? e.status : 0;
      if (httpStatus === 401 || httpStatus === 403 || httpStatus === 422) {
        // Permanent client error — stale timestamp, tampered payload, physics violation
        isPermanentFailure = true;
        addToast({
          title: httpStatus === 401 ? 'Replay Detected'
               : httpStatus === 403 ? 'Payload Rejected'
               : 'Trip Rejected',
          message: `Trip could not be saved (${httpStatus})`,
          type: 'error',
        });
      } else {
        console.warn('[AppContext] Server unreachable — queuing trip for later sync', e);
        await SyncManager.enqueue(validTripPayload);
      }
    }

    if (isPermanentFailure) {
      return finalState;
    }

    // Use server-returned score/points as the single source of truth.
    // These zeros are the stored row's, not the summary's: the row must satisfy the
    // schema, while the summary says `pending` instead of showing a score nobody gave
    // (see fromLocalTrip). SyncManager.onTripSynced replaces the row once the save lands.
    const serverScore          = savedTrip?.avgScore      ?? 0;
    const serverPointsRaw      = savedTrip?.points        ?? 0;
    const serverRiskMultiplier = savedTrip?.riskMultiplier ?? 1.0;
    const serverEffectiveRisk  = savedTrip?.effectiveRiskMultiplier ?? serverRiskMultiplier;
    // The server's number, unmodified. It already includes the level bonus
    // (services/levels.py). Scaling it here again is what made the summary
    // disagree with trip history on the next refresh (#29).
    const earnedPoints         = Math.round(serverPointsRaw);

    const newTrip: Trip = savedTrip
      ? savedTrip
      : {
          id: finalState.sessionId,
          userId: user?.id || 'guest',
          startTime: tripStartTime,
          endTime,
          distanceKm: finalState.distanceKm,
          durationSeconds: finalState.durationSeconds,
          avgScore: serverScore,
          points: earnedPoints,
          hardBrakes: finalState.eventCounts.HARD_BRAKE,
          aggressiveAccels: finalState.eventCounts.AGGRESSIVE_ACCEL,
          sharpTurns: finalState.eventCounts.SHARP_TURN,
          // Still required by the trip schema, and nothing measures it any more —
          // the column goes with CAR-188.
          touchEpochs: 0,
          screenInteractionSeconds: finalState.screenInteractionSeconds,
          riskMultiplier: serverRiskMultiplier,
          effectiveRiskMultiplier: serverEffectiveRisk,
          status: 'completed',
          // Server-only fields. This branch runs when the save never landed, so
          // there is nothing to fill them with — the sync refreshes the row later.
          startLocation: null,
          endLocation: null,
          aiInsight: null,
          pointsCapped: false,
          pendingSync: true,
          // Not server-only: the SDK measured these during the trip we just
          // ended, and they are already in the payload queued for sync. Writing
          // null would report a healthy sensor as unknown until the save lands.
          accelAvailable: lastTripDataRef.current?.accelAvailable ?? null,
          accelInitFailed: lastTripDataRef.current?.accelInitFailed ?? null,
        };

    const existingTripsJson = await AsyncStorage.getItem('carma_trips');
    const existingTrips = existingTripsJson ? JSON.parse(existingTripsJson) : [];
    const updatedTrips = [newTrip, ...existingTrips.filter((t: Trip) => t.id !== newTrip.id)].slice(0, 10);
    setRecentTrips(updatedTrips);
    await AsyncStorage.setItem('carma_trips', JSON.stringify(updatedTrips));

    if (user) {
      // Totals are re-derived from the state at write time, not from the `user` this
      // callback closed over: saving the trip is a round trip to the server, and a
      // settings change made while it ran would otherwise be rolled back here.
      patchUser(prev => {
        // Single source of truth: prefer totalPoints (persisted accumulator), fall back to points
        const earnedFrom = prev.totalPoints ?? prev.points ?? 0;
        const newTotalPoints = earnedFrom + earnedPoints;
        // The server resolved the level when it saved the trip — including the
        // driver-score cap, which no amount of local arithmetic can reproduce
        // (#37). Only fall back to a points lookup if the save never landed, and
        // then off the total this same write is producing: derived out here it came
        // from the snapshot the callback closed over, so an update landing while the
        // save was in flight paired a fresh total with an older level (CAR-263).
        const newLevel = savedTrip?.userLevel ?? getLevelByPoints(newTotalPoints);

        const levelChange = detectLevelChange(prev.level ?? newLevel, newLevel);
        if (levelChange) {
          const direction = levelChange.to > levelChange.from ? 'LEVEL_UP' : 'LEVEL_DOWN';
          console.log(`[Gamification] ${direction}: ${levelChange.from} -> ${levelChange.to}`);
        }

        return {
          points: newTotalPoints,       // spec field (5.3.1.1)
          totalPoints: newTotalPoints,  // Dashboard/Profile UI reads this
          // What the trip earned is spendable immediately. Without this the store's
          // balance stays on the pre-trip number until the next full user refresh,
          // since reserved points are the only other thing that moves it.
          availablePoints: availableBalance(prev) + earnedPoints,
          totalDistance: (prev.totalDistance || 0) + finalState.distanceKm,
          level: newLevel,
        };
      });
    }

    setLastTripSummary(fromLocalTrip(newTrip.id, savedTrip, finalState, lastTripDataRef.current));
    return finalState;
  }, [user, addToast, lang, patchUser]);

  // The SDK's onTripEnd is a synchronous callback, so the promise `processEndTrip`
  // returns had nowhere to go and was dropped. `stopTrip` then resolved while the save
  // and the score it waits for were still in flight, and every caller that awaited
  // `endTrip` — the end-of-trip spinner among them — carried on without a score
  // (CAR-301). Holding it here is what gives `endTrip` something to wait on.
  const endInFlightRef = useRef<Promise<TripState | null> | null>(null);
  const handleTripEnded = useCallback(() => {
    // The reset lives here and not on each exit inside `processEndTrip`: the three
    // paths that had their own copy all reached it, but a throw between the save and
    // the last line reached none of them, and the UI then held a finished trip open
    // as active until the app restarted. One `finally` covers every exit there is.
    endInFlightRef.current = processEndTrip().finally(() => {
      lastTripDataRef.current = null;
      setTripState(INITIAL_TRIP_STATE);
    });
  }, [processEndTrip]);

  useSdkBindings({ sdk, setTripState, tripRef, lastTripDataRef, onTripEnded: handleTripEnded });
  useScoringEvents(sdk, setTripState);
  useFraudBinding(sdk, user, setTripState, addToast, lang);
  useRegionBinding(sdk, setTripState, addToast, lang);

  // Both sync outcomes rewrite one cached row. Going through the cache rather than
  // through `prev` keeps the persist out of the setRecentTrips updater, which React
  // double-invokes under StrictMode — and it is the pattern processEndTrip already uses.
  // Serialised, because it is a read-then-write and both callers fire it without
  // awaiting. Two trips crossing the age bound in one flush pass are abandoned in the
  // same tick, so unchained they both read the pre-patch cache and the second write
  // drops the first — leaving a trip that will never be sent still telling the driver
  // it will be.
  const cacheWrites = useRef<Promise<void>>(Promise.resolve());

  const patchCachedTrip = useCallback((
    gen: number,
    localId: string,
    patch: (t: Trip) => Trip,
  ) => {
    cacheWrites.current = cacheWrites.current.then(async () => {
      try {
        const raw = await AsyncStorage.getItem('carma_trips');
        // The row belongs to whoever was signed in when the sync resolved.
        if (gen !== sessionRef.current || !raw) return;
        const updated = (JSON.parse(raw) as Trip[]).map(t => (t.id === localId ? patch(t) : t));
        setRecentTrips(updated);
        await AsyncStorage.setItem('carma_trips', JSON.stringify(updated));
      } catch (e) {
        // Neither caller can do anything about it, and both are fire-and-forget. Worth
        // logging rather than swallowing: an abandoned trip that fails to be marked keeps
        // telling the driver it will be sent automatically, and nothing is retrying it.
        console.error('[AppContext] Failed to update cached trip', e);
      }
    });
    return cacheWrites.current;
  }, []);

  // ─── SyncManager: replace local-only trip with server trip after offline sync ──
  useEffect(() => {
    SyncManager.onTripSynced = (localId: string, serverTrip: Trip) => {
      const gen = sessionRef.current;
      patchCachedTrip(gen, localId, () => serverTrip);
      // Re-fetch authoritative user totals so points/level reflect the committed trip.
      // Handles the app-restart-then-sync case where loadInitialData ran before the
      // queue was flushed and therefore fetched stale server totals.
      authApi.me().then(freshUser => {
        // The totals belong to whoever was signed in when the trip synced.
        if (gen !== sessionRef.current) return;
        patchUser(freshUser);
      }).catch(() => {});
    };
  }, [patchUser, patchCachedTrip]);

  // ─── SyncManager: the queue gave up on a trip — mark the row, never remove it ──
  useEffect(() => {
    SyncManager.onTripAbandoned = (localId: string) => {
      // `pendingSync` deliberately stays on. It does not mean "an upload is in flight",
      // it means the score in this row is the placeholder zero we wrote ourselves — which
      // is true of an abandoned trip permanently. Clearing it would let that zero into
      // weeklyScoreTrend. Readers tell the two apart by precedence: syncFailed wins.
      patchCachedTrip(sessionRef.current, localId, t => ({ ...t, syncFailed: true }));
    };
  }, [patchCachedTrip]);

  // ─── AppState: flush queued trips when app returns to foreground ──────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        SyncManager.flushQueue().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  // CAR-23: device-capability gate, checked once at startup, independent of the
  // auth/data load below. Region is no longer checked here — a GPS fix on every
  // cold start was real battery/latency cost for no benefit to a returning user
  // already known to be in Israel. Region is enforced at trip start instead (see
  // TripValidationManager's region check), and acknowledged once at registration.
  useEffect(() => {
    checkDeviceCapabilities()
      .then(({ hasAccelerometer, hasGyroscope, osSupported }) => {
        if (!hasAccelerometer || !hasGyroscope || !osSupported) setDeviceBlocked(true);
      })
      .catch(() => {}); // fail open — an unexpected error here must not lock out a supported device
  }, []);

  useEffect(() => {
    async function loadInitialData() {
      const gen = sessionRef.current;
      const serverOnline = await pingServer();
      try {
        const [l, u, btId, btName, token, levelsRes] = await Promise.all([
          AsyncStorage.getItem('carma_lang'),
          AsyncStorage.getItem('carma_user'),
          AsyncStorage.getItem('carma_bt_device_id'),
          AsyncStorage.getItem('carma_bt_device_name'),
          AsyncStorage.getItem('carma_token'),
          levelsApi.list().catch(() => null),
        ])
        if (levelsRes?.levels?.length) setLevels(levelsRes.levels);
        if (l === 'HE' || l === 'EN') setLangState(l)
        // Only restores state. Arming the SDK listener is useDriveMode's job, and
        // only its — two callers racing over one subscription is what broke this.
        // name may be absent for a device picked before it was stored — the target
        // still works, the UI just falls back until the driver picks again.
        if (btId) setBtDeviceState({ id: btId, name: btName ?? undefined })

        if (!serverOnline) {
          const tr = l === 'EN' ? en : he;
          addToast({ type: 'warning', message: tr.common.serverUnreachable, duration: 6000 });
        }

        // Parsed above the branch so that both the refresh and its fallback can read
        // it: a `const` inside the `try` is not visible from the `catch`.
        let stored: AppUser | null = null;
        if (u) {
          try { stored = JSON.parse(u) as AppUser } catch { stored = null }
        }

        if (stored && token) {
          // Saved token found — validate against server and refresh data.
          // Two try blocks and not one: the trip list is a refresh, and a failed one
          // must not cost the driver the session `me()` just confirmed.
          if (!stored.level) stored.level = getLevelByPoints(stored.totalPoints || 0);
          let signedIn = true;
          try {
            const freshUser = await authApi.me();
            // Restoring the stored session is only right while it is still the one
            // signed in. A logout during startup ends it, and nothing below may put
            // the account back into state or storage.
            if (gen !== sessionRef.current) return;
            const merged = { ...stored, ...freshUser };
            if (!merged.level) merged.level = getLevelByPoints(merged.totalPoints || 0);
            setUserState(merged);
            await AsyncStorage.setItem('carma_user', JSON.stringify(merged));
          } catch (e) {
            if (gen !== sessionRef.current) return;
            // Only the server saying "not you" ends the session. A network failure or
            // a timeout means it never answered, and clearing the token on that signed
            // a driver out of a working account for starting the app offline — taking
            // the cached trips with it. Offline start keeps the stored user instead.
            if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
              await AsyncStorage.multiRemove(SESSION_KEYS);
              setUserState(null);
              setRecentTrips([]);
              signedIn = false;
            } else {
              setUserState(stored);
            }
          }

          if (signedIn) await refreshTrips(gen);
        } else if (u && token) {
          // A stored session that will not parse can restore nothing, and leaving it
          // in place repeats this on every start.
          await AsyncStorage.multiRemove(SESSION_KEYS);
        }
        SyncManager.flushQueue().catch(() => {});
      } catch (e) {
        console.error('Error loading initial data', e);
      } finally {
        setIsLoading(false)
      }
    }
    loadInitialData()
  }, [sdk, addToast, refreshTrips])

  const startTrip = useCallback(async () => {
    // TODO: GPS Logic - After first GPS sample, perform reverse geocoding to identify
    // current city/country, then update user state locally.
    const now = new Date();
    const sessionId = `trip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await sdk.startTrip();
    setTripState({ ...INITIAL_TRIP_STATE, isActive: true, startTime: now, sessionId });
  }, [sdk]);

  const endTrip = useCallback(async () => {
    // `stopTrip` fires onTripEnd before it resolves, so the ref is populated by the
    // time this reads it. Swallowed on purpose: processEndTrip already reports every
    // failure it knows about, and an unexpected throw must still let the caller take
    // its spinner down rather than leaving it up forever.
    await sdk.stopTrip();
    let finished: TripState | null = null;
    try {
      finished = (await endInFlightRef.current) ?? null;
    } catch (e) {
      console.error('[AppContext] End-of-trip processing failed', e);
    } finally {
      endInFlightRef.current = null;
    }
    // The state `processEndTrip` ended the trip on, not `tripRef`: the ref is written
    // by an effect a render later, so reading it here returned the finished trip or
    // the reset one depending on when React flushed.
    return finished ?? tripRef.current;
  }, [sdk]);

  const setBtDevice = useCallback(async (device: BluetoothTarget) => {
    setBtDeviceState(device);
    if (device) {
      await AsyncStorage.multiSet([
        ['carma_bt_device_id', device.id],
        ['carma_bt_device_name', device.name ?? ''],
      ]);
    } else {
      await AsyncStorage.multiRemove(['carma_bt_device_id', 'carma_bt_device_name']);
    }
  }, []);

  const setUser = useCallback(async (u: AppUser | null) => {
    // The single writer of "who is signed in", so the single place that ends a
    // session for every async path holding the previous number.
    sessionRef.current++;
    if (!u) {
      setUserState(null);
      setRecentTrips([]);
      // carma_trips goes with the session. Left behind, the offline fallback hands
      // the next driver on the handset the previous driver's trips.
      await AsyncStorage.multiRemove(SESSION_KEYS);
    } else {
      // The trip cache belongs to whoever was signed in, so it survives only into a
      // sign-in by that same driver — the partial writes that also come through here
      // (points after a redeem, the drive mode toggle) are exactly that. Anyone else
      // starts empty, including a driver who signed in over one who never logged out.
      // Compared against storage and not against the `user` in state: this callback is
      // created once and closes over nothing. An unreadable record proves nothing about
      // whose rows those are, so it counts as someone else.
      const previous = await AsyncStorage.getItem('carma_user');
      let sameDriver = false;
      try { sameDriver = !!previous && (JSON.parse(previous) as AppUser).id === u.id } catch { sameDriver = false }
      if (!sameDriver) {
        setRecentTrips([]);
        await AsyncStorage.removeItem('carma_trips');
      }
      setUserState(u);
      await AsyncStorage.setItem('carma_user', JSON.stringify(u));
    }
  }, []);

  const loginUser = useCallback(async (data: AuthResponse) => {
    await AsyncStorage.setItem('carma_token', data.token);
    await setUser(data.user);

    // CAR-23: prime the location prompt right after login/register, so it isn't a
    // surprise at the driver's first trip start. Foreground only — background is
    // still asked for at trip start. Fire-and-forget: a decline here doesn't block
    // login, and SensorManager asks again at trip start anyway. Here rather than in
    // setUser for the same reason the trip fetch is, below.
    Location.requestForegroundPermissionsAsync().catch(() => {});

    // Trips are fetched here and not in setUser: every partial write to the user
    // (points after a redeem, the drive mode toggle) goes through setUser too, and
    // used to drag a full trip list refetch along with it.

    // Read after setUser, which is the call that bumped the session for this login.
    await refreshTrips(sessionRef.current);
  }, [setUser, refreshTrips]);

  const setLang = useCallback(async (l: Language) => {
    setLangState(l);
    I18nManager.forceRTL(l === 'HE');
    await AsyncStorage.setItem('carma_lang', l);
  }, [])

  const simulateBTConnect = useCallback(() => sdk.simulateBluetoothConnection(), [sdk]);
  const simulateBTDisconnect = useCallback(() => sdk.simulateBluetoothDisconnection(), [sdk]);

  const debugAddDistance = useCallback((km: number) => {
    sdk.debugAddDistance(km);
  }, [sdk]);

  const startRawRecording = useCallback(
    (scenario: string, platform: string) => sdk.startRawRecording(scenario, platform, DEVICE_MODEL),
    [sdk]
  );
  const stopRawRecording = useCallback(() => sdk.stopRawRecording(), [sdk]);
  const exportRawRecording = useCallback((filePath?: string) => sdk.exportRawRecording(filePath), [sdk]);

  const deleteTrips = useCallback(async (tripIds: string[]) => {
    if (tripIds.length === 0) return;
    try {
      if (user) {
        // Through patchUser, and not `{ ...user, ... }` off the closed-over user:
        // that snapshot is as old as the screen that called this, and a trip landing
        // mid-delete was rolled back by it.
        // Union rather than append: the same trip can be selected again after a
        // failed write, and a duplicate id would silently grow the stored list.
        patchUser(prev => ({
          deletedTripIds: Array.from(new Set([...(prev.deletedTripIds ?? []), ...tripIds])),
        }));
      }

      const tr = lang === 'HE' ? he : en;
      addToast({
        title: tr.common.tripsDeleted,
        message: tr.common.tripsDeletedDesc,
        type: 'success'
      });
    } catch (e) {
      console.error('Failed to delete trips', e);
    }
  }, [lang, addToast, user, patchUser]);

  return (
    <AppContext.Provider value={{
      user, setUser, patchUser, loginUser, lang, setLang, toasts, addToast, removeToast, isLoading,
      deviceBlocked,
      tripState, startTrip, endTrip,
      recentTrips: filteredTrips,
      simulateBTConnect, simulateBTDisconnect,
      lastTripSummary, setLastTripSummary,
      debugAddDistance,
      startRawRecording, stopRawRecording, exportRawRecording,
      deleteTrips,
      sdk,
      btDevice, setBtDevice,
      userLevelState,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
