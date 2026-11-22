import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('index.html cache policy', () => {
    it('serves the unhashed entry document with revalidation', () => {
        const server = fs.readFileSync('server/node/server.cjs', 'utf8')
        const start = server.indexOf("app.get('/', async (req, res, next) => {")
        expect(start).toBeGreaterThan(-1)
        const handler = server.slice(start, server.indexOf('\n})', start))
        const header = handler.indexOf("res.set('Cache-Control', 'no-cache')")
        expect(header).toBeGreaterThan(-1)
        expect(header).toBeLessThan(handler.indexOf('res.send(root.toString())'))
    })
})
