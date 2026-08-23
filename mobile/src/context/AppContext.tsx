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
import { maybePromptBatteryOptimizationExemption } from '@/lib/BatteryOptimizationPrompt'
import { tripsApi } from '@/services/api/trips.api'
import { authApi } from '@/services/api/auth.api'
import { ApiError } from '@/services/api/client'
import { levelsApi } from '@/services/api/levels.api'
import { pingServer } from '@/services/api/health.api'
import { getLevelByPoints, setLevels } from '@/lib/constants'
import { fromLocalTrip, TOO_SHORT_SUMMARY, type TripSummary } from '@/lib/tripSummary'
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

export type { TripState } from './tripState'

// ─── RFC-001: Telemetry Digest + Payload Signing ─────────────────────────────
// Pure-JS HMAC-SHA256 (FIPS 198-1 / FIPS 180-4) — no native bridge, no packages.
// The key ships inside the app bundle, so a valid signature proves the payload came
// from a copy of the client, not from a trusted device. That limit is accepted
// deliberately — docs/fraud-detection.md, "What we accept losing"; attestation-
// provisioned keys are Stage 2 of its maturity path.
// The 'ph:' prefix marks the signature unverifiable. The server accepts it today;
// CAR-13 is the switch to rejecting it.

const SIGNING_KEY = 'CARMA-TRIP-HMAC-KEY-V1__REPLACE_VIA_APP_ATTESTATION';

// SHA-256 round constants: first 32 bits of the cube roots of the first 64 primes.
const _SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function _rotr32(n: number, d: number): number {
  return ((n >>> d) | (n << (32 - d))) >>> 0;
}

// UTF-8 encode a string to bytes (handles BMP characters; ASCII is the common case).
function _utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if      (c < 0x80)   { out.push(c); }
    else if (c < 0x800)  { out.push((c >> 6) | 0xc0, (c & 0x3f) | 0x80); }
    else                  { out.push((c >> 12) | 0xe0, ((c >> 6) & 0x3f) | 0x80, (c & 0x3f) | 0x80); }
  }
  return new Uint8Array(out);
}

// SHA-256 core — FIPS 180-4 §6.2.2. Returns a 32-byte digest.
function _sha256(data: Uint8Array): Uint8Array {
  // Initial hash values: first 32 bits of fractional parts of sqrt of first 8 primes.
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const byteLen = data.length;
  const bitLen  = byteLen * 8;
  // Pad: append 0x80, zero bytes, then 64-bit big-endian message length.
  const padLen = ((byteLen + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[byteLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let i = 0; i < padLen; i += 64) {
    // Prepare message schedule.
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = _rotr32(w[j-15], 7)  ^ _rotr32(w[j-15], 18) ^ (w[j-15] >>> 3);
      const s1 = _rotr32(w[j-2],  17) ^ _rotr32(w[j-2],  19) ^ (w[j-2]  >>> 10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
    }

    // Compression.
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], hh = H[7];
    for (let j = 0; j < 64; j++) {
      const S1  = _rotr32(e, 6)  ^ _rotr32(e, 11) ^ _rotr32(e, 25);
      const ch  = (e & f) ^ (~e & g);
      const t1  = (hh + S1 + ch + _SHA256_K[j] + w[j]) >>> 0;
      const S0  = _rotr32(a, 2)  ^ _rotr32(a, 13) ^ _rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2  = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d  + t1) >>> 0;
      d  = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+hh)>>>0;
  }

  const result = new Uint8Array(32);
  const rv = new DataView(result.buffer);
  H.forEach((v, i) => rv.setUint32(i * 4, v, false));
  return result;
}

