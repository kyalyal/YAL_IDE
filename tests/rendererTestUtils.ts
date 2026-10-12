import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect } from 'vitest'

export async function mount(element: ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(element))
  return { host, async render(next: ReactElement) { await act(async () => root.render(next)) },
    async close() { await act(async () => root.unmount()); host.remove() } }
}
export { act, createElement }
export async function click(element: Element | null) {
  expect(element).not.toBeNull()
  await act(async () => (element as HTMLElement).click())
}
export function button(host: Element, text: string) {
  return [...host.querySelectorAll('button')].find(item => item.textContent === text) ?? null
}
export async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
