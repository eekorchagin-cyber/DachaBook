import type { DiaryDatabase } from './db'

/** Закрыть и открыть базу заново: следующая синхронизация сможет читать записи. */
export async function reopenDatabase(database: DiaryDatabase): Promise<void> {
  if (database.isOpen()) database.close()
  await database.open()
}
