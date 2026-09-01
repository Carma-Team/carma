/**
 * Mock "business owner" account — a role=BUSINESS user, for manually confirming that
 * one lands in the driver app like anyone else (CAR-205). Login with
 * mock-business@carma.dev / mock. __DEV__-only, see ../registerMockNetwork.
 *
 * It answers no requests of its own: the business surface lives on the web now, and
 * everything this account needs is served by registerMockNetwork's shared defaults.
 */
import type { AppUser } from '@/types';
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

export const businessMockAccount: MockAccount = {
  email: EMAIL,
  password: 'mock',
  token: TOKEN,
  user,
};
