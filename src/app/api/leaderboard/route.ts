import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export async function GET(request: Request) {
  try {
    const auth = getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const type = (searchParams.get('type') ?? 'national') as 'friends' | 'city' | 'national'
    const period = searchParams.get('period') ?? 'alltime'

    if (type === 'friends') {
      // Get user's friends
      const friendships = await prisma.friendship.findMany({
        where: { userId: auth.userId },
        select: { friendId: true },
      })
      const friendIds = [auth.userId, ...friendships.map(f => f.friendId)]

      const users = await prisma.user.findMany({
        where: { id: { in: friendIds } },
        orderBy: { totalPoints: 'desc' },
        select: { id: true, name: true, city: true, level: true, avatarUrl: true, totalPoints: true },
      })

      const entries = users.map((u, i) => ({
        id: `friends-${u.id}`,
        userId: u.id,
        type: 'friends' as const,
        rank: i + 1,
        score: u.totalPoints,
        period: period as 'alltime',
        user: u,
      }))

      return NextResponse.json({ entries, currentUserId: auth.userId })
    }

    if (type === 'city') {
      const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { city: true } })
      const users = await prisma.user.findMany({
        where: user?.city ? { city: user.city } : {},
        orderBy: { totalPoints: 'desc' },
        take: 50,
        select: { id: true, name: true, city: true, level: true, avatarUrl: true, totalPoints: true },
      })

      const entries = users.map((u, i) => ({
        id: `city-${u.id}`,
        userId: u.id,
        type: 'city' as const,
        rank: i + 1,
        score: u.totalPoints,
        period: period as 'alltime',
        user: u,
      }))

      return NextResponse.json({ entries, currentUserId: auth.userId })
    }

    // National
    const users = await prisma.user.findMany({
      orderBy: { totalPoints: 'desc' },
      take: 100,
      select: { id: true, name: true, city: true, level: true, avatarUrl: true, totalPoints: true },
    })

    const entries = users.map((u, i) => ({
      id: `national-${u.id}`,
      userId: u.id,
      type: 'national' as const,
      rank: i + 1,
      score: u.totalPoints,
      period: period as 'alltime',
      user: u,
    }))

    return NextResponse.json({ entries, currentUserId: auth.userId })
  } catch (error) {
    console.error('Leaderboard error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
