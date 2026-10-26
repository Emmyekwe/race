import { useEffect, useRef } from 'react'

const KEY_BINDINGS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'brake',
  KeyR: 'reset',
}

const releasedState = () => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
  brake: false,
  reset: false,
})

/** Returns a ref with the live control state; reading it in useFrame avoids re-renders. */
export function useKeyboardControls() {
  const controls = useRef(releasedState())

  useEffect(() => {
    const handler = (pressed) => (event) => {
      const action = KEY_BINDINGS[event.code]
      if (!action) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      event.preventDefault() // stop arrows/space from scrolling the page
      controls.current[action] = pressed
    }
    const onKeyDown = handler(true)
    const onKeyUp = handler(false)
    // Releasing keys while the window is unfocused never fires keyup; reset to avoid a stuck throttle.
    const onBlur = () => {
      controls.current = releasedState()
    }
    // Same for typing: keyups land on the focused field and are ignored above, so a key held
    // while opening chat would otherwise stay pressed until the player releases it again.
    const onFocusIn = (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) onBlur()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focusin', onFocusIn)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focusin', onFocusIn)
    }
  }, [])

  return controls
}
