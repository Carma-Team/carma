/**
 * @file RtlRestartPrompt.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Lines up React Native's RTL flag with the chosen language and asks the driver to reopen the app.
 * The flag decides text alignment on iOS and only takes effect on the next launch, so this
 * both sets it and says so; a language that already matches the flag shows nothing.
 *
 * @description
 * The root view carries a `direction` style, which is a Yoga layout property — iOS
 * resolves text alignment from `I18nManager.isRTL` instead, and that flag is false
 * until something turns it on. Android reads direction per paragraph from the
 * characters, which is why Hebrew looks right there and not on iOS.
 *
 * The flag only applies from the next launch. Restarting the app for the driver would
 * mean a native dependency and a fresh build, so the alert asks them to reopen it —
 * once, and only on the launch where the two actually disagree.
 */
import { Alert, I18nManager } from 'react-native';
import type { TranslationMap } from '@/i18n/he';
import type { Language } from '@/types';

export function applyRtlAndPromptIfNeeded(lang: Language, tr: TranslationMap): void {
  const shouldBeRtl = lang === 'HE';
  if (I18nManager.isRTL === shouldBeRtl) return;

  I18nManager.forceRTL(shouldBeRtl);
  // No button list: the OS supplies its own dismiss button, already translated.
  Alert.alert(tr.common.restartRequired, tr.common.restartRequiredDesc);
}
