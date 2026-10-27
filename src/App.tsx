import { useEffect } from 'react'
import { useRoute } from './app/router'
import { applyAppearance, useSettings } from './app/store'
import type { EventType } from './domain/types'
import { setWorkKinds } from './import/suggest'
import { LabScreen } from './lab/LabScreen'
import { DiaryScreen } from './screens/diary/DiaryScreen'
import { EventEditor } from './screens/diary/EventEditor'
import { GuideScreen } from './screens/GuideScreen'
import { HomeScreen } from './screens/HomeScreen'
import { ArchiveScreen } from './screens/import/ArchiveScreen'
import { ImportScreen } from './screens/import/ImportScreen'
import { PlanScreen } from './screens/import/PlanScreen'
import { LibraryScreen } from './screens/library/LibraryScreen'
import { ReferenceEditor, ReferenceView } from './screens/library/ReferenceScreen'
import { BackupScreen } from './screens/BackupScreen'
import { ConflictsScreen } from './screens/ConflictsScreen'
import { ConsumablesScreen } from './screens/ConsumablesScreen'
import { DictionariesScreen, DictionaryScreen } from './screens/DictionariesScreen'
import { FolkSignsScreen } from './screens/FolkSignsScreen'
import { MoreScreen, TrashScreen } from './screens/MoreScreen'
import { ObjectsScreen } from './screens/ObjectsScreen'
import { WorksScreen } from './screens/WorksScreen'
import { SettingsScreen, WelcomeScreen } from './screens/SettingsScreen'
import { SyncScreen } from './screens/SyncScreen'

export default function App() {
  const route = useRoute()
  const settings = useSettings()

  useEffect(() => {
    if (settings) applyAppearance(settings)
  }, [settings])

  useEffect(() => {
    if (settings) setWorkKinds(settings.workKinds, settings.workKindRenames)
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
            key={`${param}-${route.query.get('type') ?? ''}-${route.query.get('plan') ?? ''}`}
            id={param === 'new' ? undefined : param}
            initialType={(route.query.get('type') as EventType | null) ?? 'work'}
            settings={settings}
            planId={route.query.get('plan') ?? undefined}
          />
        )
      }
      return (
        <DiaryScreen
          key={`${route.query.get('from') ?? ''}-${route.query.get('to') ?? ''}`}
          settings={settings}
          initialFilter={{ from: route.query.get('from') ?? undefined, to: route.query.get('to') ?? undefined }}
        />
      )
    case 'objects':
      return (
        <ObjectsScreen
          key={`${route.query.get('view') ?? 'objects'}-${route.query.get('from') ?? ''}`}
          initialView={route.query.get('view') === 'groups' ? 'groups' : 'objects'}
          fromDictionaries={route.query.get('from') === 'dictionaries'}
        />
      )
    case 'dictionaries':
      return param ? <DictionaryScreen kind={param} settings={settings} /> : <DictionariesScreen settings={settings} />
    case 'library':
      if (param === 'new') return <ReferenceEditor />
      if (param && route.path[2] === 'edit') return <ReferenceEditor id={param} />
      if (param) return <ReferenceView id={param} />
      return <LibraryScreen />
    case 'plan':
      return <PlanScreen />
    case 'works':
      return <WorksScreen settings={settings} />
    case 'import':
      return <ImportScreen settings={settings} />
    case 'archive':
      return <ArchiveScreen />
    case 'backup':
      return <BackupScreen />
    case 'trash':
      return <TrashScreen />
    case 'sync':
      return <SyncScreen />
    case 'conflicts':
      return <ConflictsScreen />
    case 'consumables':
      return <ConsumablesScreen />
    case 'signs':
      return <FolkSignsScreen />
    case 'guide':
      return <GuideScreen section={route.query.get('section') ?? undefined} />
    case 'more':
      return <MoreScreen />
    case 'settings':
      return <SettingsScreen settings={settings} />
    default:
      return <HomeScreen authorName={settings.authorName} plotAddress={settings.plotAddress} photoPosition={settings.photoPosition} />
  }
}
