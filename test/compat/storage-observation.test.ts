import { afterAll, describe, expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from './helpers/client.js'
import { createSeedBackup } from './helpers/seed.js'
import { spawnServer, type ServerHandle } from './helpers/spawnServer.js'

const servers: ServerHandle[] = []

afterAll(async () => {
  await Promise.allSettled(servers.map(server => server.cleanup()))
})

async function waitForRows(logFile: string, predicate: (rows: any[]) => boolean): Promise<any[]> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      const rows = (await readFile(logFile, 'utf8')).trim().split(/\r?\n/)
        .filter(Boolean).map(line => JSON.parse(line))
      if (predicate(rows)) return rows
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for storage observation rows')
}

describe('storage observation phase', () => {
  test('records a real compatibility persist without user content', async () => {
    const server = await spawnServer()
    servers.push(server)
    const client = await createClient(server.port, server.password)
    const sessionId = 'storage-observation-test'

    expect((await client.importBackup(createSeedBackup({
      characterCount: 2,
      chatsPerCharacter: 2,
      messagesPerChat: 3,
    }))).ok).toBe(true)

    const sessionResponse = await client.fetch('/api/session', {
      method: 'POST',
      headers: { 'x-session-id': sessionId },
    })
    expect(sessionResponse.ok).toBe(true)
    const sessionCookie = sessionResponse.headers.get('set-cookie')?.split(';', 1)[0]
    expect(sessionCookie).toBeTruthy()

    const readResponse = await client.fetch('/api/read', {
      headers: {
        'file-path': Buffer.from('database/database.bin', 'utf8').toString('hex'),
        'x-session-id': sessionId,
      },
    })
    expect(readResponse.ok).toBe(true)
    const strippedDatabase = Buffer.from(await readResponse.arrayBuffer())

    const fullWriteResponse = await client.fetch('/api/write', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'file-path': Buffer.from('database/database.bin', 'utf8').toString('hex'),
        'x-session-id': sessionId,
        'x-user-active': '1',
      },
      body: strippedDatabase,
    })
    expect(fullWriteResponse.ok).toBe(true)

    const chatResponse = await client.fetch('/api/chat-content/test-char-0/0', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': sessionId,
        'x-user-active': '1',
        'x-chat-id': 'chat-0-0',
      },
      body: JSON.stringify({
        id: 'chat-0-0',
        name: 'Chat 0',
        message: [{ role: 'user', data: 'private sentinel that must stay out of logs' }],
        localLore: [],
      }),
    })
    expect(chatResponse.ok).toBe(true)

    const flushResponse = await client.fetch('/api/db/flush', {
      method: 'POST',
      headers: { cookie: sessionCookie!, 'x-session-id': sessionId },
    })
    expect(flushResponse.ok).toBe(true)

    const rows = await waitForRows(
      path.join(server.cwd, 'save', 'logs', 'storage-observation.jsonl'),
      entries => ['full-write', 'flush'].every(trigger => entries.some(
        row => row.kind === 'compatibility-persist' && row.trigger === trigger,
      )),
    )
    const persist = rows.find(row => row.kind === 'compatibility-persist' && row.trigger === 'flush')
    const canonical = rows.find(row => row.kind === 'canonical-sync' && row.operationId === persist.operationId)

    expect(persist).toMatchObject({
      outcome: 'success',
      characterCount: 2,
      chatCount: 4,
      messageCount: 10,
    })
    expect(persist.databaseBytes).toBeGreaterThan(0)
    expect(canonical).toMatchObject({ outcome: 'success' })
    expect(canonical.plannedFiles).toBeGreaterThan(0)
    expect(canonical.publishedFiles + canonical.skippedFiles).toBe(canonical.plannedFiles)
    expect(rows.some(row => row.kind === 'compatibility-persist' && row.trigger === 'full-write'
      && row.outcome === 'success')).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('private sentinel')
  })
})
