<script lang="ts">
    import { DBState, selectedCharID } from 'src/ts/stores.svelte'
    import { getModules } from 'src/ts/process/modules'
    import { collectLuaVariables, type LuaSource, type LuaVariable } from 'src/ts/gui/luaVariables'

    let query = $state('')
    let onlyUnset = $state(false)
    let expanded = $state<Record<string, boolean>>({})

    const character = $derived(DBState.db.characters[$selectedCharID])
    const chat = $derived(character?.chats?.[character.chatPage])

    const sources = $derived.by(() => {
        const out: LuaSource[] = []
        if (!character) return out
        const add = (label: string, triggers: { effect?: { type: string, code?: string }[] }[] | undefined) => {
            const code = (triggers ?? [])
                .flatMap(t => t.effect ?? [])
                .filter(e => e.type === 'triggerlua' && e.code)
                .map(e => e.code)
                .join('\n')
            if (code) out.push({ label, code })
        }
        add('character', character.triggerscript)
        try {
            for (const module of getModules({ character, chat })) add(module?.name || 'module', module?.trigger)
        } catch {
            // Module lookup needs a loaded database; the character's own Lua is enough then.
        }
        return out
    })

    // Parsing is the slow part (a large bot is ~100ms), so it depends on the code only, not on values.
    const variables = $derived(collectLuaVariables(sources, character?.defaultVariables ?? ''))
    const multipleSources = $derived(sources.length > 1)

    const stateKey = (v: LuaVariable) => '$' + v.name
    const isConcrete = (v: LuaVariable) => !v.pattern && !v.name.includes('{')
    const isSet = (v: LuaVariable) => isConcrete(v) && Object.hasOwn(chat?.scriptstate ?? {}, stateKey(v))

    const visible = $derived.by(() => {
        const q = query.trim().toLowerCase()
        return variables.filter(v => {
            if (onlyUnset && (!isConcrete(v) || isSet(v))) return false
            if (!q) return true
            return v.name.toLowerCase().includes(q) || v.comment.toLowerCase().includes(q)
        })
    })

    const documented = $derived(variables.filter(v => v.comment).length)

    function addVariable(v: LuaVariable) {
        if (!chat || !isConcrete(v)) return
        chat.scriptstate ??= {}
        if (!Object.hasOwn(chat.scriptstate, stateKey(v))) chat.scriptstate[stateKey(v)] = v.defaultValue ?? ''
    }

    function usesLabel(v: LuaVariable) {
        const places = [...new Set(v.uses.map(u => (multipleSources ? u.source + ' ' : '') + 'L' + u.line))]
        return places.slice(0, 3).join(', ') + (places.length > 3 ? ` +${places.length - 3}` : '')
    }
</script>

{#if variables.length === 0}
    <div class="p-2 text-center text-textcolor2">No Lua variables found</div>
{:else}
    <div class="lua-vars">
        <div class="controls">
            <input class="search" placeholder="Search name or comment" aria-label="Search Lua variables" bind:value={query} />
            <label><input type="checkbox" bind:checked={onlyUnset} /> Unset only</label>
            <span class="count">{visible.length}/{variables.length} vars, {documented} with comments</span>
        </div>
        <ul>
            {#each visible as v (v.name)}
                <li>
                    <div class="head">
                        <code title={usesLabel(v)}>{v.name}</code>
                        <span class="rw" title="Reads and writes found in Lua">
                            {#if v.reads}<span>R{v.reads}</span>{/if}
                            {#if v.writes}<span>W{v.writes}</span>{/if}
                            {#if !v.uses.length}<span>default</span>{/if}
                        </span>
                    </div>
                    <div class="value">
                        {#if !isConcrete(v)}
                            <span class="muted">{v.pattern ? 'Name built at runtime' : 'Prefix set at runtime'}</span>
                        {:else if isSet(v)}
                            {#if typeof chat.scriptstate[stateKey(v)] === 'string'}
                                <input aria-label={'Value of ' + v.name} bind:value={chat.scriptstate[stateKey(v)] as string} />
                            {:else}
                                <span class="muted">{JSON.stringify(chat.scriptstate[stateKey(v)])}</span>
                            {/if}
                        {:else}
                            <span class="muted">Unset{v.defaultValue !== undefined ? ` (default: ${v.defaultValue})` : ''}</span>
                            <button type="button" class="add" onclick={() => addVariable(v)}>Add</button>
                        {/if}
                    </div>
                    {#if v.comment}
                        <button type="button" class="comment" class:open={expanded[v.name]}
                            aria-expanded={!!expanded[v.name]}
                            onclick={() => expanded[v.name] = !expanded[v.name]}>{v.comment}</button>
                    {/if}
                    {#if v.uses.length}
                        <div class="uses">{usesLabel(v)}</div>
                    {/if}
                </li>
            {:else}
                <li class="muted">No match</li>
            {/each}
        </ul>
    </div>
{/if}

<style>
    .lua-vars { display: flex; flex-direction: column; gap: .5rem; font-size: .8rem; min-width: 0; }
    .controls { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .75rem; }
    .search { flex: 1 1 100%; }
    input:not([type='checkbox']) { min-width: 0; width: 100%; padding: .3rem .45rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-md) * 1); color: var(--color-textcolor); background: transparent; font: inherit; }
    input:focus-visible, button:focus-visible { outline: 1px solid var(--color-borderc); outline-offset: 1px; }
    label { display: flex; align-items: center; gap: .3rem; color: var(--color-textcolor2); }
    .count { color: var(--color-textcolor2); font-variant-numeric: tabular-nums; }
    ul { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-md) * 1); }
    li { display: flex; flex-direction: column; gap: .3rem; padding: .5rem; min-width: 0; }
    li + li { border-top: 1px solid var(--color-darkborderc); }
    .head { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }
    code { overflow-wrap: anywhere; font-weight: 600; color: var(--color-textcolor); }
    .rw { display: flex; flex-shrink: 0; gap: .3rem; color: var(--color-textcolor2); font-size: .7rem; font-variant-numeric: tabular-nums; }
    .value { display: flex; align-items: center; gap: .5rem; min-width: 0; }
    .muted { color: var(--color-textcolor2); overflow-wrap: anywhere; }
    .add { flex-shrink: 0; margin-left: auto; padding: .15rem .55rem; border: 1px solid var(--color-darkborderc); border-radius: calc(var(--risu-radius-md) * 1); color: var(--color-textcolor); background: transparent; cursor: pointer; }
    .add:hover { border-color: var(--color-borderc); }
    .comment { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; padding: 0; border: 0; background: transparent; color: var(--color-textcolor2); font: inherit; font-size: .75rem; line-height: 1.4; text-align: left; white-space: pre-line; overflow-wrap: anywhere; cursor: pointer; }
    .comment.open { display: block; -webkit-line-clamp: unset; line-clamp: unset; }
    .uses { color: var(--color-textcolor2); font-size: .7rem; opacity: .75; }
</style>
