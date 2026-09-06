/**
 * Two settlements can share a name in the active language.
 *
 * The picker used to deal in bare label strings, so callers resolved a pick back
 * through a label-keyed map: the duplicate names collapsed into one entry and the
 * selection landed on whichever had been built last (CAR-290).
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { LocationPicker } from '@/components/ui/LocationPicker'

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }))

// Two settlements that share a name, which is the whole case.
const OPTIONS = [
  { value: 'IL-NHR', label: 'נהריה' },
  { value: 'IL-KFB-N', label: 'כפר ברוך' },
  { value: 'IL-KFB-S', label: 'כפר ברוך' },
]

const openSheet = () => fireEvent.press(screen.getByText('בחירת עיר'))

describe('LocationPicker', () => {
  it('keeps settlements that share a name apart', () => {
    const onChange = jest.fn()
    render(<LocationPicker value="" options={OPTIONS} placeholder="בחירת עיר" onChange={onChange} />)
    openSheet()

    const rows = screen.getAllByText('כפר ברוך')
    expect(rows).toHaveLength(2)

    // The second one, which is exactly the one a label-keyed lookup would have lost.
    fireEvent.press(rows[1])
    expect(onChange).toHaveBeenCalledWith('IL-KFB-S')
  })

  it('shows the label of whatever the value points at', () => {
    render(<LocationPicker value="IL-KFB-N" options={OPTIONS} placeholder="בחירת עיר" onChange={jest.fn()} />)
    expect(screen.getByText('כפר ברוך')).toBeTruthy()
  })

  it('falls back to the placeholder for a value no option carries', () => {
    render(<LocationPicker value="IL-GONE" options={OPTIONS} placeholder="בחירת עיר" onChange={jest.fn()} />)
    expect(screen.getByText('בחירת עיר')).toBeTruthy()
  })
})
