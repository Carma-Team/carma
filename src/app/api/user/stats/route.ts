import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export async function GET() {
  try {
    const auth = getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const trips = await prisma.trip.findMany({
      where: { userId: auth.userId, status: 'completed' },
      orderBy: { startTime: 'asc' },
      select: {
        startTime: true,
        score: true,
        distanceKm: true,
        durationSeconds: true,
        hardBrakes: true,
        aggressiveAccels: true,
        sharpTurns: true,
        phoneSeconds: true,
        points: true,
      },
    })

    const totalTrips = trips.length
    const totalDistance = trips.reduce((s, t) => s + t.distanceKm, 0)
    const totalPoints = trips.reduce((s, t) => s + t.points, 0)
    const totalDurationSeconds = trips.reduce((s, t) => s + t.durationSeconds, 0)
    const averageScore = totalTrips > 0 ? trips.reduce((s, t) => s + t.score, 0) / totalTrips : 0
    const safeTripsCount = trips.filter(t => t.score >= 80).length

    const recentScores = trips.slice(-30).map(t => ({
      date: t.startTime.toISOString().slice(0, 10),
      score: Math.round(t.score),
    }))

    const eventCounts = {
      hardBrakes: trips.reduce((s, t) => s + t.hardBrakes, 0),
      aggressiveAccels: trips.reduce((s, t) => s + t.aggressiveAccels, 0),
      sharpTurns: trips.reduce((s, t) => s + t.sharpTurns, 0),
      phoneSeconds: trips.reduce((s, t) => s + t.phoneSeconds, 0),
    }

    const stats = {
      totalTrips,
      totalDistance: Math.round(totalDistance * 10) / 10,
      totalPoints: Math.round(totalPoints),
      averageScore: Math.round(averageScore * 10) / 10,
      totalDurationSeconds,
      safeTripsCount,
      recentScores,
      eventCounts,
    }

    return NextResponse.json({ stats })
  } catch (error) {
    console.error('Stats error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
