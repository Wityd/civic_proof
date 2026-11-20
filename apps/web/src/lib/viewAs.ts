// Remembers which demo user is selected in the "View as" switcher.
const KEY = 'civicproof.viewAs'

export function getViewAsId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setViewAsId(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {
    // storage blocked: the choice just won't be remembered
  }
}
