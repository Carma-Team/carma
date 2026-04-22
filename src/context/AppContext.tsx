import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, AppStateStatus } from 'react-native'
import { useSegments } from 'expo-router'
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
  simulateBTConnect: () => void
  simulateBTDisconnect: () => void
  lastTripSummary: any | null
  setLastTripSummary: (v: any | null) => void
  startTrip: () => Promise<void>
  registerPhoneTouch: () => void
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

  // נשתמש ב-segments לזיהוי מעבר טאבים
  const segments = useSegments()
  const lastSegmentRef = useRef('')

  const sdk = useMemo(() => new CarmaDrivingSDK(), []);
  const tripRef = useRef(tripState)
  useEffect(() => { tripRef.current = tripState; }, [tripState])

  const lastTouchTimeRef = useRef(0);

  const registerPhoneTouch = useCallback(() => {
    const now = Date.now();
    // מניעת כפילויות - אם עברה פחות משנייה מאז הנגיעה האחרונה, אל תספור שוב
    if (tripRef.current.isActive && now - lastTouchTimeRef.current > 1000) {
      lastTouchTimeRef.current = now;
      console.log('[AppContext] Registering phone touch (throttled)');
      setTripState(prev => ({
        ...prev,
        eventCounts: {
          ...prev.eventCounts,
          PHONE_TOUCH: prev.eventCounts.PHONE_TOUCH + 1
        }
      }));
    }
  }, []);

  // זיהוי מעבר בין טאבים בתוך האפליקציה
  useEffect(() => {
    if (!segments) return;
    const currentPath = segments.join('/');

    // אם הנסיעה פעילה והנתיב השתנה
    if (tripState.isActive && lastSegmentRef.current && currentPath !== lastSegmentRef.current) {
      console.log(`[AppContext] Tab change detected: ${lastSegmentRef.current} -> ${currentPath}`);

      // לא סופרים אם חזרנו למסך הנסיעה
      if (!currentPath.includes('ActiveTripScreen')) {
        registerPhoneTouch();
      }
    }
    lastSegmentRef.current = currentPath;
  }, [segments, tripState.isActive, registerPhoneTouch]);

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
        registerPhoneTouch();
      }
    };

    sdk.onTripEnd = () => {
      if (tripRef.current.isActive) {
        processEndTrip();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [sdk, registerPhoneTouch]);

  const processEndTrip = useCallback(async () => {
    const finalState = { ...tripRef.current };

    // אם הנסיעה הייתה קצרה מדי (פחות מ-100 מטר), לא נשמור אותה
    if (finalState.distanceKm < 0.1) {
      console.log('[AppContext] Trip too short, skipping save');
      setLastTripSummary({ isTooShort: true });
      setTripState(INITIAL_TRIP_STATE);
      return finalState;
    }

    const earnedPoints = Math.round(finalState.distanceKm * 15) + 50;
    const score = Math.max(0, 100 - (finalState.eventCounts.HARD_BRAKE * 5) - (finalState.eventCounts.PHONE_TOUCH * 10));

    const newTrip: Trip = {
      id: `trip_${Date.now()}`,
      date: new Date().toISOString(),
      distance: finalState.distanceKm,
      duration: finalState.durationSeconds,
      score: score,
      points: earnedPoints,
      events: [] // כאן ניתן להוסיף את רשימת האירועים המפורטת אם ה-SDK תומך בכך
    };

    // === DB SYNC (TODO) ===
    // כאן תתבצע השליחה לבסיס הנתונים בעתיד:
    /*
    try {
      await api.saveTrip({
        userId: user.id,
        ...newTrip,
        harshBrakingCount: finalState.eventCounts.HARD_BRAKE,
        phoneUsageCount: finalState.eventCounts.PHONE_TOUCH,
        // וכו'...
      });
    } catch (e) {
      console.error('Failed to sync trip to DB', e);
      // מומלץ: לשמור מקומית ולנסות שוב כשיהיה אינטרנט
    }
    */
    // ======================

    const existingTripsJson = await AsyncStorage.getItem('carma_trips');
    const existingTrips = existingTripsJson ? JSON.parse(existingTripsJson) : [];
    const updatedTrips = [newTrip, ...existingTrips].slice(0, 10);
    setRecentTrips(updatedTrips);
    await AsyncStorage.setItem('carma_trips', JSON.stringify(updatedTrips));

    if (user) {
      const updatedUser = {
        ...user,
        totalPoints: user.totalPoints + earnedPoints,
        totalDistance: (user.totalDistance || 0) + finalState.distanceKm
      };
      setUserState(updatedUser);
      await AsyncStorage.setItem('carma_user', JSON.stringify(updatedUser));
    }

    setLastTripSummary({
      ...finalState,
      id: newTrip.id,
      score,
      points: earnedPoints
    });

    setTripState(INITIAL_TRIP_STATE);
    return finalState;
  }, [user]);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [l, u, t, btId] = await Promise.all([
          AsyncStorage.getItem('carma_lang'),
          AsyncStorage.getItem('carma_user'),
          AsyncStorage.getItem('carma_trips'),
          AsyncStorage.getItem('carma_bt_device_id')
        ])
        if (l === 'he' || l === 'en') setLangState(l)
        if (u) setUserState(JSON.parse(u))
        if (t) setRecentTrips(JSON.parse(t))
        if (btId) sdk.updateTargetDevice(btId)
      } finally {
        setIsLoading(false)
      }
    }
    loadInitialData()
  }, [])

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
    if (u) {
      // TODO: לשלוח עדכון לשרת אם פרטי המשתמש השתנו (למשל driveModeEnabled)
      await AsyncStorage.setItem('carma_user', JSON.stringify(u));
    } else {
      // TODO: לבצע קריאת API ל-Logout כדי לבטל את ה-Token בשרת
      await AsyncStorage.removeItem('carma_user');
      await AsyncStorage.removeItem('carma_token');
    }
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
      tripState, startTrip, endTrip, recentTrips,
      simulateBTConnect, simulateBTDisconnect,
      lastTripSummary, setLastTripSummary, registerPhoneTouch,
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
