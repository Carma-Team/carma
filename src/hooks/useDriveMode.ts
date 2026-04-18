import { useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { useTrip } from '@/hooks/useTrip';
import { Alert } from 'react-native';

/**
 * Hook לניהול מצב נסיעה אוטומטי מבוסס Bluetooth
 */
export function useDriveMode() {
  const { user, addToast } = useApp();
  const { state: tripState, startTrip, endTrip } = useTrip();
  const lastConnectedId = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.driveModeEnabled || !user?.bluetoothDeviceId) return;

    // כאן בדרך כלל נשתמש ב-BleManager.addListener
    // לצורך הדגמה, אנחנו נדמה זיהוי חיבור

    const checkConnection = async () => {
      // סימולציה של בדיקת חיבור
      // נניח שקיבלנו אירוע שהמכשיר התחבר/התנתק

      const isConnectedToCar = false; // כאן תבוא הבדיקה האמיתית מול ה-Bluetooth

      if (isConnectedToCar && !tripState.isActive) {
        addToast({
          type: 'info',
          message: `זוהה חיבור ל-${user.bluetoothDeviceName}. מתחיל נסיעה...`
        });
        await startTrip();
      }
      else if (!isConnectedToCar && tripState.isActive && lastConnectedId.current === user.bluetoothDeviceId) {
        addToast({
          type: 'info',
          message: 'ניתוק מהרכב זוהה. מסיים נסיעה...'
        });
        await endTrip();
        Alert.alert('נסיעה הסתיימה', 'המכשיר התנתק מהרכב. הנסיעה נשמרה בהצלחה.');
      }

      lastConnectedId.current = isConnectedToCar ? user.bluetoothDeviceId : null;
    };

    const interval = setInterval(checkConnection, 5000); // בדיקה כל 5 שניות בסימולציה
    return () => clearInterval(interval);
  }, [user?.driveModeEnabled, user?.bluetoothDeviceId, tripState.isActive]);
}
