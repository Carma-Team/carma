'use client'

import React from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useT } from '@/hooks/useTranslation'

interface ScoreChartProps {
  data: { date: string; score: number }[]
}

export function ScoreChart({ data }: ScoreChartProps) {
  const { t } = useT()

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-400">
        <p>{t('stats.noData')}</p>
      </div>
    )
  }

  const recent = data.slice(-14)

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={recent} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#64748b', fontSize: 10 }}
          tickFormatter={d => d.slice(5)} // MM-DD
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: '#64748b', fontSize: 10 }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
          labelStyle={{ color: '#94a3b8', fontSize: 12 }}
          itemStyle={{ color: '#22c55e' }}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke="#22c55e"
          strokeWidth={2.5}
          dot={{ fill: '#22c55e', strokeWidth: 0, r: 3 }}
          activeDot={{ r: 5, fill: '#22c55e' }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default ScoreChart
