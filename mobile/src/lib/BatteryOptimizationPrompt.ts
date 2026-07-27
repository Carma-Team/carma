/**
 * @fileoverview CARMA-specific nudge for the Android background-throttling risk — #17
 * @module lib/BatteryOptimizationPrompt
 *
 * @description
 * driving-sdk/PowerManagement exposes the generic platform check and the
 * settings-navigation action; this file owns the CARMA-specific decision of
 * when to ask and what to say. Shown once (persisted in AsyncStorage), the
 * first time a trip starts on Android.
 */
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBackgroundThrottlingRiskPlatform, openAppSystemSettings } from '@/lib/driving-sdk/PowerManagement';
import type { TranslationMap } from '@/i18n/he';

const SHOWN_KEY = 'carma_battery_optimization_prompt_shown';

export async function maybePromptBatteryOptimizationExemption(tr: TranslationMap): Promise<void> {
  if (!isBackgroundThrottlingRiskPlatform()) return;
  if (await AsyncStorage.getItem(SHOWN_KEY)) return;
  await AsyncStorage.setItem(SHOWN_KEY, '1');

  Alert.alert(
    tr.driving.batteryOptimizationTitle,
    tr.driving.batteryOptimizationMessage,
    [
      { text: tr.driving.batteryOptimizationNotNow, style: 'cancel' },
      { text: tr.driving.batteryOptimizationOpenSettings, onPress: () => { openAppSystemSettings(); } },
    ],
  );
}
