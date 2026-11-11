import { describe, expect, it } from 'vitest'
import { collectLuaVariables } from './luaVariables'

describe('collectLuaVariables', () => {
    it('collects literal names, reads and writes with their comments', () => {
        const code = [
            '-- st_state: the saved game, as JSON',
            'local x = 1',
            'function save(id, s)',
            '  -- remember the open tab',
            '  -- unrelated note about the code',
            "  setChatVar(id, 'st_tab', s.tab)",
            "  local hp = getChatVar(id, \"hp\") -- current hit points",
            "  setChatVar(id,'st_state',json.encode(s))",
            'end',
            "setChatVar(id, 'roll_'..n, '1')",
            "setState(id, 'flags', {})",
            "-- setChatVar(id, 'commented_out', '1')",
            "local s = [[ setChatVar(id, 'in_long_string', '1') ]]",
            '--[[ block',
            "setChatVar(id, 'in_block_comment', '1') ]]",
            "getChatVar(id, k)",
        ].join('\n')
        const vars = collectLuaVariables([{ label: 'main', code }], 'hp=10\nunused=yes')
        const byName = Object.fromEntries(vars.map(v => [v.name, v]))

        expect(Object.keys(byName).sort()).toEqual(['__flags', 'hp', 'roll_*', 'st_state', 'st_tab', 'unused'])
        expect(byName.st_tab).toMatchObject({ writes: 1, reads: 0, comment: '' })
        expect(byName.st_tab.uses[0]).toEqual({ source: 'main', line: 6, write: true })
        expect(byName.hp).toMatchObject({ reads: 1, comment: 'current hit points', defaultValue: '10' })
        expect(byName.st_state.comment).toBe('st_state: the saved game, as JSON')
        expect(byName['roll_*'].pattern).toBe(true)
        expect(byName.unused).toMatchObject({ reads: 0, writes: 0, defaultValue: 'yes' })
    })
})

describe('collectLuaVariables helpers', () => {
    it('follows helper functions that pass their parameter on as the key', () => {
        const code = [
            '-- Game state lives in the chat variable st_state.',
            'function ST.var(id,k)',
            '  local v=getChatVar(id,k)',
            "  return v=='null' and '' or v",
            'end',
            "local function pref(id,k,def) local v=ST.var(id,'pref_'..k) return v end",
            "function SH.setVar(id,k,v) setChatVar(id,SH.VAR..k,v) end",
            "ST.var(id,'st_state')",
            "pref(id,'theme','dark')",
            "SH.setVar(id,'now','x')",
        ].join('\n')
        const byName = Object.fromEntries(collectLuaVariables([{ label: 'main', code }]).map(v => [v.name, v]))
        expect(Object.keys(byName).sort()).toEqual(['pref_theme', 'st_state', '{SH.VAR}now'])
        expect(byName.st_state).toMatchObject({ reads: 1, writes: 0, comment: 'Game state lives in the chat variable st_state.' })
        expect(byName['{SH.VAR}now']).toMatchObject({ reads: 0, writes: 1 })
    })
})
