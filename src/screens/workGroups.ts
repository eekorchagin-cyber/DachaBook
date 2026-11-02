/** Делит работы карточки: ещё в плане, уже выполненные в этом сезоне и снятые в архив. Порядок внутри группы сохраняется. */
export function splitCardWorks<T extends { id: string; active: boolean }>(works: T[], doneIds: ReadonlySet<string>): { planned: T[]; done: T[]; archived: T[] } {
  return {
    planned: works.filter((work) => work.active && !doneIds.has(work.id)),
    done: works.filter((work) => work.active && doneIds.has(work.id)),
    archived: works.filter((work) => !work.active),
  }
}
