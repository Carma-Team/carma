import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { WeekScoreStrip } from '@/components/social/WeekScoreStrip'
import he from '@/i18n/he'
import en from '@/i18n/en'
import type { Trip } from '@/types'

const trip = (startTime: string, avgScore: number) =>
  ({ id: startTime, startTime, avgScore }) as Trip

const today = () => new Date().toISOString()

describe('WeekScoreStrip header', () => {
  it('averages the days that were driven', () => {
    render(<WeekScoreStrip trips={[trip(today(), 80), trip(today(), 90)]} lang="HE" />)
    expect(screen.getByText(`${he.stats.chart.weekAvg} 85`)).toBeTruthy()
  })

  // A bare dash read as a value that failed to arrive. Nothing is missing here: the
  // trip type requires both fields, so a null average only means nobody drove.
  it('says nobody drove instead of showing a dash', () => {
    render(<WeekScoreStrip trips={[]} lang="HE" />)
    expect(screen.getByText(he.stats.chart.noDrive)).toBeTruthy()
    expect(screen.queryByText(new RegExp(he.stats.chart.weekAvg))).toBeNull()
  })

  it('says it in English too', () => {
    render(<WeekScoreStrip trips={[]} lang="EN" />)
    expect(screen.getByText(en.stats.chart.noDrive)).toBeTruthy()
  })
})
