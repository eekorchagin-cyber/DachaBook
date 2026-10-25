import { describe, expect, it } from 'vitest'
import bundled from '../seed/folk-signs.md?raw'
import { folkSignKey, parseDayMonth, parseFolkSigns, upcomingSigns } from './folkSigns'

const SAMPLE = `| Дата | Описание приметы |
|---|---|
| **7 января** | **Рождество.** Оттепель считалась предвестием ранней тёплой весны. |
| **14 января** | **Васильев день.** Туман связывали с хорошим будущим урожаем. |
| **29 января** | **Пётр-полукорм.** Проверяли, достаточно ли кормов. [1] |
| **14 марта** | **Евдокия-весновка.** Солнечная погода предвещала раннюю весну. [2] |
| **18 мая** | Срок высадки капустной рассады. |

1. [Календарь народных примет — Природа](https://priroda.inc.ru/pogoda/primeta.html).
2. [Народный календарь — Вокруг света](https://www.vokrugsveta.ru/x/).
`

describe('народные приметы', () => {
  it('разбирает дату, название, текст и источник группы строк', () => {
    const signs = parseFolkSigns(SAMPLE)
    expect(signs).toHaveLength(5)
    expect(signs[0]).toEqual({
      month: 1,
      day: 7,
      title: 'Рождество',
      text: 'Оттепель считалась предвестием ранней тёплой весны.',
      source: { title: 'Календарь народных примет — Природа', url: 'https://priroda.inc.ru/pogoda/primeta.html' },
    })
    expect(signs[1].source?.title).toBe('Календарь народных примет — Природа')
    expect(signs[2].text).toBe('Проверяли, достаточно ли кормов.')
    expect(signs[3]).toMatchObject({ month: 3, day: 14, source: { url: 'https://www.vokrugsveta.ru/x/' } })
    expect(signs[4]).toEqual({ month: 5, day: 18, title: '', text: 'Срок высадки капустной рассады.' })
  })

  it('встроенный свод: 43 приметы, у каждой дата и текст, ключи не повторяются', () => {
    const signs = parseFolkSigns(bundled)
    expect(signs).toHaveLength(43)
    expect(signs.every((sign) => sign.text && sign.title)).toBe(true)
    expect(new Set(signs.map(folkSignKey)).size).toBe(43)
    expect(signs.at(-1)).toMatchObject({ month: 12, day: 19, title: 'Никола зимний', source: { title: 'Народные приметы декабря — Cosmo-360' } })
  })

  it('проверяет даты', () => {
    expect(parseDayMonth('**29 февраля**')).toEqual({ month: 2, day: 29 })
    expect(parseDayMonth('31 апреля')).toBeNull()
    expect(parseDayMonth('Дата')).toBeNull()
  })

  it('находит примету на сегодня или ближайшую в пределах недели, в том числе через Новый год', () => {
    const signs = [
      { month: 1, day: 7 },
      { month: 10, day: 14 },
    ]
    expect(upcomingSigns(signs, { month: 10, day: 14 })).toEqual({ signs: [signs[1]], ahead: 0 })
    expect(upcomingSigns(signs, { month: 10, day: 10 })).toEqual({ signs: [signs[1]], ahead: 4 })
    expect(upcomingSigns(signs, { month: 12, day: 31 })).toEqual({ signs: [signs[0]], ahead: 7 })
    expect(upcomingSigns(signs, { month: 11, day: 1 }).signs).toEqual([])
  })
})
