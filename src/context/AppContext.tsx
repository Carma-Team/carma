import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, AppStateStatus } from 'react-native'
import type { AppUser, Language, ToastMessage, Trip } from '@/navigation/types'
import { CarmaDrivingSDK, TripData, DrivingEventType } from '@/lib/driving-sdk'

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
  clearTripHistory: () => Promise<void>
  simulateBTConnect: () => void
  simulateBTDisconnect: () => void
  lastTripSummary: any | null
  setLastTripSummary: (v: any | null) => void
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

  const sdk = useMemo(() => new CarmaDrivingSDK(), []);
  const tripRef = useRef(tripState)
  useEffect(() => { tripRef.current = tripState; }, [tripState])

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

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (tripRef.current.isActive && nextAppState !== 'active') {
        setTripState(prev => ({
          ...prev,
          eventCounts: {
            ...prev.eventCounts,
            PHONE_TOUCH: prev.eventCounts.PHONE_TOUCH + 1
          }
        }));
      }
    };

    // Auto-end trip when SDK signals trip ended (e.g., Bluetooth disconnect)
    sdk.onTripEnd = (finalData) => {
      if (tripRef.current.isActive) {
        processEndTrip();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [sdk]);

  const processEndTrip = useCallback(async () => {
    const finalState = { ...tripRef.current };

    // 🚩 תשתית למניעת רמאויות: אם לא בוצע מרחק (פחות מ-10 מטר), מציגים הודעה מתאימה ולא שומרים
    if (finalState.distanceKm < 0.01) {
      console.log('[Trip] Distance too low, showing "No Movement" modal.');
      setLastTripSummary({ noMovement: true });
      setTripState(INITIAL_TRIP_STATE);
      return finalState;
    }

    // Calculate rewards
    const earnedPoints = Math.round(finalState.distanceKm * 15) + 50;
    const score = Math.max(0, 100 - (finalState.eventCounts.HARD_BRAKE * 5) - (finalState.eventCounts.PHONE_TOUCH * 10));

    // DATABASE MAPPING: matches 5.3.1.2 Trip Entity
    const newTrip: Trip = {
      id: `trip_${Date.now()}`,
      user_id: user?.id || 'guest-123',
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      avg_score: score,
      distance: finalState.distanceKm,
      events_array: [] // Future: store events from session
    };

    /**
     * EXPORT TO DATABASE (Future implementation):
     * await tripsApi.saveTrip(newTrip);
     */

    // Save locally for now (Mock behavior)
    const existingTripsJson = await AsyncStorage.getItem('carma_trips');
    const existingTrips = existingTripsJson ? JSON.parse(existingTripsJson) : [];
    const updatedTrips = [newTrip, ...existingTrips].slice(0, 10);
    setRecentTrips(updatedTrips);
    await AsyncStorage.setItem('carma_trips', JSON.stringify(updatedTrips));

    // Update user points (5.3.1.1 User.points)
    if (user) {
      const updatedUser = {
        ...user,
        points: (user.points || 0) + earnedPoints,
      };
      setUserState(updatedUser);
      await AsyncStorage.setItem('carma_user', JSON.stringify(updatedUser));
    }

    setLastTripSummary({
      ...finalState,
      score,
      points: earnedPoints
    });

    setTripState(INITIAL_TRIP_STATE);
    return finalState;
  }, [user]);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [l, u, t] = await Promise.all([
          AsyncStorage.getItem('carma_lang'),
          AsyncStorage.getItem('carma_user'),
          AsyncStorage.getItem('carma_trips')
        ])

        let loadedUser: AppUser | null = null;
        if (u) {
          loadedUser = JSON.parse(u);
          setUserState(loadedUser);
        }

        if (l === 'he' || l === 'en') setLangState(l)

        if (t) {
          const allTrips: Trip[] = JSON.parse(t);
          // 🚩 סינון: הצג רק נסיעות שבוצעו אחרי הניקוי האחרון
          if (loadedUser?.last_cleared_history) {
            const clearDate = new Date(loadedUser.last_cleared_history).getTime();
            setRecentTrips(allTrips.filter(trip =>
              new Date(trip.start_time || (trip as any).date).getTime() > clearDate
            ));
          } else {
            setRecentTrips(allTrips);
          }
        }
      } finally {
        setIsLoading(false)
      }
    }
    loadInitialData()
  }, [])

  const clearTripHistory = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    const updatedUser: AppUser = { ...user, last_cleared_history: now };

    // מעדכנים את ה-State ואת ה-Storage
    setUserState(updatedUser);
    await AsyncStorage.setItem('carma_user', JSON.stringify(updatedUser));

    // "מנקים" את התצוגה - מציגים רק מה שחדש ממעכשיו
    setRecentTrips([]);
    addToast({ type: 'success', message: 'היסטוריית הנסיעות נוקתה מהתצוגה' });
  }, [user, addToast]);

  const startTrip = useCallback(async () => {
    await sdk.startTrip();
    setTripState({ ...INITIAL_TRIP_STATE, isActive: true });
  }, [sdk]);

  const endTrip = useCallback(async () => {
    await sdk.stopTrip();
    return processEndTrip();
  }, [sdk, processEndTrip]);

  const setUser = useCallback(async (u: AppUser | null) => {
    setUserState(u);
    u ? await AsyncStorage.setItem('carma_user', JSON.stringify(u)) : await AsyncStorage.removeItem('carma_user');
  }, [])

  const setLang = useCallback(async (l: Language) => {
    setLangState(l);
    await AsyncStorage.setItem('carma_lang', l);
  }, [])

  const addToast = useCallback((t: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { ...t, id }])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.duration ?? 3500)
  }, [])

  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  const simulateBTConnect = useCallback(() => {
    sdk.simulateBluetoothConnection();
  }, [sdk]);

  const simulateBTDisconnect = useCallback(() => {
    sdk.simulateBluetoothDisconnection();
  }, [sdk]);

  return (
    <AppContext.Provider value={{
      user, setUser, lang, setLang, toasts, addToast, removeToast, isLoading, setIsLoading,
      tripState, startTrip, endTrip, recentTrips, clearTripHistory,
      simulateBTConnect, simulateBTDisconnect,
      lastTripSummary, setLastTripSummary
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
