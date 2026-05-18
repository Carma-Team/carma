/**
 * @fileoverview מנהל המצב הגלובלי של האפליקציה — AppContext
 * @module context/AppContext
 *
 * @description
 * Context מרכזי שמנהל את כל ה-state הגלובלי:
 * - **משתמש**: טעינה מ-AsyncStorage, refresh מהשרת בהתחברות, logout
 * - **נסיעה**: `processEndTrip` — חישוב ציון, שמירה לשרת, עדכון נקודות/רמה
 * - **רשימת נסיעות**: sync עם שרת בהתחברות, שמירה ל-AsyncStorage
 * - **UI**: toasts, שפה, loading state
 * - **SDK**: האזנה ל-callbacks של CarmaDrivingSDK
 *
 * @server
 * - `authApi.me()` — GET /api/auth/me — רענון פרטי משתמש בהפעלה
 * - `tripsApi.list()` — GET /api/trips — sync נסיעות בהתחברות
 * - `tripsApi.save()` — POST /api/trips — שמירת נסיעה שהסתיימה
 * - USE_REAL_SERVER=false: כל הקריאות מיורטות ב-client.ts (mock)
 * - USE_REAL_SERVER=true: קריאות לשרת האמיתי של נווה
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { InteractionManager } from 'react-native'
import { calculateScore } from '@/lib/scoring'
import type { AppUser, Language, ToastMessage, Trip } from '@/types'
import type { AuthResponse } from '@/services/api/auth.api'
import { CarmaDrivingSDK, TripData, DrivingEventType } from '@/lib/driving-sdk'
import type { FraudDetectedEvent } from '@/lib/driving-sdk/types'
import { tripsApi } from '@/services/api/trips.api'
import { authApi } from '@/services/api/auth.api'
import { levelsApi } from '@/services/api/levels.api'
import { fraudApi } from '@/services/api/fraud.api'
import { getLevelByPoints, setLevels } from '@/lib/constants'

export interface TripState {
  isActive: boolean;
  startTime: Date | null;
  durationSeconds: number;
  distanceKm: number;
  currentSpeedKmH: number;
  phoneSeconds: number;
  eventCounts: {
    HARD_BRAKE: number;
    AGGRESSIVE_ACCEL: number;
    SHARP_TURN: number;
    PHONE_TOUCH: number; // UI display only — not used for scoring
  };
}

const INITIAL_TRIP_STATE: TripState = {
  isActive: false,
  startTime: null,
  durationSeconds: 0,
  distanceKm: 0,
  currentSpeedKmH: 0,
  phoneSeconds: 0,
  eventCounts: { HARD_BRAKE: 0, AGGRESSIVE_ACCEL: 0, SHARP_TURN: 0, PHONE_TOUCH: 0 },
};

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
  setIsLoading: (v: boolean) => void
  tripState: TripState
  endTrip: () => Promise<TripState>
  recentTrips: Trip[]
  simulateBTConnect: () => void
  simulateBTDisconnect: () => void
  lastTripSummary: any | null
  setLastTripSummary: (v: any | null) => void
  startTrip: () => Promise<void>
  registerPhoneTouch: () => void
  debugAddDistance: (km: number) => void
  clearTripHistory: () => Promise<void>
  sdk: CarmaDrivingSDK
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AppUser | null>(null)
  const [lang, setLangState] = useState<Language>('he')
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [recentTrips, setRecentTrips] = useState<Trip[]>([])
  const [tripState, setTripState] = useState<TripState>(INITIAL_TRIP_STATE)
  const [lastTripSummary, setLastTripSummary] = useState<any | null>(null)

  // Filtered trips based on lastClearedHistory
  const filteredTrips = useMemo(() => {
    if (!user?.lastClearedHistory) return recentTrips;
    const cutoff = new Date(user.lastClearedHistory).getTime();
    return recentTrips.filter(trip => new Date(trip.startTime).getTime() > cutoff);
  }, [recentTrips, user?.lastClearedHistory]);

  const sdk = useMemo(() => new CarmaDrivingSDK(), []);
  const tripRef = useRef(tripState)
  useEffect(() => { tripRef.current = tripState; }, [tripState])

  const lastTouchTimeRef = useRef(0);

  const addToast = useCallback((t: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { ...t, id }])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.duration ?? 3500)
  }, [])

  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  const registerPhoneTouch = useCallback(() => {
    const now = Date.now();
    if (tripRef.current.isActive && now - lastTouchTimeRef.current > 1000) {
      lastTouchTimeRef.current = now;
      InteractionManager.runAfterInteractions(() => {
        setTripState(prev => ({
          ...prev,
          eventCounts: {
            ...prev.eventCounts,
            PHONE_TOUCH: prev.eventCounts.PHONE_TOUCH + 1
          }
        }));
      });
    }
  }, []);

  const processEndTrip = useCallback(async () => {
    const finalState = { ...tripRef.current };
    if (!finalState.isActive) return null;

    if (finalState.distanceKm < 0.1) {
      setLastTripSummary({ isTooShort: true });
      setTripState(INITIAL_TRIP_STATE);
      return finalState;
    }

    const scoringResult = calculateScore({
      hardBrakes: finalState.eventCounts.HARD_BRAKE,
      aggressiveAccels: finalState.eventCounts.AGGRESSIVE_ACCEL,
      sharpTurns: finalState.eventCounts.SHARP_TURN,
      phoneSeconds: finalState.phoneSeconds,
      durationSeconds: finalState.durationSeconds,
      distanceKm: finalState.distanceKm,
      startTime: finalState.startTime ?? new Date(),
    });

    const score = scoringResult.score;
    const earnedPoints = Math.round(scoringResult.points);
    const tripStartTime = finalState.startTime?.toISOString()
      ?? new Date(Date.now() - finalState.durationSeconds * 1000).toISOString();

    let savedTrip: Trip | null = null;
    try {
      // TODO: Future Sync - Ensure trip is sent to server along with identified city/country.
      savedTrip = await tripsApi.save({
        distanceKm: finalState.distanceKm,
        avgScore: score,
        durationSeconds: finalState.durationSeconds,
        startTime: tripStartTime,
        endTime: new Date().toISOString(),
        points: earnedPoints,
        hardBrakes: finalState.eventCounts.HARD_BRAKE,
        aggressiveAccels: finalState.eventCounts.AGGRESSIVE_ACCEL,
        sharpTurns: finalState.eventCounts.SHARP_TURN,
        phoneSeconds: Math.round(finalState.phoneSeconds),
      });
    } catch (e) {
      console.error('[AppContext] Failed to sync trip', e);
    }

    const newTrip: Trip = savedTrip
      ? { ...savedTrip, score }
      : {
          id: `trip_${Date.now()}`,
          userId: user?.id || 'guest',
          startTime: tripStartTime,
          endTime: new Date().toISOString(),
          distanceKm: finalState.distanceKm,
          durationSeconds: finalState.durationSeconds,
          avgScore: score,
          score,
          points: earnedPoints,
          hardBrakes: finalState.eventCounts.HARD_BRAKE,
          aggressiveAccels: finalState.eventCounts.AGGRESSIVE_ACCEL,
          sharpTurns: finalState.eventCounts.SHARP_TURN,
          phoneSeconds: Math.round(finalState.phoneSeconds),
          riskMultiplier: scoringResult.riskMultiplier,
          status: 'completed',
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
      const newLevel = getLevelByPoints(newTotalPoints);

      const updatedUser = {
        ...user,
        points: newTotalPoints,       // spec field (5.3.1.1) + Marketplace reads this
        totalPoints: newTotalPoints,  // Dashboard/Profile UI reads this
        totalDistance: (user.totalDistance || 0) + finalState.distanceKm,
        level: newLevel
      };
      setUserState(updatedUser);
      await AsyncStorage.setItem('carma_user', JSON.stringify(updatedUser));
    }

    setLastTripSummary({
      ...finalState,
      id: newTrip.id,
      score,
      points: earnedPoints,
      riskMultiplier: scoringResult.riskMultiplier,
      penalties: scoringResult.penalties,
    });
    setTripState(INITIAL_TRIP_STATE);
    return finalState;
  }, [user]);

  useEffect(() => {
    sdk.onUpdate = (data: TripData) => {
      setTripState(prev => ({
        ...prev,
        isActive: true,
        durationSeconds: data.durationSeconds,
        distanceKm: data.distanceKm,
        phoneSeconds: data.phoneSeconds,
        eventCounts: {
          HARD_BRAKE: data.events.filter(e => e.type === DrivingEventType.HARD_BRAKE).length,
          AGGRESSIVE_ACCEL: data.events.filter(e => e.type === DrivingEventType.AGGRESSIVE_ACCEL).length,
          SHARP_TURN: data.events.filter(e => e.type === DrivingEventType.SHARP_TURN).length,
          PHONE_TOUCH: prev.eventCounts.PHONE_TOUCH, // UI display only, maintained by registerPhoneTouch
        }
      }));
    };

    sdk.onTripEnd = () => {
      if (tripRef.current.isActive) {
        processEndTrip();
      }
    };
  }, [sdk, processEndTrip]);

  // ─── Fraud Detection Handler ──────────────────────────────────────────────
  // Fires when TripValidationManager detects non-car transport (Rule 3).
  // SDK already aborted the session silently — our job here is state cleanup + server sync.
  useEffect(() => {
    sdk.onFraudDetected = (event: FraudDetectedEvent) => {
      // Discard any accumulated trip data — fraudulent sessions earn zero CARMA Points
      setTripState(INITIAL_TRIP_STATE);

      // TODO: Mai — implement "נסיעה בתחבורה ציבורית זוהתה" toast/modal component

      // Report to Sean's backend (non-blocking — failure must never affect the user flow)
      fraudApi.syncInvalidTrip({
        userId: user?.id ?? 'anonymous',
        timestamp: new Date().toISOString(),
        detectedMode: event.mode as 'TRAIN' | 'BUS' | 'UNKNOWN',
        fraudScore: event.confidence,
        telemetrySummary: {
          avgSpeed: event.telemetry.avgSpeedKmh,
          maxLateralAccel: event.telemetry.maxLateralAccelG,
          gyroVariance: event.telemetry.yawVariance,
        },
        durationMs: event.durationMs,
        maxSpeedKmh: event.maxSpeedKmh,
      }).catch(() => {});
    };
  }, [sdk, user]);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [l, u, t, btId, token, levelsRes] = await Promise.all([
          AsyncStorage.getItem('carma_lang'),
          AsyncStorage.getItem('carma_user'),
          AsyncStorage.getItem('carma_trips'),
          AsyncStorage.getItem('carma_bt_device_id'),
          AsyncStorage.getItem('carma_token'),
          levelsApi.list().catch(() => null),
        ])
        if (levelsRes?.levels?.length) setLevels(levelsRes.levels);
        if (l === 'he' || l === 'en') setLangState(l as Language)
        if (btId) sdk.updateTargetDevice(btId)

        if (u && token) {
          // יש token שמור — מאמת מול השרת ומרענן נתונים
          try {
            const freshUser = await authApi.me();
            const merged = { ...JSON.parse(u), ...freshUser };
            if (!merged.level) merged.level = getLevelByPoints(merged.totalPoints || 0);
            setUserState(merged);
            await AsyncStorage.setItem('carma_user', JSON.stringify(merged));

            const serverData = await tripsApi.list();
            setRecentTrips(serverData.trips);
            await AsyncStorage.setItem('carma_trips', JSON.stringify(serverData.trips));
          } catch {
            // טוקן לא תקף — ניקוי ומעבר ל-login
            await AsyncStorage.multiRemove(['carma_user', 'carma_token', 'carma_trips']);
            setUserState(null);
            setRecentTrips([]);
          }
        } else if (t) {
          setRecentTrips(JSON.parse(t));
        }
      } catch (e) {
        console.error('Error loading initial data', e);
      } finally {
        setIsLoading(false)
      }
    }
    loadInitialData()
  }, [sdk])

  const startTrip = useCallback(async () => {
    // TODO: GPS Logic - After first GPS sample, perform reverse geocoding to identify
    // current city/country, then update user state locally.
    const now = new Date();
    await sdk.startTrip();
    setTripState({ ...INITIAL_TRIP_STATE, isActive: true, startTime: now });
  }, [sdk]);

  const endTrip = useCallback(async () => {
    await sdk.stopTrip();
    return tripRef.current;
  }, [sdk]);

  const loginUser = useCallback(async (data: AuthResponse) => {
    await AsyncStorage.setItem('carma_token', data.token);
    await setUser(data.user);
  }, []);

  const setUser = useCallback(async (u: AppUser | null) => {
    if (!u) {
      setUserState(null);
      setRecentTrips([]);
      await AsyncStorage.removeItem('carma_user');
      await AsyncStorage.removeItem('carma_token');
    } else {
      setUserState(u);
      await AsyncStorage.setItem('carma_user', JSON.stringify(u));

      // Load trips immediately on login to sync with the new user context
      try {
        const serverData = await tripsApi.list();
        setRecentTrips(serverData.trips);
        await AsyncStorage.setItem('carma_trips', JSON.stringify(serverData.trips));
      } catch {
        const cached = await AsyncStorage.getItem('carma_trips');
        if (cached) setRecentTrips(JSON.parse(cached));
      }
    }
  }, [user]);

  const setLang = useCallback(async (l: Language) => {
    setLangState(l);
    await AsyncStorage.setItem('carma_lang', l);
  }, [])

  const simulateBTConnect = useCallback(() => sdk.simulateBluetoothConnection(), [sdk]);
  const simulateBTDisconnect = useCallback(() => sdk.simulateBluetoothDisconnection(), [sdk]);

  const debugAddDistance = useCallback((km: number) => {
    sdk.debugAddDistance(km);
  }, [sdk]);

  const clearTripHistory = useCallback(async () => {
    try {
      const now = new Date().toISOString();
      if (user) {
        const updatedUser = { ...user, lastClearedHistory: now };
        setUserState(updatedUser);
        await AsyncStorage.setItem('carma_user', JSON.stringify(updatedUser));
      }

      addToast({
        title: lang === 'he' ? 'ההיסטוריה נמחקה' : 'History Cleared',
        message: lang === 'he' ? 'היסטוריית הנסיעות הוסתרה' : 'Trip history has been hidden',
        type: 'success'
      });
    } catch (e) {
      console.error('Failed to clear history', e);
    }
  }, [lang, addToast, user]);

  return (
    <AppContext.Provider value={{
      user, setUser, loginUser, lang, setLang, toasts, addToast, removeToast, isLoading, setIsLoading,
      tripState, startTrip, endTrip,
      recentTrips: filteredTrips,
      simulateBTConnect, simulateBTDisconnect,
      lastTripSummary, setLastTripSummary, registerPhoneTouch,
      debugAddDistance,
      clearTripHistory,
      sdk
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
