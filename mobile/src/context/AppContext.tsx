/**
 * @fileoverview Global application state manager — AppContext
 * @module context/AppContext
 *
 * @description
 * Central context managing all global state:
 * - **User**: loaded from AsyncStorage, refreshed from server on auth, logout
 * - **Trip**: `processEndTrip` — score calculation, server persistence, points/level update
 * - **Trip list**: synced with server on login, persisted to AsyncStorage
 * - **UI**: toasts, language, loading state
 * - **SDK**: registers conditional event listeners on DrivingSDK
 *
 * @server
 * - `authApi.me()` — GET /api/auth/me — refresh user details on startup
 * - `tripsApi.list()` — GET /api/trips — sync trips on login
 * - `tripsApi.save()` — POST /api/trips — persist a completed trip
 * - USE_REAL_SERVER=false: all calls intercepted in client.ts (mock)
 * - USE_REAL_SERVER=true: calls go to the real server
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, I18nManager } from 'react-native'
import type { AppUser, Language, ToastMessage, Trip } from '@/types'
import type { AuthResponse } from '@/services/api/auth.api'
import { DrivingSDK, TripData } from '@/lib/driving-sdk'
import { TripValidationManager } from '@/lib/TripValidationManager'
import { checkDeviceCapabilities } from '@/lib/driving-sdk/DeviceCapabilities'
import { maybePromptBatteryOptimizationExemption } from '@/lib/BatteryOptimizationPrompt'
import * as Location from 'expo-location'
import { tripsApi } from '@/services/api/trips.api'
import { authApi } from '@/services/api/auth.api'
import { ApiError } from '@/services/api/client'
import { levelsApi } from '@/services/api/levels.api'
import { pingServer } from '@/services/api/health.api'
import { getLevelByPoints, setLevels } from '@/lib/constants'
import { availableBalance } from '@/lib/utils'
import { fromLocalTrip, TOO_SHORT_SUMMARY, type TripSummary } from '@/lib/tripSummary'
import { signTelemetryDigest } from '@/lib/telemetrySigning'
import he from '@/i18n/he'
import en from '@/i18n/en'
import { SyncManager } from '@/services/sync/SyncManager'
import type { ValidTripPayload, TelemetryDigest } from '@/services/sync/types'
import { levelDisplay, detectLevelChange } from '@/lib/gamification'
import type { GamificationLevel } from '@/lib/gamification'
import { INITIAL_TRIP_STATE, type TripState } from './tripState'
import { useSdkBindings } from './sdkBindings'
import { useScoringEvents } from './scoringEvents'
import { useFraudBinding } from './fraudBinding'
import { useRegionBinding } from './regionBinding'

export type { TripState } from './tripState'

// ─── TelemetryDigest builder ──────────────────────────────────────────────────
// Produces the raw-sensor canonical snapshot defined in RFC-001 v1.7 §3.1.
// avgScore, points, and phoneSeconds are absent — server is the sole scoring oracle.
// timestamp is injected at call time to enable server-side replay detection.

function buildTelemetryDigest(
  state: TripState,
  startTime: string,
  endTime: string,
  // Read from TripData (via lastTripDataRef at the call site), not TripState — accel
  // health is SDK trip data, not part of the reducer-shaped trip state (CAR-189).
  //
  // Optional on purpose: a trip that ended with no SDK data at all knows nothing about
  // the accelerometer, and `undefined` is that. Defaulting to `false` here turned that
  // silence into the claim "the sensor was not live", which is the one thing the field
  // must never say on its own — and it disagreed with the top-level payload, which
  // sends the same values with no default at all.
  accelAvailable: boolean | undefined,
  accelInitFailed: boolean | undefined,
  accelCoverage: number | undefined,
): TelemetryDigest {
  return {
    distanceKm:               Math.round(state.distanceKm * 1000) / 1000,
    durationSeconds:          state.durationSeconds,
    hardBrakes:               state.eventCounts.HARD_BRAKE,
    aggressiveAccels:         state.eventCounts.AGGRESSIVE_ACCEL,
    sharpTurns:               state.eventCounts.SHARP_TURN,
    touchEpochs:              state.touchEpochs,
    screenInteractionSeconds: state.screenInteractionSeconds,
    startTime,
    endTime,
    timestamp:                Date.now(),
    accelAvailable,
    accelInitFailed,
    accelCoverage,
  };
}

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
  exportRawRecording: () => Promise<string | { error: 'none-recorded' | 'sharing-unavailable' }>
  clearTripHistory: () => Promise<void>
  sdk: DrivingSDK
  btDevice: BluetoothTarget
  setBtDevice: (device: BluetoothTarget) => Promise<void>
  // TODO: Mai — subscribe to `userLevelState` for level-up animations and progress bar UI
  userLevelState: GamificationLevel
}

type UserPatch = Partial<AppUser>

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
  const [userLevelState, setUserLevelState] = useState<GamificationLevel>(() => levelDisplay(1))

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

  // Filtered trips based on lastClearedHistory
  const filteredTrips = useMemo(() => {
    if (!user?.lastClearedHistory) return recentTrips;
    const cutoff = new Date(user.lastClearedHistory).getTime();
    return recentTrips.filter(trip => new Date(trip.startTime).getTime() > cutoff);
  }, [recentTrips, user?.lastClearedHistory]);

  // TripValidationManager (30s-start/3min-end/fraud rules) is CARMA-specific business
  // logic — the SDK itself only ships a trivial default. This is the app "wrapping"
  // the generic library with its own trip-validation rules, per the driving-sdk
  // boundary: nothing CARMA-specific lives inside src/lib/driving-sdk/ itself.
  const sdk = useMemo(() => new DrivingSDK({ tripValidator: new TripValidationManager() }), []);
  const tripRef = useRef(tripState)
  useEffect(() => { tripRef.current = tripState; }, [tripState])
  // Raw TripData from the SDK's onTripEnd callback — holds waypoints and events with locations
  const lastTripDataRef = useRef<TripData | null>(null);

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
      setTripState(INITIAL_TRIP_STATE);
      return finalState;
    }

    const tripStartTime = finalState.startTime?.toISOString()
      ?? new Date(Date.now() - finalState.durationSeconds * 1000).toISOString();
    const endTime = new Date().toISOString();

    // RFC-001 v1.5: build and sign raw-sensor digest — no score params, server scores authoritatively.
    // Signing failure must never block the trip from being saved (payload sent unsigned as fallback).
    let telemetryDigest:  TelemetryDigest | undefined;
    let payloadSignature: string | undefined;
    try {
      telemetryDigest  = buildTelemetryDigest(
        finalState, tripStartTime, endTime,
        lastTripDataRef.current?.accelAvailable,
        lastTripDataRef.current?.accelInitFailed,
        lastTripDataRef.current?.accelCoverage,
      );
      payloadSignature = signTelemetryDigest(telemetryDigest);
    } catch (sigErr) {
      console.error('[AppContext] Digest signing failed — payload sent unsigned', sigErr);
    }

    const validTripPayload: ValidTripPayload = {
      localTripId: finalState.sessionId,
      startTime: tripStartTime,
      endTime,
      distanceKm: finalState.distanceKm,
      durationSeconds: finalState.durationSeconds,
      avgScore: 0,        // server computes — placeholder only
      points: 0,          // server computes — placeholder only
      hardBrakes: finalState.eventCounts.HARD_BRAKE,
      aggressiveAccels: finalState.eventCounts.AGGRESSIVE_ACCEL,
      sharpTurns: finalState.eventCounts.SHARP_TURN,
      touchEpochs: finalState.touchEpochs,
      screenInteractionSeconds: finalState.screenInteractionSeconds,
      penalties: 0,         // server computes — placeholder only
      accelAvailable: lastTripDataRef.current?.accelAvailable,
      accelInitFailed: lastTripDataRef.current?.accelInitFailed,
      accelCoverage: lastTripDataRef.current?.accelCoverage,
      telemetryDigest,
      payloadSignature,
      routeWaypoints: lastTripDataRef.current?.waypoints,
      events: lastTripDataRef.current?.events?.map(e => ({
        type: e.type,
        timestamp: e.timestamp.toISOString(),
        severity: e.severity,
        speedKmh: e.speedKmh,
        location: e.location,
        peakLongitudinalG: e.peakLongitudinalG,
        peakLateralG: e.peakLateralG,
        durationMs: e.durationMs,
      })),
    };

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
      setTripState(INITIAL_TRIP_STATE);
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
      ? { ...savedTrip, score: savedTrip.avgScore }
      : {
          id: finalState.sessionId,
          userId: user?.id || 'guest',
          startTime: tripStartTime,
          endTime,
          distanceKm: finalState.distanceKm,
          durationSeconds: finalState.durationSeconds,
          avgScore: serverScore,
          score: serverScore,
          points: earnedPoints,
          hardBrakes: finalState.eventCounts.HARD_BRAKE,
          aggressiveAccels: finalState.eventCounts.AGGRESSIVE_ACCEL,
          sharpTurns: finalState.eventCounts.SHARP_TURN,
          touchEpochs: finalState.touchEpochs,
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
        };

    const existingTripsJson = await AsyncStorage.getItem('carma_trips');
    const existingTrips = existingTripsJson ? JSON.parse(existingTripsJson) : [];
    const updatedTrips = [newTrip, ...existingTrips.filter((t: Trip) => t.id !== newTrip.id)].slice(0, 10);
    setRecentTrips(updatedTrips);
    await AsyncStorage.setItem('carma_trips', JSON.stringify(updatedTrips));

    if (user) {
      // Single source of truth: prefer totalPoints (persisted accumulator), fall back to points
      const currentPoints = user.totalPoints ?? user.points ?? 0;
      const newTotalPoints = currentPoints + earnedPoints;
      // The server resolved the level when it saved the trip — including the
      // driver-score cap, which no amount of local arithmetic can reproduce
      // (#37). Only fall back to a points lookup if the save never landed.
      const newLevel = savedTrip?.userLevel ?? getLevelByPoints(newTotalPoints);

      const levelChange = detectLevelChange(user.level ?? newLevel, newLevel);
      if (levelChange) {
        const direction = levelChange.to > levelChange.from ? 'LEVEL_UP' : 'LEVEL_DOWN';
        console.log(`[Gamification] ${direction}: ${levelChange.from} -> ${levelChange.to}`);
      }
      setUserLevelState(levelDisplay(newLevel));

      // Totals are re-derived from the state at write time, not from the `user` this
      // callback closed over: saving the trip is a round trip to the server, and a
      // settings change made while it ran would otherwise be rolled back here.
      patchUser(prev => {
        const earnedFrom = prev.totalPoints ?? prev.points ?? 0;
        return {
          points: earnedFrom + earnedPoints,       // spec field (5.3.1.1)
          totalPoints: earnedFrom + earnedPoints,  // Dashboard/Profile UI reads this
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
    lastTripDataRef.current = null;
    setTripState(INITIAL_TRIP_STATE);
    return finalState;
  }, [user, addToast, lang]);

  useSdkBindings({ sdk, setTripState, tripRef, lastTripDataRef, onTripEnded: processEndTrip });
  useScoringEvents(sdk, setTripState);
  useFraudBinding(sdk, user, setTripState);
  useRegionBinding(sdk, setTripState, addToast, lang);

  // ─── SyncManager: replace local-only trip with server trip after offline sync ──
  useEffect(() => {
    SyncManager.onTripSynced = (localId: string, serverTrip: Trip) => {
      setRecentTrips(prev => {
        const updated = prev.map(t =>
          t.id === localId ? { ...serverTrip, score: serverTrip.avgScore } : t
        );
        AsyncStorage.setItem('carma_trips', JSON.stringify(updated));
        return updated;
      });
      // Re-fetch authoritative user totals so points/level reflect the committed trip.
      // Handles the app-restart-then-sync case where loadInitialData ran before the
      // queue was flushed and therefore fetched stale server totals.
      authApi.me().then(freshUser => {
        patchUser(freshUser);
        setUserLevelState(levelDisplay(freshUser.level ?? 1));
      }).catch(() => {});
    };
  }, [patchUser]);

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
      const serverOnline = await pingServer();
      try {
        const [l, u, t, btId, btName, token, levelsRes] = await Promise.all([
          AsyncStorage.getItem('carma_lang'),
          AsyncStorage.getItem('carma_user'),
          AsyncStorage.getItem('carma_trips'),
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

        if (u && token) {
          // Saved token found — validate against server and refresh data
          try {
            const freshUser = await authApi.me();
            const merged = { ...JSON.parse(u), ...freshUser };
            if (!merged.level) merged.level = getLevelByPoints(merged.totalPoints || 0);
            setUserState(merged);
            setUserLevelState(levelDisplay(merged.level ?? 1));
            await AsyncStorage.setItem('carma_user', JSON.stringify(merged));

            const serverData = await tripsApi.list();
            setRecentTrips(serverData.trips);
            await AsyncStorage.setItem('carma_trips', JSON.stringify(serverData.trips));
          } catch {
            // Invalid token — clear storage and redirect to login
            await AsyncStorage.multiRemove(['carma_user', 'carma_token', 'carma_trips']);
            setUserState(null);
            setRecentTrips([]);
          }
        } else if (t) {
          setRecentTrips(JSON.parse(t));
        }
        SyncManager.flushQueue().catch(() => {});
      } catch (e) {
        console.error('Error loading initial data', e);
      } finally {
        setIsLoading(false)
      }
    }
    loadInitialData()
  }, [sdk, addToast])

  const startTrip = useCallback(async () => {
    // TODO: GPS Logic - After first GPS sample, perform reverse geocoding to identify
    // current city/country, then update user state locally.
    const now = new Date();
    const sessionId = `trip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await sdk.startTrip();
    setTripState({ ...INITIAL_TRIP_STATE, isActive: true, startTime: now, sessionId });
  }, [sdk]);

  const endTrip = useCallback(async () => {
    await sdk.stopTrip();
    return tripRef.current;
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
    if (!u) {
      setUserState(null);
      setRecentTrips([]);
      await AsyncStorage.removeItem('carma_user');
      await AsyncStorage.removeItem('carma_token');
    } else {
      setUserState(u);
      setUserLevelState(levelDisplay(u.level ?? 1));
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
    try {
      const serverData = await tripsApi.list();
      setRecentTrips(serverData.trips);
      await AsyncStorage.setItem('carma_trips', JSON.stringify(serverData.trips));
    } catch {
      const cached = await AsyncStorage.getItem('carma_trips');
      if (cached) setRecentTrips(JSON.parse(cached));
    }
  }, [setUser]);

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
    (scenario: string, platform: string) => sdk.startRawRecording(scenario, platform),
    [sdk]
  );
  const stopRawRecording = useCallback(() => sdk.stopRawRecording(), [sdk]);
  const exportRawRecording = useCallback(() => sdk.exportRawRecording(), [sdk]);

  const clearTripHistory = useCallback(async () => {
    try {
      const now = new Date().toISOString();
      if (user) {
        const updatedUser = { ...user, lastClearedHistory: now };
        setUserState(updatedUser);
        await AsyncStorage.setItem('carma_user', JSON.stringify(updatedUser));
      }

      const tr = lang === 'HE' ? he : en;
      addToast({
        title: tr.common.historyCleared,
        message: tr.common.historyClearedDesc,
        type: 'success'
      });
    } catch (e) {
      console.error('Failed to clear history', e);
    }
  }, [lang, addToast, user]);

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
      clearTripHistory,
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
