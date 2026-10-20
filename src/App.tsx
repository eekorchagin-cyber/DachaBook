import { useEffect } from 'react'
import { useRoute } from './app/router'
import { applyAppearance, useSettings } from './app/store'
import type { EventType } from './domain/types'
import { LabScreen } from './lab/LabScreen'
import { DiaryScreen } from './screens/diary/DiaryScreen'
import { EventEditor } from './screens/diary/EventEditor'
import { HomeScreen } from './screens/HomeScreen'
import { ComingSoon, MoreScreen, TrashScreen } from './screens/MoreScreen'
import { ObjectsScreen } from './screens/ObjectsScreen'
import { SettingsScreen, WelcomeScreen } from './screens/SettingsScreen'

export default function App() {
  const route = useRoute()
  const settings = useSettings()

  useEffect(() => {
    if (settings) applyAppearance(settings)
  }, [settings])

  const pathKey = route.path.join('/')
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathKey])

  const [section, param] = route.path
  if (section === 'lab') return <LabScreen />
  if (!settings) return null
  if (!settings.authorName) return <WelcomeScreen />

  switch (section) {
    case 'diary':
      if (param) {
        return (
          <EventEditor
            key={`${param}-${route.query.get('type') ?? ''}`}
            id={param === 'new' ? undefined : param}
            initialType={(route.query.get('type') as EventType | null) ?? 'work'}
            settings={settings}
          />
        )
      }
      return <DiaryScreen settings={settings} />
    case 'objects':
      return <ObjectsScreen />
    case 'library':
      return <ComingSoon title="Справочник" text="Справочные материалы появятся в следующем обновлении этапа 2." />
    case 'plan':
      return <ComingSoon title="Черновик плана" text="Черновик сезонного плана появится вместе с импортом из Evernote." />
    case 'import':
      return <ComingSoon title="Импорт из Evernote" text="Импорт появится в следующем обновлении этапа 2." />
    case 'backup':
      return <ComingSoon title="Резервная копия" text="Экспорт и импорт появятся в следующем обновлении этапа 2." />
    case 'trash':
      return <TrashScreen />
    case 'more':
      return <MoreScreen />
    case 'settings':
      return <SettingsScreen settings={settings} />
    default:
      return <HomeScreen authorName={settings.authorName} />
  }
}
