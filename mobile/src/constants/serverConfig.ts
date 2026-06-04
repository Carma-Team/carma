/**
 * SERVER CONFIGURATION
 * --------------------
 * USE_REAL_SERVER = false → Metro proxy → local mock server (port 3000)
 * USE_REAL_SERVER = true  → STAGING_SERVER_URL (set to local FastAPI IP for demo)
 *
 * DEMO DAY SETUP:
 *   1. Set USE_REAL_SERVER = true
 *   2. Set STAGING_SERVER_URL to the local FastAPI server IP, e.g. 'http://192.168.1.100:3000'
 */
import Constants from 'expo-constants';

export const USE_REAL_SERVER = true;

// Android emulator alias for host localhost — use 10.0.2.2 for emulator, real IP for physical device
export const STAGING_SERVER_URL = 'http://10.0.2.2:3000';

function getMetroOrigin(): string {
  // manifest2.launchAsset.url is the bundle URL in Expo Go SDK 46+
  // e.g. "https://abc--8081.exp.direct/.expo/..." in tunnel mode
  const launchUrl: string =
    (Constants as any).manifest2?.launchAsset?.url ?? '';
  if (launchUrl.startsWith('http')) {
    try {
      const { protocol, host } = new URL(launchUrl);
      console.log('[serverConfig] origin from manifest2.launchAsset:', `${protocol}//${host}`);
      return `${protocol}//${host}`;
    } catch {}
  }

  // hostUri: "192.168.x.x:8081" in LAN, "abc--8081.exp.direct" in tunnel (no port)
  const hostUri: string = Constants.expoConfig?.hostUri ?? '';
  console.log('[serverConfig] hostUri:', hostUri);
  if (hostUri) {
    const hasPort = /:\d+$/.test(hostUri);
    // LAN has explicit port → HTTP; tunnel uses HTTPS on standard port
    const origin = hasPort ? `http://${hostUri}` : `https://${hostUri}`;
    console.log('[serverConfig] origin from hostUri:', origin);
    return origin;
  }

  console.warn('[serverConfig] Could not detect Metro origin, falling back to localhost:8081');
  return 'http://localhost:8081';
}

export const LOCAL_SERVER_URL = USE_REAL_SERVER
  ? 'https://carma-api.example.com'
  : getMetroOrigin();
