/**
 * SERVER CONFIGURATION
 * --------------------
 * In tunnel mode (npx expo start --tunnel), the app sends /api/* requests to
 * the Metro server tunnel URL. Metro's proxy middleware (metro.config.js)
 * forwards those requests to localhost:3000 on the computer.
 *
 * USE_REAL_SERVER = true  → Nave's real server
 * USE_REAL_SERVER = false → Metro proxy → local server (must be running on port 3000)
 */
import Constants from 'expo-constants';

export const USE_REAL_SERVER = false;

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
