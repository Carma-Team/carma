/**
 * Mock "business owner" account — for manually testing add/edit/delete of
 * rewards on-device without touching the real server. Login with
 * mock-business@carma.dev / mock. __DEV__-only, see ../registerMockNetwork.
 */
import type { AppUser, Reward } from '@/types';
import type { NewBusinessReward } from '@/services/api/business.api';
import type { MockAccount } from '../types';

const EMAIL = 'mock-business@carma.dev';
const TOKEN = 'MOCK::business';
const BUSINESS_ID = 'mock-business-id';

const user: AppUser = {
  id: 'mock-business-user',
  name: 'Mock Business',
  email: EMAIL,
  role: 'BUSINESS',
  language: 'HE',
  points: 0,
  totalPoints: 0,
  totalDistance: 0,
  level: 1,
  isPrivate: false,
  driveModeEnabled: false,
  businessId: BUSINESS_ID,
  businessCategory: 'other',
  createdAt: new Date().toISOString(),
};

let rewards: Reward[] = [
  {
    id: 'mock-reward-1', businessId: BUSINESS_ID, business: 'Mock Business', businessHe: 'עסק לדוגמה',
    titleHe: 'קפה חינם', titleEn: 'Free Coffee', descriptionHe: 'כוס קפה על הבית', descriptionEn: 'A coffee on us',
    category: 'food', costPoints: 100, imageIcon: 'cafe-outline', isActive: true,
    stock: 50, available: 50, expiresAt: null,
  },
  {
    id: 'mock-reward-2', businessId: BUSINESS_ID, business: 'Mock Business', businessHe: 'עסק לדוגמה',
    titleHe: 'הנחת דלק 10%', titleEn: '10% Fuel Discount', descriptionHe: 'הנחה בתדלוק הבא', descriptionEn: 'Discount on your next fill-up',
    category: 'fuel', costPoints: 300, imageIcon: 'car-outline', isActive: true,
    stock: null, available: null, expiresAt: null,
  },
];

function nextId() {
  return `mock-reward-${Date.now()}`;
}

function handleRequest(method: string, path: string, body: unknown): { status: number; data: unknown } | null {
  const cleanPath = path.split('?')[0];
  if (!cleanPath.includes('/api/business/rewards')) return null;

  const idMatch = cleanPath.match(/\/api\/business\/rewards\/([^/]+)$/);
  const id = idMatch?.[1];

  if (method === 'GET' && !id) {
    return { status: 200, data: { rewards } };
  }

  if (method === 'POST' && !id) {
    const payload = body as NewBusinessReward;
    const reward: Reward = {
      ...payload,
      id: nextId(),
      businessId: BUSINESS_ID,
      business: user.name ?? 'Mock Business',
      available: payload.stock,
    };
    rewards = [reward, ...rewards];
    return { status: 200, data: { reward } };
  }

  if (method === 'PATCH' && id) {
    const patch = body as Partial<NewBusinessReward>;
    rewards = rewards.map(r => (r.id === id ? { ...r, ...patch } : r));
    const reward = rewards.find(r => r.id === id);
    if (!reward) return { status: 404, data: { detail: 'Reward not found (mock)' } };
    return { status: 200, data: { reward } };
  }

  if (method === 'DELETE' && id) {
    rewards = rewards.filter(r => r.id !== id);
    return { status: 204, data: undefined };
  }

  return { status: 404, data: { detail: 'Unhandled mock request' } };
}

export const businessMockAccount: MockAccount = {
  email: EMAIL,
  password: 'mock',
  token: TOKEN,
  user,
  handleRequest,
};
