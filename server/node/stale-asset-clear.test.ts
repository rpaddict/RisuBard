import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('missing hashed asset response', () => {
    const server = fs.readFileSync('server/node/server.cjs', 'utf8')
    const hook = server.indexOf("res.set('Clear-Site-Data', '\"cache\"')")

    it('clears the browser cache before the generic static fallback', () => {
        const assetsStatic = server.indexOf("app.use('/assets', express.static(")
        const distStatic = server.indexOf("app.use(express.static(path.join(process.cwd(), 'dist')")
        expect(hook).toBeGreaterThan(assetsStatic)
        expect(hook).toBeLessThan(distStatic)
    })

    it('only targets Vite hashed chunk names', () => {
        const source = server.slice(server.lastIndexOf("app.use('/assets', (req, res, next) => {", hook), hook)
        const pattern = new RegExp(/\.test\(req\.path\)/.exec(source) ? /if \(!\/(.+)\/\.test\(req\.path\)\)/.exec(source)![1] : '$^')
        expect(pattern.test('/Settings-CVdSoWRj.css')).toBe(true)
        expect(pattern.test('/main-C_mHtMbL.js')).toBe(true)
        expect(pattern.test('/logo.png')).toBe(false)
        expect(pattern.test('/fonts/x-CVdSoWRj.css')).toBe(false)
    })
})
