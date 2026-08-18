/**
 * @file BatteryOptimizationPrompt.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief CARMA's nudge asking the driver to exempt the app from Android battery optimization (#17).
 * Wraps the generic platform check in `driving-sdk/PowerManagement` and decides when to ask,
 * what to say, and that it is asked only once.
 *
 * @description
 * driving-sdk/PowerManagement exposes the generic platform check and the
 * settings-navigation action; this file owns the CARMA-specific decision of
 * when to ask and what to say. Shown once (persisted in AsyncStorage), after
 * the first trip ends on Android — not on trip start, so it never interrupts
 * a driver who is mid-drive.
 */
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBackgroundThrottlingRiskPlatform, openAppSystemSettings } from '@/lib/driving-sdk/PowerManagement';
import type { TranslationMap } from '@/i18n/he';

const SHOWN_KEY = 'carma_battery_optimization_prompt_shown';

export async function maybePromptBatteryOptimizationExemption(tr: TranslationMap): Promise<void> {
  if (!isBackgroundThrottlingRiskPlatform()) return;
  if (await AsyncStorage.getItem(SHOWN_KEY)) return;

  Alert.alert(
    tr.driving.batteryOptimizationTitle,
    tr.driving.batteryOptimizationMessage,
    [
      { text: tr.driving.batteryOptimizationNotNow, style: 'cancel' },
      { text: tr.driving.batteryOptimizationOpenSettings, onPress: () => { openAppSystemSettings(); } },
    ],
  );

  // Written only after the Alert call above actually fires — an earlier write-before-show
  // meant a failure between the two calls would mark the nudge "shown" when the user never saw it.
  await AsyncStorage.setItem(SHOWN_KEY, '1');
}
