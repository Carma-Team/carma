import React from 'react'
import { render } from '@testing-library/react-native'
import RootLayout from '@/app/_layout'
import type { AppUser } from '@/types'

// The layout is the only thing under test. Everything it mounts on the way — the
// provider, the SDK behind it, the drive-mode hook, the mock network — is replaced,
// so a failure here can only mean the redirect changed.
// The `mock` prefix is what lets these be referenced from a jest.mock factory, which
// babel-jest hoists above the imports.
const mockReplace = jest.fn()
let mockUser: AppUser | null = null

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => [],
  Stack: Object.assign(({ children }: { children: unknown }) => children, { Screen: () => null }),
}))
// SafeAreaProvider renders nothing until it has measured real insets, which never
// happens under jest — without this the navigator below it never mounts at all.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock('@/hooks/useDriveMode', () => ({ useDriveMode: () => {} }))
jest.mock('@/testing/mocks', () => ({ registerMockNetwork: () => {} }))
jest.mock('@/components/ui/Toast', () => ({ ToastContainer: () => null }))
jest.mock('@/context/AppContext', () => ({
  AppProvider: ({ children }: { children: unknown }) => children,
  useApp: () => ({
    user: mockUser,
    isLoading: false,
    deviceBlocked: false,
    lang: 'HE',
    toasts: [],
    removeToast: jest.fn(),
  }),
}))

const asUser = (role: string) => ({ id: 'u1', name: 'Test', role }) as AppUser

describe('post-login routing', () => {
  beforeEach(() => mockReplace.mockClear())

  // CAR-205: the business surface moved to the web, and a business owner drives like
  // anyone else. No role routes anywhere but the tabs any more.
  it('lands a BUSINESS user in the driver tabs', () => {
    mockUser = asUser('BUSINESS')
    render(<RootLayout />)
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)')
  })

  it('lands a driver in the driver tabs', () => {
    mockUser = asUser('DRIVER')
    render(<RootLayout />)
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)')
  })

  it('sends a signed-out visitor to login', () => {
    mockUser = null
    render(<RootLayout />)
    expect(mockReplace).toHaveBeenCalledWith('/login')
  })
})
