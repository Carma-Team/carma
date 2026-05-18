/**
 * @fileoverview Hook גישה מהירה לנסיעה — useTrip
 * @module hooks/useTrip
 *
 * @description
 * Proxy קל ל-AppContext שחושף רק את שדות הנסיעה:
 * `state` (TripState), `startTrip`, `endTrip`.
 * כל הלוגיקה האמיתית נמצאת ב-AppContext.processEndTrip.
 *
 * @remarks ללא קריאות שרת ישירות — ראה AppContext לשמירת נסיעה.
 */
import { useApp } from '@/context/AppContext';
export function useTrip() {
  const { tripState, startTrip, endTrip } = useApp();

  return {
    state: tripState,
    startTrip,
    endTrip
  };
}