// HMAC-SHA256 — FIPS 198-1. Returns lowercase hex string (64 chars).
function _hmacSha256Hex(key: string, message: string): string {
  const BLOCK = 64;
  let k = _utf8Bytes(key);
  if (k.length > BLOCK) k = _sha256(k);   // keys > block size are hashed first

  const kPad = new Uint8Array(BLOCK);      // zero-padded to block size
  kPad.set(k);

  const ipad = kPad.map(b => b ^ 0x36);
  const opad = kPad.map(b => b ^ 0x5c);

  const msg   = _utf8Bytes(message);
  const inner = new Uint8Array(BLOCK + msg.length);
  inner.set(ipad); inner.set(msg, BLOCK);

  const innerHash = _sha256(inner);
  const outer     = new Uint8Array(BLOCK + 32);
  outer.set(opad); outer.set(innerHash, BLOCK);

  return Array.from(_sha256(outer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
  accelAvailable: boolean,
  accelInitFailed: boolean,
): TelemetryDigest {
  return {
    distanceKm:               Math.round(state.distanceKm * 1000) / 1000,
    durationSeconds:          state.durationSeconds,
    hardBrakes:               state.eventCounts.HARD_BRAKE,
    aggressiveAccels:         state.eventCounts.AGGRESSIVE_ACCEL,
    sharpTurns:               state.eventCounts.SHARP_TURN,
    // swerves:               state.eventCounts.SWERVE,  // EVT_SWERVE disabled
    touchEpochs:              state.touchEpochs,
    screenInteractionSeconds: state.screenInteractionSeconds,
    startTime,
    endTime,
    timestamp:                Date.now(),
    accelAvailable,
    accelInitFailed,
  };
}

// Signs the digest with HMAC-SHA256. Canonical JSON (sorted keys) guarantees a
// deterministic byte sequence regardless of JS engine key-insertion order.
// 'ph:' prefix marks the signature unverifiable — accepted today, rejected under CAR-13.
function signTelemetryDigest(digest: TelemetryDigest): string {
  const canonical = JSON.stringify(digest, Object.keys(digest).sort() as (keyof TelemetryDigest)[]);
  const hmac = _hmacSha256Hex(SIGNING_KEY, canonical);
  return `ph:${hmac}`;
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
  loginUser: (data: AuthResponse) => Promise<void>
  lang: Language
  setLang: (lang: Language) => void
  toasts: ToastMessage[]
  addToast: (toast: Omit<ToastMessage, 'id'>) => void
  removeToast: (id: string) => void
  isLoading: boolean
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

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AppUser | null>(null)
  const [lang, setLangState] = useState<Language>('HE')
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [recentTrips, setRecentTrips] = useState<Trip[]>([])
  const [tripState, setTripState] = useState<TripState>(INITIAL_TRIP_STATE)
  const [lastTripSummary, setLastTripSummary] = useState<TripSummary | null>(null)
  const [btDevice, setBtDeviceState] = useState<BluetoothTarget>(null)
  const [userLevelState, setUserLevelState] = useState<GamificationLevel>(() => levelDisplay(1))

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
        lastTripDataRef.current?.accelAvailable ?? false,
        lastTripDataRef.current?.accelInitFailed ?? false,
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
      // swerves: finalState.eventCounts.SWERVE,  // EVT_SWERVE disabled
      touchEpochs: finalState.touchEpochs,
      screenInteractionSeconds: finalState.screenInteractionSeconds,
      penalties: 0,         // server computes — placeholder only
      accelAvailable: lastTripDataRef.current?.accelAvailable,
      accelInitFailed: lastTripDataRef.current?.accelInitFailed,
      telemetryDigest,
      payloadSignature,
      routeWaypoints: lastTripDataRef.current?.waypoints,
      events: lastTripDataRef.current?.events?.map(e => ({
        type: e.type,
        timestamp: e.timestamp.toISOString(),
        severity: e.severity,
        speedKmh: e.speedKmh,
        location: e.location,
        peakG: e.peakG,
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
          // swerves: finalState.eventCounts.SWERVE,  // EVT_SWERVE disabled
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

      const updatedUser = {
        ...user,
        points: newTotalPoints,       // spec field (5.3.1.1) + Marketplace reads this
        totalPoints: newTotalPoints,  // Dashboard/Profile UI reads this
        totalDistance: (user.totalDistance || 0) + finalState.distanceKm,
        level: newLevel
      };
      setUserState(updatedUser);
      // Non-blocking — a storage failure must never leave the trip stuck in "active" state (D-CTX-2).
      AsyncStorage.setItem('carma_user', JSON.stringify(updatedUser)).catch(e =>
        console.error('[AppContext] Failed to persist user after trip end', e)
      );
    }

    setLastTripSummary(fromLocalTrip(newTrip.id, savedTrip, finalState, lastTripDataRef.current));
    lastTripDataRef.current = null;
    setTripState(INITIAL_TRIP_STATE);
    return finalState;
  }, [user, addToast, lang]);

  useSdkBindings({ sdk, setTripState, tripRef, lastTripDataRef, onTripEnded: processEndTrip });
  useScoringEvents(sdk, setTripState);
  useFraudBinding(sdk, user, setTripState);

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
        setUserState(prev => (prev ? { ...prev, ...freshUser } : null));
        setUserLevelState(levelDisplay(freshUser.level ?? 1));
        AsyncStorage.setItem('carma_user', JSON.stringify(freshUser)).catch(() => {});
      }).catch(() => {});
    };
  }, []);

  // ─── AppState: flush queued trips when app returns to foreground ──────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        SyncManager.flushQueue().catch(() => {});
      }
    });
    return () => sub.remove();
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
      user, setUser, loginUser, lang, setLang, toasts, addToast, removeToast, isLoading,
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
