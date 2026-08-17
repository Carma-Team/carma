/**
 * Mock "driver with a lot of points" account — for manually testing the
 * rewards store (redeeming, vouchers) without touching the real server or
 * grinding real points. Login with mock-driver@carma.dev / mock.
 * __DEV__-only, see ../registerMockNetwork.
 */
import type { AppUser, Reward, Voucher } from '@/types';
import type { MockAccount } from '../types';

const EMAIL = 'mock-driver@carma.dev';
const TOKEN = 'MOCK::driver';

const user: AppUser = {
  id: 'mock-driver-user',
  name: 'Mock Driver',
  email: EMAIL,
  role: 'DRIVER',
  language: 'HE',
  points: 999999,
  totalPoints: 999999,
  totalDistance: 12345,
  level: 10,
  isPrivate: false,
  driveModeEnabled: false,
  createdAt: new Date().toISOString(),
};

const rewards: Reward[] = [
  {
    id: 'mock-catalog-1', businessId: 'mock-business-id', business: 'Mock Business', businessHe: 'עסק לדוגמה',
    titleHe: 'שובר דלק 50 ש"ח', titleEn: '50₪ Fuel Voucher', descriptionHe: 'שובר לתדלוק', descriptionEn: 'A fuel voucher',
    category: 'fuel', costPoints: 500, imageIcon: 'car-outline', isActive: true,
    stock: null, available: null, expiresAt: null,
  },
  {
    id: 'mock-catalog-2', businessId: 'mock-business-id', business: 'Mock Business', businessHe: 'עסק לדוגמה',
    titleHe: 'כרטיס קולנוע', titleEn: 'Movie Ticket', descriptionHe: 'כרטיס לסרט', descriptionEn: 'One movie ticket',
    category: 'entertainment', costPoints: 800, imageIcon: 'film-outline', isActive: true,
    stock: 20, available: 20, expiresAt: null,
  },
];

let vouchers: Voucher[] = [];

function handleRequest(method: string, path: string, _body: unknown): { status: number; data: unknown } | null {
  const cleanPath = path.split('?')[0];

  if (method === 'GET' && cleanPath.endsWith('/api/rewards')) {
    return { status: 200, data: { rewards, vouchers } };
  }

  const redeemMatch = cleanPath.match(/\/api\/rewards\/([^/]+)\/redeem$/);
  if (method === 'POST' && redeemMatch) {
    const reward = rewards.find(r => r.id === redeemMatch[1]);
    if (!reward) return { status: 404, data: { detail: 'Reward not found (mock)' } };
    const voucher: Voucher = {
      id: `mock-voucher-${Date.now()}`,
      userId: user.id,
      rewardId: reward.id,
      code: Math.random().toString(36).slice(2, 8).toUpperCase(),
      qrData: `mock:${reward.id}`,
      status: 'pending',
      isUsed: false,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      redeemedAt: null,
      createdAt: new Date().toISOString(),
      reward,
    };
    vouchers = [voucher, ...vouchers];
    return { status: 200, data: { voucher } };
  }

  if (method === 'GET' && cleanPath.endsWith('/api/vouchers')) {
    return { status: 200, data: { vouchers } };
  }

  return null;
}

export const driverMockAccount: MockAccount = {
  email: EMAIL,
  password: 'mock',
  token: TOKEN,
  user,
  handleRequest,
};
