/**
 * useDriveModeToggle — the drive-mode on/off handler, shared by SettingsScreen and
 * DashboardScreen so both buttons trigger the exact same admin-gated flow instead of
 * each screen implementing its own copy.
 *
 * Disabling is always allowed and persists immediately. Enabling always shows the
 * "feature not fully working yet" apology first — for non-admins the message is the
 * end of the road (feature stays off); admins get routed into the Bluetooth picker
 * after acknowledging it, so the mechanism can keep being tested while it's still
 * unreliable for real drivers.
 */
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isAdmin } from '@/lib/utils';
import { userApi } from '@/services/api/user.api';

export function useDriveModeToggle() {
  const router = useRouter();
  const { user, setUser } = useApp();
  const { t } = useTranslation();

  const handleDriveModeToggle = () => {
    if (!user) return;

    if (user.driveModeEnabled) {
      setUser({ ...user, driveModeEnabled: false });
      userApi.updateProfile({ driveModeEnabled: false }).catch(e =>
        console.error('[useDriveModeToggle] Failed to persist drive mode disable', e)
      );
      return;
    }

    Alert.alert(
      t('profile.driveModeUnavailableTitle'),
      t('profile.driveModeUnavailableMessage'),
      [
        {
          text: t('common.confirm'),
          onPress: () => {
            if (isAdmin(user)) {
              router.push({ pathname: '/(home)/bluetooth-settings', params: { activating: '1' } });
            }
          },
        },
      ],
      { cancelable: false }
    );
  };

  return { handleDriveModeToggle };
}
