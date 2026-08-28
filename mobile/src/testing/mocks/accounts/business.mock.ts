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
  availablePoints: 0,
  reservedPoints: 0,
  totalDistance: 0,
  level: 1,
  isPrivate: false,
  driveModeEnabled: false,
  businessId: BUSINESS_ID,
  businessCategory: 'other',
  businessMembershipRole: 'OWNER',
  businessMembershipAmbiguous: false,
  createdAt: new Date().toISOString(),
};

let rewards: Reward[] = [
  {
    id: 'mock-reward-1', businessId: BUSINESS_ID, business: 'Mock Business', businessHe: 'עסק לדוגמה',
    titleHe: 'קפה חינם', titleEn: 'Free Coffee', descriptionHe: 'כוס קפה על הבית', descriptionEn: 'A coffee on us',
    category: 'food', costPoints: 100, imageIcon: 'cafe-outline', isActive: true, archivedAt: null,
    stock: 50, available: 50, expiresAt: null,
  },
  {
    id: 'mock-reward-2', businessId: BUSINESS_ID, business: 'Mock Business', businessHe: 'עסק לדוגמה',
    titleHe: 'הנחת דלק 10%', titleEn: '10% Fuel Discount', descriptionHe: 'הנחה בתדלוק הבא', descriptionEn: 'Discount on your next fill-up',
    category: 'fuel', costPoints: 300, imageIcon: 'car-outline', isActive: true, archivedAt: null,
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
    // NewBusinessReward leaves businessHe/titleEn/descriptionEn/expiresAt optional;
    // Reward (RewardOut) requires them present, just nullable — `?? null` bridges that.
    const reward: Reward = {
      ...payload,
      id: nextId(),
      businessId: BUSINESS_ID,
      business: user.name ?? 'Mock Business',
      businessHe: payload.businessHe ?? null,
      titleEn: payload.titleEn ?? null,
      descriptionEn: payload.descriptionEn ?? null,
      expiresAt: payload.expiresAt ?? null,
      archivedAt: null,
      available: payload.stock,
    };
    rewards = [reward, ...rewards];
    return { status: 200, data: { reward } };
  }

  if (method === 'PATCH' && id) {
    const patch = body as Partial<NewBusinessReward>;
    rewards = rewards.map((r): Reward => {
      if (r.id !== id) return r;
      // Same optional-vs-nullable bridging as POST above, keeping the field r already
      // had when patch didn't send it — an explicit object literal so TS checks each
      // field against Reward directly instead of inferring a spread's loose type.
      return {
        ...r,
        ...patch,
        businessHe: patch.businessHe !== undefined ? patch.businessHe ?? null : r.businessHe,
        titleEn: patch.titleEn !== undefined ? patch.titleEn ?? null : r.titleEn,
        descriptionEn: patch.descriptionEn !== undefined ? patch.descriptionEn ?? null : r.descriptionEn,
        expiresAt: patch.expiresAt !== undefined ? patch.expiresAt ?? null : r.expiresAt,
      };
    });
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
