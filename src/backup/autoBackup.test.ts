import { describe, expect, it } from 'vitest'
import { autoBackupFileName, filesToPrune } from './autoBackup'

describe('автокопия в папку', () => {
  it('одна копия на день по местной дате', () => {
    expect(autoBackupFileName(new Date(2026, 9, 5, 23, 59))).toBe('dachabook-autocopy-2026-10-05.zip')
  })

  it('удаляет только старые автокопии сверх семи последних, чужие файлы не трогает', () => {
    const days = Array.from({ length: 9 }, (_, index) => `dachabook-autocopy-2026-10-${String(index + 1).padStart(2, '0')}.zip`)
    const names = [...days, 'dachabook-backup-20261001-1200.zip', 'заметки.txt', 'dachabook-autocopy-2026-10-01.zip.crswap']
    expect(filesToPrune(names)).toEqual(['dachabook-autocopy-2026-10-02.zip', 'dachabook-autocopy-2026-10-01.zip'])
    expect(filesToPrune(days.slice(0, 7))).toEqual([])
  })
})
