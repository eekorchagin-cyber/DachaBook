/** Часовой пояс участка (раздел 2 ТЗ): «сегодня» считается по нему, а не по телефону. */
export const SITE_TIME_ZONE = 'Asia/Krasnoyarsk'

export function todayAtSite(now = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: SITE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

/** Месяц и день «сегодня» на участке — для календаря примет. */
export function todayMonthDay(now = new Date()): { month: number; day: number } {
  const [, month, day] = todayAtSite(now).date.split('-').map(Number)
  return { month, day }
}

export const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${day} ${MONTHS_GENITIVE[month - 1]} ${year}`
}
