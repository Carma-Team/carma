import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'
import type { User } from '@/types'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-do-not-use-in-production'
const COOKIE_NAME = 'carma_token'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export interface JwtPayload {
  userId: string
  email: string
  iat?: number
  exp?: number
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}

export function setAuthCookie(token: string): void {
  const cookieStore = cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
}

export function clearAuthCookie(): void {
  const cookieStore = cookies()
  cookieStore.delete(COOKIE_NAME)
}

export function getTokenFromCookies(): string | null {
  const cookieStore = cookies()
  return cookieStore.get(COOKIE_NAME)?.value ?? null
}

export function getAuthUser(): JwtPayload | null {
  const token = getTokenFromCookies()
  if (!token) return null
  return verifyToken(token)
}

export function userToPublic(user: {
  id: string
  name: string
  email: string
  phone?: string | null
  city?: string | null
  age?: number | null
  licenseYear?: number | null
  totalPoints: number
  totalDistance: number
  level: number
  avatarUrl?: string | null
  createdAt: Date
}): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    city: user.city,
    age: user.age,
    licenseYear: user.licenseYear,
    totalPoints: user.totalPoints,
    totalDistance: user.totalDistance,
    level: user.level,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  }
}
