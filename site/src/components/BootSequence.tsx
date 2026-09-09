/*
 * A one-time boot animation shown in front of the real page: a fake terminal
 * session types out, then the visitor's name is shown large, then the
 * overlay fades and never appears again this session.
 *
 * It is `aria-hidden` and `inert` rather than a real dialog, because it is
 * not one — there is nothing here to operate, read, or navigate, so nothing
 * should be reachable by Tab or announced by a screen reader. The real page
 * underneath is already fully rendered; this only sits in front of it
 * visually, and disappears on the first sign of input.
 *
 * All three skip conditions are read before the first state is set, so a
 * visitor who qualifies for any of them never has a timer scheduled at all.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { summary } from '../data/resume.ts'
import { useScrollLock } from '../useScrollLock.ts'

/** Namespaced like theme.ts's THEME_STORAGE_KEY: brettbergin.github.io's
 * project pages all share one origin and therefore one sessionStorage. */
const BOOT_STORAGE_KEY = 'resume-boot-seen'

/** The fake terminal session, typed line by line before the name is shown.
 * `delayMs` is how long that line sits alone before the next one appears. */
const SCRIPT: { text: string; delayMs: number }[] = [
  { text: '$ ssh brett@resume.local', delayMs: 500 },
  { text: 'Password: ********', delayMs: 350 },
  { text: 'Access granted.', delayMs: 350 },
  { text: '$ cat resume.md', delayMs: 450 },
]

/** How long the name is held on screen before the sequence auto-finishes. */
const NAME_HOLD_MS = 350

/** The opacity fade `finish()` plays before the overlay stops rendering. */
const FADE_MS = 300

/** Mirrors theme.ts's getStoredTheme: Safari private mode throws on the
 * property access itself, not just the write, so the read is guarded too. An
 * unreadable flag counts as "not seen" — the safe default is to show the
 * sequence, not to silently skip it. */
function hasSeenBoot(): boolean {
  try {
    return window.sessionStorage.getItem(BOOT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function markBootSeen(): void {
  try {
    window.sessionStorage.setItem(BOOT_STORAGE_KEY, '1')
  } catch {
    // Storage is unavailable (private mode, blocked cookies). The overlay is
    // dismissed either way; it just may play again next reload.
  }
}

function shouldSkipBoot(): boolean {
  return (
    hasSeenBoot() ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    new URLSearchParams(window.location.search).has('noboot')
  )
}

type Stage = 'playing' | 'closing' | 'closed'

export function BootSequence() {
  // Lazy initializer: evaluated once, synchronously, before the first paint —
  // so a visitor who qualifies for a skip condition never has anything
  // scheduled at all.
  const [skip] = useState(shouldSkipBoot)
  const [stage, setStage] = useState<Stage>('playing')
  const [lineCount, setLineCount] = useState(0)
  const [showName, setShowName] = useState(false)
  const finishedRef = useRef(false)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useScrollLock(!skip && stage !== 'closed')

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    for (const id of timeoutsRef.current) clearTimeout(id)
    timeoutsRef.current = []
    markBootSeen()
    setStage('closing')
  }, [])

  // Drive the typewriter: reveal one script line at a time, then the name,
  // then auto-finish if nothing has dismissed it already.
  useEffect(() => {
    if (skip) return

    let elapsed = 0
    const timeouts = SCRIPT.map((line, index) => {
      elapsed += line.delayMs
      return setTimeout(() => setLineCount(index + 1), elapsed)
    })
    timeouts.push(setTimeout(() => setShowName(true), elapsed))
    timeouts.push(setTimeout(finish, elapsed + NAME_HOLD_MS))

    timeoutsRef.current = timeouts
    return () => {
      for (const id of timeouts) clearTimeout(id)
    }
  }, [skip, finish])

  // Any key or pointer input anywhere ends the sequence early. Removed again
  // as soon as it fires, so a dismissed overlay leaves nothing listening.
  useEffect(() => {
    if (skip || stage !== 'playing') return

    window.addEventListener('keydown', finish)
    window.addEventListener('pointerdown', finish)
    return () => {
      window.removeEventListener('keydown', finish)
      window.removeEventListener('pointerdown', finish)
    }
  }, [skip, stage, finish])

  // The fade plays for FADE_MS, then the overlay stops rendering entirely.
  useEffect(() => {
    if (stage !== 'closing') return
    const id = setTimeout(() => setStage('closed'), FADE_MS)
    return () => clearTimeout(id)
  }, [stage])

  if (skip || stage === 'closed') return null

  return (
    <div
      aria-hidden="true"
      inert
      /* Read by src/components/Cursor.tsx, which suspends the crosshair
         reticle and hands the OS arrow back while any overlay carrying this
         attribute is in the document. It cannot key off `role="dialog"` the
         way it does for the mobile menu, because this is not a dialog; and it
         has to suspend rather than paint over the overlay, because the ring
         and dot are `--color-text`, which in the light palette is this
         overlay's own `bg-neutral-900`. */
      data-overlay="boot"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-neutral-900 px-4 font-mono text-neutral-50 transition-opacity duration-300 ${
        stage === 'closing' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex w-full max-w-2xl flex-col gap-2 text-sm">
        {SCRIPT.slice(0, lineCount).map((line) => (
          <p key={line.text}>{line.text}</p>
        ))}
      </div>

      {showName ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-4xl font-semibold">{summary.name}</span>
          <span className="text-base text-neutral-400">{summary.title}</span>
        </div>
      ) : null}
    </div>
  )
}
