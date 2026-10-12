import { describe, expect, it } from 'vitest'
import { orderProjects, pinnedSplitIndex, pinLabel, projectTargetPath } from '../src/renderer/src/projectListState'
import { translate } from '../src/shared/i18n'

describe('project list presentation', () => {
  it('places a separator only between nonempty pinned and unpinned groups', () => {
    expect(pinnedSplitIndex(orderProjects([{ pinned: false }, { pinned: true }, { pinned: true }]))).toBe(2)
    expect(pinnedSplitIndex([])).toBeNull()
    expect(pinnedSplitIndex([{ pinned: true }])).toBeNull()
    expect(pinnedSplitIndex([{}, { pinned: false }])).toBeNull()
  })
  it('groups pins stably without changing the input', () => {
    const projects = [{ id: 'a' }, { id: 'b', pinned: true }, { id: 'c' }, { id: 'd', pinned: true }]
    expect(orderProjects(projects).map(p => p.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(projects.map(p => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('uses accessible pin and unpin labels in both languages', () => {
    expect(translate('ko', pinLabel(false))).toBe('맨 위에 고정')
    expect(translate('ko', pinLabel(true))).toBe('고정 해제')
    expect(translate('en', pinLabel(undefined))).toBe('Pin to top')
    expect(translate('en', pinLabel(true))).toBe('Unpin')
  })
  it('previews normalized names with Windows and POSIX root separators', () => {
    expect(projectTargetPath('C:\\Projects\\', '  게임')).toBe('C:\\Projects\\게임')
    expect(projectTargetPath('/home/projects/', 'game one')).toBe('/home/projects/game one')
  })
})
