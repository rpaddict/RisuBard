import { describe, expect, test, vi } from 'vitest'
import { createRisuTriggerActivation } from './risuTriggerActivation'

function triggerButton() {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<button risu-trigger="WALP_SidebarToggle"><span>open</span></button>'
    return wrapper.querySelector('span') as HTMLSpanElement
}

describe('risu trigger activation', () => {
    test('activates once from pointerdown when Firefox does not emit click', async () => {
        const activate = vi.fn()
        const handlers = createRisuTriggerActivation(activate, {
            pointerDownFallback: true,
        })
        const target = triggerButton()

        await handlers.pointerdown({ target, button: 0 } as unknown as PointerEvent)

        expect(activate).toHaveBeenCalledOnce()
        expect(activate.mock.calls[0][0].getAttribute('risu-trigger'))
            .toBe('WALP_SidebarToggle')
    })

    test('does not activate twice when click follows pointerdown', async () => {
        const activate = vi.fn()
        const handlers = createRisuTriggerActivation(activate, {
            pointerDownFallback: true,
        })
        const target = triggerButton()

        await handlers.pointerdown({ target, button: 0 } as unknown as PointerEvent)
        await handlers.click({ target } as unknown as MouseEvent)

        expect(activate).toHaveBeenCalledOnce()
    })

    test('does not activate twice when pointerdown redraws the button before click', async () => {
        const activate = vi.fn()
        const handlers = createRisuTriggerActivation(activate, {
            pointerDownFallback: true,
        })
        const wrapper = document.createElement('div')
        document.body.appendChild(wrapper)
        wrapper.innerHTML = '<button risu-btn="mha_bk_cycle">a</button>'
        const first = wrapper.querySelector('button') as HTMLButtonElement

        await handlers.pointerdown({ target: first, button: 0 } as unknown as PointerEvent)
        wrapper.innerHTML = '<button risu-btn="mha_bk_cycle">b</button>'
        const redrawn = wrapper.querySelector('button') as HTMLButtonElement
        await handlers.click({ target: redrawn } as unknown as MouseEvent)
        // A later keyboard click on the redrawn button is a new press.
        await handlers.click({ target: redrawn } as unknown as MouseEvent)

        expect(activate).toHaveBeenCalledTimes(2)
        wrapper.remove()
    })

    test('a click on another button after pointerdown still activates', async () => {
        const activate = vi.fn()
        const handlers = createRisuTriggerActivation(activate, {
            pointerDownFallback: true,
        })
        const other = document.createElement('div')
        other.innerHTML = '<button risu-btn="mha_opt_pc">b</button>'

        await handlers.pointerdown({ target: triggerButton(), button: 0 } as unknown as PointerEvent)
        await handlers.click({ target: other.firstElementChild } as unknown as MouseEvent)

        expect(activate).toHaveBeenCalledTimes(2)
    })

    test('keeps keyboard-generated click activation', async () => {
        const activate = vi.fn()
        const handlers = createRisuTriggerActivation(activate)

        await handlers.click({ target: triggerButton() } as unknown as MouseEvent)

        expect(activate).toHaveBeenCalledOnce()
    })
})
