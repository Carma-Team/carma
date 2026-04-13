import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { calculateScore, getRiskMultiplier } from '@/lib/scoring'
import type { TripEventType } from '@/types'

export async function GET(request: Request) {
  try {
    const auth = getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') ?? '20')
    const offset = parseInt(searchParams.get('offset') ?? '0')

    const trips = await prisma.trip.findMany({
      where: { userId: auth.userId, status: 'completed' },
      orderBy: { startTime: 'desc' },
      take: limit,
      skip: offset,
    })

    const total = await prisma.trip.count({
      where: { userId: auth.userId, status: 'completed' },
    })

    return NextResponse.json({ trips, total })
  } catch (error) {
    console.error('Get trips error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = getAuthUser()
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { action } = body

    if (action === 'start') {
      // Check for existing active trip
      const existingActive = await prisma.trip.findFirst({
        where: { userId: auth.userId, status: 'active' },
      })
      if (existingActive) {
        return NextResponse.json({ trip: existingActive })
      }

      const trip = await prisma.trip.create({
        data: {
          userId: auth.userId,
          startTime: new Date(),
          startLocation: body.startLocation || null,
          status: 'active',
        },
      })
      return NextResponse.json({ trip }, { status: 201 })
    }

    if (action === 'end') {
      const {
        tripId,
        distanceKm = 0,
        durationSeconds = 0,
        hardBrakes = 0,
        aggressiveAccels = 0,
        sharpTurns = 0,
        phoneSeconds = 0,
        endLocation,
        events = [],
      } = body

      const trip = await prisma.trip.findFirst({
        where: { id: tripId, userId: auth.userId, status: 'active' },
      })
      if (!trip) {
        return NextResponse.json({ error: 'Active trip not found' }, { status: 404 })
      }

      const scoring = calculateScore({
        hardBrakes,
        aggressiveAccels,
        sharpTurns,
        phoneSeconds,
        durationSeconds,
        distanceKm,
        startTime: trip.startTime,
      })

      const endTime = new Date()

      // Generate AI insight
      const insights: string[] = []
      if (hardBrakes === 0 && aggressiveAccels === 0) insights.push(scoring.riskMultiplier > 1 ? 'נסיעת לילה מושלמת! ממש מדהים.' : 'נסיעה מושלמת! אפס אירועים.')
      else if (hardBrakes > 3) insights.push('שים לב לבלימות - נסה להשאיר מרווח גדול יותר מהרכב שלפניך.')
      else if (phoneSeconds > 30) insights.push('הפחתת השימוש בטלפון בזמן נהיגה תשפר משמעותית את הציון שלך.')
      else if (scoring.score >= 85) insights.push('נסיעה מצוינת! המשך כך ותגיע לרמה הבאה במהירות.')
      else insights.push('עוד קצת ותגיע לציון מצוין - שמור על ריווח ורוגע.')
      const aiInsight = insights[0]

      // Update trip events
      if (events.length > 0) {
        await prisma.tripEvent.createMany({
          data: events.map((e: { eventType: TripEventType; timestamp: string; severity: number }) => ({
            tripId: trip.id,
            eventType: e.eventType,
            timestamp: new Date(e.timestamp),
            severity: e.severity ?? 1.0,
          })),
        })
      }

      const updatedTrip = await prisma.trip.update({
        where: { id: trip.id },
        data: {
          endTime,
          distanceKm,
          durationSeconds,
          hardBrakes,
          aggressiveAccels,
          sharpTurns,
          phoneSeconds,
          score: scoring.score,
          points: scoring.points,
          riskMultiplier: scoring.riskMultiplier,
          endLocation: endLocation || null,
          aiInsight,
          status: 'completed',
        },
      })

      // Update user totals
      await prisma.user.update({
        where: { id: auth.userId },
        data: {
          totalPoints: { increment: Math.round(scoring.points) },
          totalDistance: { increment: distanceKm },
        },
      })

      // Recalculate level
      const updatedUser = await prisma.user.findUnique({ where: { id: auth.userId } })
      if (updatedUser) {
        const { getLevelByPoints } = await import('@/lib/constants')
        const newLevel = getLevelByPoints(updatedUser.totalPoints)
        if (newLevel !== updatedUser.level) {
          await prisma.user.update({ where: { id: auth.userId }, data: { level: newLevel } })

          // Create level-up notification
          await prisma.notification.create({
            data: {
              userId: auth.userId,
              type: 'achievement',
              titleHe: `עלית לרמה ${newLevel}! 🎉`,
              titleEn: `Level Up to ${newLevel}! 🎉`,
              bodyHe: `כל הכבוד! הגעת לרמה ${newLevel}.`,
              bodyEn: `Congratulations! You reached level ${newLevel}.`,
            },
          })
        }
      }

      // Create trip complete notification
      await prisma.notification.create({
        data: {
          userId: auth.userId,
          type: 'trip_complete',
          titleHe: 'נסיעה הושלמה!',
          titleEn: 'Trip Complete!',
          bodyHe: `קיבלת ${Math.round(scoring.points)} נקודות. ציון: ${scoring.score}.`,
          bodyEn: `You earned ${Math.round(scoring.points)} points. Score: ${scoring.score}.`,
          data: JSON.stringify({ tripId: trip.id }),
        },
      })

      return NextResponse.json({ trip: updatedTrip, scoring })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Trip error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
