import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, AppStateStatus, InteractionManager } from 'react-native'
import type { AppUser, Language, ToastMessage, Trip } from '@/navigation/types'
import { DrivingSDK, TripData, DrivingEventType } from '@/lib/driving-sdk'
import { tripsApi } from '@/services/api/trips.api'
import { getUserLevelData } from '@/lib/constants'

export interface TripState {
  isActive: boolean;
  durationSeconds: number;
  distanceKm: number;
  currentSpeedKmH: number;
  eventCounts: {
    HARD_BRAKE: number;
    AGGRESSIVE_ACCEL: number;
    SHARP_TURN: number;
    PHONE_TOUCH: number;
  };
}

const INITIAL_TRIP_STATE: TripState = {
  isActive: false,
  durationSeconds: 0,
  distanceKm: 0,
  currentSpeedKmH: 0,
  eventCounts: { HARD_BRAKE: 0, AGGRESSIVE_ACCEL: 0, SHARP_TURN: 0, PHONE_TOUCH: 0 },
};

interface AppContextValue {
  user: AppUser | null
  setUser: (user: AppUser | null) => void
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
  sdk: typeof DrivingSDK
}

const AppContext = createContext<AppContextValue | null>(null)

import { useRouter } from 'expo-router'

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // ... rest of the state
  const [user, setUserState] = useState<AppUser | null>(null)
  const [lang, setLangState] = useState<Language>('he')
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [recentTrips, setRecentTrips] = useState<Trip[]>([])
  const [tripState, setTripState] = useState<TripState>(INITIAL_TRIP_STATE)
  const [lastTripSummary, setLastTripSummary] = useState<any | null>(null)

  // Filtered trips based on last_cleared_history
  const filteredTrips = useMemo(() => {
    if (!user?.last_cleared_history) return recentTrips;
    const cutoff = new Date(user.last_cleared_history).getTime();
    return recentTrips.filter(trip => {
      const tripStartTime = new Date(trip.start_time).getTime();
      return tripStartTime > cutoff;
    });
  }, [recentTrips, user?.last_cleared_history]);

  const sdk = DrivingSDK;
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

    const earnedPoints = Math.round(finalState.distanceKm * 15) + 50;
    const score = Math.max(0, 100 - (finalState.eventCounts.HARD_BRAKE * 5) - (finalState.eventCounts.PHONE_TOUCH * 10));

    try {
      // TODO: Future Sync - Ensure trip is sent to server along with identified city/country.
      await tripsApi.save({
        distance: finalState.distanceKm,
        avg_score: score,
        start_time: new Date(Date.now() - finalState.durationSeconds * 1000).toISOString(),
        end_time: new Date().toISOString(),
        events_array: []
      });
    } catch (e) {
      console.error('[AppContext] Failed to sync trip', e);
    }

    const newTrip: Trip = {
      id: `trip_${Date.now()}`,
      user_id: user?.id || 'guest',
      start_time: new Date(Date.now() - finalState.durationSeconds * 1000).toISOString(),
      end_time: new Date().toISOString(),
      distance: finalState.distanceKm,
      avg_score: score,
      score: score, // fallback for legacy components
      points: earnedPoints,
      events_array: [],
      events: [] // fallback for UI
    };

    const existingTripsJson = await AsyncStorage.getItem('carma_trips');
    const existingTrips = existingTripsJson ? JSON.parse(existingTripsJson) : [];
    const updatedTrips = [newTrip, ...existingTrips].slice(0, 10);
    setRecentTrips(updatedTrips);
    await AsyncStorage.setItem('carma_trips', JSON.stringify(updatedTrips));

    if (user) {
      const newTotalPoints = (user.totalPoints || 0) + earnedPoints;
      const { currentLevel } = getUserLevelData(newTotalPoints);

      const updatedUser = {
        ...user,
        points: (user.points || 0) + earnedPoints,
        totalPoints: newTotalPoints,
        totalDistance: (user.totalDistance || 0) + finalState.distanceKm,
        level: currentLevel
      };
      setUserState(updatedUser);
      await AsyncStorage.setItem('carma_user', JSON.stringify(updatedUser));
    }

    setLastTripSummary({ ...finalState, id: newTrip.id, score, points: earnedPoints });
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
        eventCounts: {
          HARD_BRAKE: data.events.filter(e => e.type === DrivingEventType.HARD_BRAKE).length,
          AGGRESSIVE_ACCEL: data.events.filter(e => e.type === DrivingEventType.AGGRESSIVE_ACCEL).length,
          SHARP_TURN: data.events.filter(e => e.type === DrivingEventType.SHARP_TURN).length,
          PHONE_TOUCH: prev.eventCounts.PHONE_TOUCH,
        }
      }));
    };

    sdk.onTripEnd = () => {
      if (tripRef.current.isActive) {
        processEndTrip();
      }
    };

    // ניווט אוטומטי ברגע שהבלוטוס מזוהה
    sdk.onAutoStart = () => {
      router.push('/(app)/active-trip');
      addToast({
        title: lang === 'he' ? 'נסיעה התחילה' : 'Trip Started',
        message: lang === 'he' ? 'זוהה חיבור בלוטוס לרכב' : 'Bluetooth connection detected',
        type: 'success'
      });
    };

    // האזנה להתחלה אוטומטית מה-SDK
    (sdk as any).onAutoStart = () => {
      router.push('/(app)/active-trip');
    };

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (tripRef.current.isActive && nextAppState !== 'active') {
        registerPhoneTouch();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [sdk, registerPhoneTouch, processEndTrip]);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [l, u, t, btId] = await Promise.all([
          AsyncStorage.getItem('carma_lang'),
          AsyncStorage.getItem('carma_user'),
          AsyncStorage.getItem('carma_trips'),
          AsyncStorage.getItem('carma_bt_device_id')
        ])
        if (l === 'he' || l === 'en') setLangState(l as Language)
        if (u) {
          const parsedUser = JSON.parse(u);
          if (!parsedUser.level) {
            const { currentLevel } = getUserLevelData(parsedUser.totalPoints || 0);
            parsedUser.level = currentLevel;
          }
          setUserState(parsedUser);
          // TODO: Future Sync - Fetch latest trips from API and merge with local state
        }
        if (t) setRecentTrips(JSON.parse(t))
        if (btId) sdk.updateTargetDevice(btId)
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
    await sdk.startTrip();
    setTripState({ ...INITIAL_TRIP_STATE, isActive: true });
  }, [sdk]);

  const endTrip = useCallback(async () => {
    await sdk.stopTrip();
    return tripRef.current;
  }, [sdk]);

  const setUser = useCallback(async (u: AppUser | null) => {
    if (!u) {
      // Logout Logic:
      // If user is admin, we keep carma_trips in storage so they reappear on next login
      // but we clear the current state and remove the user (including the cutoff date).
      setUserState(null);
      setRecentTrips([]);
      await AsyncStorage.removeItem('carma_user');
      await AsyncStorage.removeItem('carma_token');
    } else {
      // Login Logic:
      setUserState(u);
      await AsyncStorage.setItem('carma_user', JSON.stringify(u));

      // Load trips immediately on login to sync with the new user context
      const t = await AsyncStorage.getItem('carma_trips');
      if (t) setRecentTrips(JSON.parse(t));
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
        const updatedUser = { ...user, last_cleared_history: now };
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
      user, setUser, lang, setLang, toasts, addToast, removeToast, isLoading, setIsLoading,
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
