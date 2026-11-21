import type { MonthClimate } from './monthlyClimate'

export type ClimateMonthIcon = 'snow' | 'rain' | 'both' | 'none'

/** Значок месяца на климатическом графике: снег при морозе, капли при заметных осадках. */
export function climateMonthIcon(month: MonthClimate, rainMm = 40): ClimateMonthIcon {
  const snow = (month.tAvg !== null && month.tAvg < 0) || (month.tMin !== null && month.tMin < 0)
  const rain = month.precipMm !== null && month.precipMm >= rainMm
  if (snow && rain) return 'both'
  if (snow) return 'snow'
  if (rain) return 'rain'
  return 'none'
}
