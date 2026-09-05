function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value, allowedKeys) {
    if (!isRecord(value)) return false
    const keys = Object.keys(value)
    return keys.length === allowedKeys.length
        && keys.every((key) => allowedKeys.includes(key))
}

function hasBoundedId(value) {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= 1_024
}

function hasBoundedName(value) {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= 512
}

function validEvidence(value, chatId) {
    return Array.isArray(value)
        && value.length <= 12
        && value.every((item) =>
            hasExactKeys(item, ['chatId', 'messageId'])
            && item.chatId === chatId
            && hasBoundedId(item.messageId)
        )
}

function validInquiryTokenBudget(value) {
    if (!isRecord(value)) return false
    const keys = Object.keys(value)
    if (!keys.includes('target') || !keys.includes('maximum')
        || keys.some((key) => ![
            'target', 'events', 'perSource', 'maximum',
        ].includes(key))) return false
    return keys.length >= 2 && keys.length <= 4
        && Number.isSafeInteger(value.target)
        && (value.events === undefined || (Number.isSafeInteger(value.events)
            && value.events >= 256
            && value.events <= value.maximum))
        && (value.perSource === undefined
            || (Number.isSafeInteger(value.perSource)
                && value.perSource >= 256
                && value.perSource <= value.maximum))
        && Number.isSafeInteger(value.maximum)
        && value.target >= 256
        && value.target <= value.maximum
}

function validSemanticMatches(value) {
    return Array.isArray(value)
        && value.length <= 32
        && value.every((match) =>
            hasExactKeys(match, ['documentId', 'score'])
            && hasBoundedId(match.documentId)
            && Number.isFinite(match.score)
            && match.score > 0
            && match.score <= 1
        )
}

function validEntityHints(value) {
    return Array.isArray(value)
        && value.length <= 12
        && value.every((hint) =>
            hasExactKeys(hint, ['kind', 'names'])
            && hint.kind === 'character'
            && Array.isArray(hint.names)
            && hint.names.length >= 1
            && hint.names.length <= 16
            && hint.names.every((name) => typeof name === 'string'
                && name.trim().length > 0
                && name.length <= 128)
        )
}

function validSourceMatches(value) {
    return Array.isArray(value)
        && value.length <= 32
        && value.every((match) =>
            hasExactKeys(match, [
                'messageId', 'role', 'content', 'score', 'occurredAt',
            ])
            && hasBoundedId(match.messageId)
            && (match.role === 'user' || match.role === 'assistant')
            && typeof match.content === 'string'
            && match.content.trim().length > 0
            && match.content.length <= 1_200
            && Number.isFinite(match.score)
            && match.score > 0
            && match.score <= 10_000
            && Number.isSafeInteger(match.occurredAt)
            && match.occurredAt >= 0
            && match.occurredAt <= 10_000_000
        )
}

function validRebootSources(body, includeGroups) {
    const groups = body?.eventSourceGroups
    return hasBoundedId(body?.characterId)
        && hasBoundedId(body?.chatId)
        && body.chatId.startsWith('reboot-')
        && Array.isArray(body.sourceMessageIds)
        && body.sourceMessageIds.length >= 1
        && body.sourceMessageIds.length <= 12
        && body.sourceMessageIds.every(hasBoundedId)
        && (!includeGroups || (Array.isArray(groups)
            && groups.length >= 1 && groups.length <= 2
            && groups.every((group) => Array.isArray(group)
                && group.length >= 1 && group.length <= 2
                && group.every(hasBoundedId))))
}

function validCanonicalReceipt(value) {
    return hasExactKeys(value, [
        'sourceMessageIds', 'eventIds', 'changes', 'warnings', 'recordedAt',
    ])
        && Array.isArray(value.sourceMessageIds)
        && value.sourceMessageIds.every(hasBoundedId)
        && Array.isArray(value.eventIds)
        && value.eventIds.every(hasBoundedId)
        && Array.isArray(value.warnings)
        && value.warnings.every((warning) => typeof warning === 'string')
        && typeof value.recordedAt === 'string'
        && Array.isArray(value.changes)
        && value.changes.every((change) => hasExactKeys(change, [
            'documentId', 'type', 'title', 'relativePath', 'action', 'afterHash',
        ])
            && hasBoundedId(change.documentId)
            && ['character', 'location', 'scene', 'faction', 'creature',
                'item', 'concept', 'other'].includes(change.type)
            && typeof change.title === 'string'
            && typeof change.relativePath === 'string'
            && (change.action === 'create' || change.action === 'update')
            && hasBoundedId(change.afterHash))
}

function createRisuBardMemoryJsonParser(express) {
    return express.json({ limit: '512kb', strict: true })
}

function requestHeader(req, name) {
    const value = req.headers?.[name]
    return typeof value === 'string' ? value : undefined
}

function decodeBoundedHeaderText(value) {
    if (typeof value !== 'string'
        || value.length === 0
        || value.length > 2_048
        || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    return decoded.length > 0 && decoded.length <= 512 ? decoded : undefined
}

function registerRisuBardMemoryRoutes(app, options) {
    app.post('/api/risubard/memory/save-slot', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            const characterId = requestHeader(
                req, 'x-risubard-character-id'
            )
            const sourceChatId = requestHeader(
                req, 'x-risubard-source-chat-id'
            )
            const saveId = requestHeader(req, 'x-risubard-save-id')
            const overwrite = requestHeader(req, 'x-risubard-save-overwrite')
            const sourceChatName = decodeBoundedHeaderText(requestHeader(
                req, 'x-risubard-chat-name'
            ))
            const turnCount = Number(requestHeader(
                req, 'x-risubard-turn-count'
            ))
            const latestMessageId = requestHeader(
                req, 'x-risubard-latest-message-id'
            )
            if (!hasBoundedId(characterId)
                || !hasBoundedId(sourceChatId)
                || !hasBoundedId(saveId)
                || (overwrite !== undefined && overwrite !== 'true')
                || !sourceChatName
                || !Number.isSafeInteger(turnCount)
                || turnCount < 0
                || (latestMessageId !== undefined
                    && !hasBoundedId(latestMessageId))
                || !Buffer.isBuffer(req.body)
                || req.body.byteLength === 0
                || req.body.byteLength > 100 * 1024 * 1024) {
                res.status(400).send({ error: 'Invalid memory save request' })
                return
            }
            res.send(await options.service.createMemorySave({
                characterId,
                sourceChatId,
                saveId,
                ...(overwrite === 'true' ? { overwrite: true } : {}),
                sourceChatName,
                turnCount,
                ...(latestMessageId ? { latestMessageId } : {}),
                chatBytes: req.body,
            }))
        }
        catch (error) {
            if (error instanceof Error
                && error.message === 'Memory fork destination already exists') {
                res.status(409).send({ error: error.message })
                return
            }
            next(error)
        }
    })

    app.post('/api/risubard/memory/save-slot/list', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, ['characterId', 'sourceChatId'])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.sourceChatId)) {
                res.status(400).send({ error: 'Invalid memory save list request' })
                return
            }
            res.send(await options.service.listMemorySaves(req.body))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/save-slot/preview', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, ['characterId', 'saveId'])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.saveId)) {
                res.status(400).send({ error: 'Invalid memory save preview request' })
                return
            }
            const bytes = await options.service.previewMemorySave(req.body)
            res.setHeader('content-type', 'application/octet-stream')
            res.send(bytes)
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/save-slot/rename', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, ['characterId', 'saveId', 'name'])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.saveId)
                || !hasBoundedName(req.body.name)) {
                res.status(400).send({ error: 'Invalid memory save rename request' })
                return
            }
            res.send(await options.service.renameMemorySave({
                ...req.body,
                name: req.body.name.trim(),
            }))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/save-slot/delete', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, ['characterId', 'saveId'])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.saveId)) {
                res.status(400).send({ error: 'Invalid memory save delete request' })
                return
            }
            await options.service.deleteMemorySave(req.body)
            res.status(204).send()
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/save-slot/load', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, [
                'characterId', 'saveId', 'destinationChatId',
            ])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.saveId)
                || !hasBoundedId(req.body.destinationChatId)) {
                res.status(400).send({ error: 'Invalid memory save load request' })
                return
            }
            const prepared = await options.service.prepareMemorySaveLoad(
                req.body
            )
            res.setHeader('content-type', 'application/octet-stream')
            res.setHeader(
                'x-risubard-fork-token', prepared.fork.forkToken
            )
            res.send(prepared.chatBytes)
        }
        catch (error) {
            if (error instanceof Error
                && error.message === 'Memory fork destination already exists') {
                res.status(409).send({ error: error.message })
                return
            }
            next(error)
        }
    })

    app.post('/api/risubard/memory/fork', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            const baseKeys = [
                'characterId', 'sourceChatId', 'destinationChatId', 'mode',
                ...(req.body?.destinationCharacterId
                    ? ['destinationCharacterId']
                    : []),
            ]
            const branch = req.body?.mode === 'branch'
            const validMessages = Array.isArray(req.body?.messageIds)
                && req.body.messageIds.length <= 10_000
                && req.body.messageIds.every(hasBoundedId)
                && new Set(req.body.messageIds).size
                    === req.body.messageIds.length
            const validRetained = validMessages
                && Array.isArray(req.body?.retainedMessageIds)
                && req.body.retainedMessageIds.length <= 10_000
                && req.body.retainedMessageIds.every(hasBoundedId)
                && new Set(req.body.retainedMessageIds).size
                    === req.body.retainedMessageIds.length
                && req.body.retainedMessageIds.length
                    <= req.body.messageIds.length
                && req.body.retainedMessageIds.every((id, index) =>
                    req.body.messageIds[index] === id
                )
            if (!hasExactKeys(req.body, [
                ...baseKeys,
                ...(branch ? ['retainedMessageIds', 'messageIds'] : []),
            ])
                || !hasBoundedId(req.body.characterId)
                || (req.body.destinationCharacterId !== undefined
                    && !hasBoundedId(req.body.destinationCharacterId))
                || !hasBoundedId(req.body.sourceChatId)
                || !hasBoundedId(req.body.destinationChatId)
                || req.body.sourceChatId === req.body.destinationChatId
                || !['copy', 'branch'].includes(req.body.mode)
                || (branch && !validRetained)
                || Buffer.byteLength(JSON.stringify(req.body), 'utf8')
                    > 512_000) {
                res.status(400).send({ error: 'Invalid memory fork request' })
                return
            }
            res.send(await options.service.forkMemory(req.body))
        }
        catch (error) {
            if (error instanceof Error
                && (error.message.startsWith('Memory fork conflict:')
                    || error.message
                        === 'Memory fork destination already exists')) {
                res.status(409).send({ error: error.message })
                return
            }
            next(error)
        }
    })

    app.post('/api/risubard/memory/reboot/replace', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, [
                'characterId', 'sourceChatId', 'destinationChatId',
            ])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.sourceChatId)
                || !req.body.sourceChatId.startsWith('reboot-')
                || !hasBoundedId(req.body.destinationChatId)
                || req.body.sourceChatId === req.body.destinationChatId) {
                res.status(400).send({ error: 'Invalid memory reboot replacement' })
                return
            }
            res.send(await options.service.replaceMemory(req.body))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/reboot/remove', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, ['characterId', 'chatId'])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || !req.body.chatId.startsWith('reboot-')) {
                res.status(400).send({ error: 'Invalid memory reboot cleanup' })
                return
            }
            res.send(await options.service.removeRebootMemory(req.body))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/wiki/reboot/recover', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            const groups = req.body?.eventSourceGroups
            if (!hasExactKeys(req.body, [
                'characterId', 'chatId', 'sourceMessageIds',
                'eventSourceGroups',
            ])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || !req.body.chatId.startsWith('reboot-')
                || !Array.isArray(req.body.sourceMessageIds)
                || req.body.sourceMessageIds.length < 1
                || req.body.sourceMessageIds.length > 12
                || !req.body.sourceMessageIds.every(hasBoundedId)
                || !Array.isArray(groups) || groups.length < 1 || groups.length > 2
                || !groups.every((group) => Array.isArray(group)
                    && group.length >= 1 && group.length <= 2
                    && group.every(hasBoundedId))) {
                res.status(400).send({ error: 'Invalid memory reboot recovery' })
                return
            }
            res.send(await options.service.recoverWikiRebootBatch(req.body))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/fork/complete', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, [
                'characterId', 'destinationChatId', 'forkToken', 'action',
            ])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.destinationChatId)
                || !hasBoundedId(req.body.forkToken)
                || !['finalize', 'discard'].includes(req.body.action)) {
                res.status(400).send({
                    error: 'Invalid memory fork completion request',
                })
                return
            }
            res.send(await options.service.completeMemoryFork(req.body))
        }
        catch (error) {
            if (error instanceof Error
                && error.message.startsWith('Memory fork')) {
                res.status(409).send({ error: error.message })
                return
            }
            next(error)
        }
    })

    app.post('/api/risubard/memory/inquiry', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            const inquiryKeys = [
                'characterId',
                'chatId',
                'currentInput',
            ]
            const validShape = hasExactKeys(req.body, [
                ...inquiryKeys,
                ...(req.body.tokenBudget === undefined
                    ? []
                    : ['tokenBudget']),
                ...(req.body.semanticMatches === undefined
                    ? []
                    : ['semanticMatches']),
                ...(req.body.entityHints === undefined
                    ? []
                    : ['entityHints']),
                ...(req.body.sourceMatches === undefined
                    ? []
                    : ['sourceMatches']),
                ...(req.body.sourceLimit === undefined
                    ? []
                    : ['sourceLimit']),
            ])
            if (!validShape
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || typeof req.body.currentInput !== 'string'
                || req.body.currentInput.trim().length === 0
                || req.body.currentInput.length > 4_096
                || (req.body.tokenBudget !== undefined
                    && !validInquiryTokenBudget(req.body.tokenBudget))
                || (req.body.semanticMatches !== undefined
                    && !validSemanticMatches(req.body.semanticMatches))
                || (req.body.entityHints !== undefined
                    && !validEntityHints(req.body.entityHints))
                || (req.body.sourceMatches !== undefined
                    && !validSourceMatches(req.body.sourceMatches))
                || (req.body.sourceLimit !== undefined
                    && (!Number.isSafeInteger(req.body.sourceLimit)
                        || req.body.sourceLimit < 0
                        || req.body.sourceLimit > 32))
                || Buffer.byteLength(JSON.stringify(req.body), 'utf8')
                    > 256 * 1_024) {
                res.status(400).send({
                    error: 'Invalid narrative inquiry request',
                })
                return
            }
            res.send(await options.service.inquireNarrative(req.body))
        }
        catch (error) {
            next(error)
        }
    })

    app.post(
        '/api/risubard/memory/analysis/observe',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId',
                    'chatId',
                    'status',
                    'appliedCount',
                ])
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || (req.body.status !== 'success'
                        && req.body.status !== 'failed')
                    || !Number.isSafeInteger(req.body.appliedCount)
                    || req.body.appliedCount < 0
                    || req.body.appliedCount > 128) {
                    res.status(400).send({
                        error: 'Invalid memory analysis observation',
                    })
                    return
                }
                await options.service.recordGraphAnalysis(
                    req.body.characterId,
                    req.body.chatId,
                    {
                        status: req.body.status,
                        appliedCount: req.body.appliedCount,
                    }
                )
                res.send({ ok: true })
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post('/api/risubard/memory/view', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, ['characterId', 'chatId'])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)) {
                res.status(400).send({ error: 'Invalid memory view request' })
                return
            }
            res.send(await options.service.loadView(
                req.body.characterId,
                req.body.chatId
            ))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/wiki/replace', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, [
                'characterId', 'chatId', 'find', 'replacement',
            ])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || typeof req.body.find !== 'string'
                || req.body.find.length === 0
                || req.body.find.length > 256
                || typeof req.body.replacement !== 'string'
                || req.body.replacement.length > 256) {
                res.status(400).send({ error: 'Invalid wiki replacement' })
                return
            }
            res.send(await options.service.replaceWikiText(req.body))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/wiki/save', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            const keys = [
                'characterId',
                'chatId',
                'sourceMessageIds',
                'markdown',
            ]
            const optionalKeys = ['append', 'writingLanguage']
                .filter((key) => req.body?.[key] !== undefined)
            if (!hasExactKeys(req.body, [...keys, ...optionalKeys])
                || (req.body.writingLanguage !== undefined && !['ko', 'en', 'ja'].includes(req.body.writingLanguage))
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || !Array.isArray(req.body.sourceMessageIds)
                || req.body.sourceMessageIds.length < 1
                || !req.body.sourceMessageIds.every(hasBoundedId)
                || typeof req.body.markdown !== 'string'
                || req.body.markdown.trim().length === 0
                || req.body.markdown.length > 12_000
                || (req.body.append !== undefined
                    && typeof req.body.append !== 'boolean')) {
                res.status(400).send({ error: 'Invalid Markdown wiki update' })
                return
            }
            res.send(await options.service.saveMarkdownWikiTurn(req.body))
        }
        catch (error) {
            next(error)
        }
    })

    app.post(
        '/api/risubard/memory/wiki/document/save',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                const keys = [
                    'characterId',
                    'chatId',
                    'type',
                    'title',
                    'sourceMessageIds',
                    'markdown',
                ]
                const optionalKeys = [
                    'documentId', 'expectedContentHash', 'reviewStatus',
                    'writingLanguage', 'aliases',
                ].filter((key) => req.body?.[key] !== undefined)
                const validShape = hasExactKeys(req.body, [
                    ...keys, ...optionalKeys,
                ])
                if (!validShape
                    || (req.body.writingLanguage !== undefined && !['ko', 'en', 'ja'].includes(req.body.writingLanguage))
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || (req.body.documentId !== undefined
                        && !hasBoundedId(req.body.documentId))
                    || (req.body.expectedContentHash !== undefined
                        && !hasBoundedId(req.body.expectedContentHash))
                    || (req.body.reviewStatus !== undefined
                        && !['unreviewed', 'reviewed'].includes(
                            req.body.reviewStatus
                        ))
                    || ![
                        'character', 'location', 'scene', 'faction', 'creature',
                        'item', 'concept', 'other',
                    ].includes(req.body.type)
                    || typeof req.body.title !== 'string'
                    || req.body.title.trim().length === 0
                    || req.body.title.length > 160
                    || (req.body.aliases !== undefined
                        && (!Array.isArray(req.body.aliases)
                            || req.body.aliases.length > 32
                            || !req.body.aliases.every((alias) =>
                                typeof alias === 'string'
                                && alias.trim().length > 0
                                && alias.length <= 160)))
                    || !Array.isArray(req.body.sourceMessageIds)
                    || req.body.sourceMessageIds.length < 1
                    || !req.body.sourceMessageIds.every(hasBoundedId)
                    || typeof req.body.markdown !== 'string'
                    || req.body.markdown.trim().length === 0
                    || req.body.markdown.length > 12_000) {
                    res.status(400).send({
                        error: 'Invalid canonical Markdown wiki update',
                    })
                    return
                }
                res.send(await options.service.saveCanonicalWikiDocument(
                    req.body
                ))
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post(
        '/api/risubard/memory/wiki/document/manual-save',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                const keys = [
                    'characterId', 'chatId', 'type', 'title', 'markdown',
                ]
                const optionalKeys = [
                    'documentId', 'expectedContentHash', 'aliases',
                ].filter((key) => req.body?.[key] !== undefined)
                const validShape = hasExactKeys(req.body, [
                    ...keys, ...optionalKeys,
                ])
                if (!validShape
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || (req.body.documentId !== undefined
                        && !hasBoundedId(req.body.documentId))
                    || (req.body.expectedContentHash !== undefined
                        && !hasBoundedId(req.body.expectedContentHash))
                    || ![
                        'character', 'location', 'scene', 'faction', 'creature',
                        'item', 'concept', 'other', 'event',
                    ].includes(req.body.type)
                    || (req.body.type === 'event'
                        && req.body.documentId === undefined)
                    || typeof req.body.title !== 'string'
                    || req.body.title.trim().length === 0
                    || req.body.title.length > 160
                    || (req.body.aliases !== undefined
                        && (!Array.isArray(req.body.aliases)
                            || req.body.aliases.length > 32
                            || !req.body.aliases.every((alias) =>
                                typeof alias === 'string'
                                && alias.trim().length > 0
                                && alias.length <= 160)))
                    || typeof req.body.markdown !== 'string'
                    || req.body.markdown.trim().length === 0
                    || req.body.markdown.length > 12_000) {
                    res.status(400).send({
                        error: 'Invalid manual Markdown wiki update',
                    })
                    return
                }
                res.send(await options.service.saveManualWikiDocument(
                    req.body
                ))
            }
            catch (error) {
                next(error)
            }
        }
    )

    for (const [action, method] of [
        ['begin', 'beginBardChatUndo'],
        ['finalize', 'finalizeBardChatUndo'],
        ['status', 'getBardChatUndoStatus'],
        ['restore', 'restoreBardChatUndo'],
    ]) {
        app.post(
            `/api/risubard/memory/wiki/bardchat-undo/${action}`,
            async (req, res, next) => {
                try {
                    if (!await options.auth(req, res)) return
                    if (!hasExactKeys(req.body, ['characterId', 'chatId'])
                        || !hasBoundedId(req.body.characterId)
                        || !hasBoundedId(req.body.chatId)) {
                        res.status(400).send({
                            error: 'Invalid BARDCHAT undo request',
                        })
                        return
                    }
                    res.send(await options.service[method](req.body))
                }
                catch (error) {
                    next(error)
                }
            }
        )
    }

    app.post(
        '/api/risubard/memory/wiki/document/review',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId', 'chatId', 'documentId', 'action',
                    'expectedContentHash',
                ])
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || !hasBoundedId(req.body.documentId)
                    || !['accept', 'revert'].includes(req.body.action)
                    || !hasBoundedId(req.body.expectedContentHash)) {
                    res.status(400).send({
                        error: 'Invalid canonical Markdown wiki review',
                    })
                    return
                }
                res.send(await options.service
                    .reviewCanonicalWikiDocument(req.body))
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post(
        '/api/risubard/memory/wiki/document/context-mode',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId', 'chatId', 'documentId', 'contextMode',
                    'expectedContentHash',
                ])
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || !hasBoundedId(req.body.documentId)
                    || !['always', 'auto', 'never'].includes(
                        req.body.contextMode
                    )
                    || !hasBoundedId(req.body.expectedContentHash)) {
                    res.status(400).send({
                        error: 'Invalid Markdown wiki context-mode request',
                    })
                    return
                }
                res.send(await options.service.setWikiDocumentContextMode(
                    req.body
                ))
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post(
        '/api/risubard/memory/wiki/event/retract-sources',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId', 'chatId', 'sourceMessageIds',
                ])
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || !Array.isArray(req.body.sourceMessageIds)
                    || req.body.sourceMessageIds.length === 0
                    || !req.body.sourceMessageIds.every(hasBoundedId)) {
                    res.status(400).send({
                        error: 'Invalid Markdown wiki source retraction request',
                    })
                    return
                }
                res.send(await options.service
                    .retractWikiEventsBySourceMessages(req.body))
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post(
        '/api/risubard/memory/wiki/event/retract',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId', 'chatId', 'documentId',
                    'expectedContentHash',
                ])
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || !hasBoundedId(req.body.documentId)
                    || !hasBoundedId(req.body.expectedContentHash)) {
                    res.status(400).send({
                        error: 'Invalid Markdown wiki event retraction request',
                    })
                    return
                }
                res.send(await options.service.retractWikiEvent(req.body))
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post(
        '/api/risubard/memory/wiki/document/trash',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId', 'chatId', 'documentId',
                ])
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || !hasBoundedId(req.body.documentId)) {
                    res.status(400).send({
                        error: 'Invalid Markdown wiki trash request',
                    })
                    return
                }
                res.send(await options.service.trashWikiDocument(req.body))
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post(
        '/api/risubard/memory/wiki/document/reveal',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId', 'chatId', 'documentId',
                ])
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || !hasBoundedId(req.body.documentId)) {
                    res.status(400).send({
                        error: 'Invalid Markdown wiki reveal request',
                    })
                    return
                }
                res.send(await options.service.revealWikiDocument(req.body))
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post(
        '/api/risubard/memory/wiki/reboot/begin',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId', 'chatId', 'sourceMessageIds',
                    'eventSourceGroups',
                ])
                    || !validRebootSources(req.body, true)) {
                    res.status(400).send({
                        error: 'Invalid Markdown wiki reboot begin request',
                    })
                    return
                }
                res.send(await options.service.beginWikiRebootBatch(req.body))
            }
            catch (error) {
                if (error instanceof Error
                    && error.message.startsWith(
                        'Wiki reboot recovery conflict:'
                    )) {
                    res.status(409).send({ error: error.message })
                    return
                }
                next(error)
            }
        }
    )

    app.post(
        '/api/risubard/memory/wiki/reboot/record',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId', 'chatId', 'receipt',
                ])
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)
                    || !req.body.chatId.startsWith('reboot-')
                    || !validCanonicalReceipt(req.body.receipt)) {
                    res.status(400).send({
                        error: 'Invalid Markdown wiki reboot receipt',
                    })
                    return
                }
                res.send(await options.service.recordWikiRebootBatch(req.body))
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post(
        '/api/risubard/memory/wiki/reboot/complete',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, [
                    'characterId', 'chatId', 'sourceMessageIds',
                ]) || !validRebootSources(req.body, false)) {
                    res.status(400).send({
                        error: 'Invalid Markdown wiki reboot completion',
                    })
                    return
                }
                res.send(await options.service.completeWikiRebootBatch(req.body))
            }
            catch (error) {
                if (error instanceof Error
                    && error.message.startsWith(
                        'Wiki reboot recovery conflict:'
                    )) {
                    res.status(409).send({ error: error.message })
                    return
                }
                next(error)
            }
        }
    )

    app.post('/api/risubard/memory/state', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, ['characterId', 'chatId'])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)) {
                res.status(400).send({ error: 'Invalid memory state request' })
                return
            }
            res.send(await options.service.loadState(
                req.body.characterId,
                req.body.chatId
            ))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/apply', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(
                req.body,
                [
                    'characterId',
                    'chatId',
                    'delta',
                    'availableEvidence',
                ]
            )
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || !isRecord(req.body.delta)
                || !Array.isArray(req.body.delta.operations)
                || req.body.delta.operations.length > 128
                || !validEvidence(
                    req.body.availableEvidence,
                    req.body.chatId
                )
                || Buffer.byteLength(
                    JSON.stringify(req.body),
                    'utf8'
                ) > 512_000) {
                res.status(400).send({ error: 'Invalid memory update request' })
                return
            }
            res.send(await options.service.applyDelta(req.body))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/graph/state', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, ['characterId', 'chatId'])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)) {
                res.status(400).send({
                    error: 'Invalid narrative graph state request',
                })
                return
            }
            res.send(await options.service.loadGraphState(
                req.body.characterId,
                req.body.chatId
            ))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/graph/apply', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(
                req.body,
                [
                    'characterId',
                    'chatId',
                    'delta',
                    'availableEvidence',
                ]
            )
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || !isRecord(req.body.delta)
                || req.body.delta.schemaVersion !== 2
                || req.body.delta.storyId !== req.body.characterId
                || req.body.delta.branchId !== req.body.chatId
                || !Array.isArray(req.body.delta.operations)
                || req.body.delta.operations.length > 128
                || !validEvidence(
                    req.body.availableEvidence,
                    req.body.chatId
                )
                || Buffer.byteLength(
                    JSON.stringify(req.body),
                    'utf8'
                ) > 512_000) {
                res.status(400).send({
                    error: 'Invalid narrative graph update request',
                })
                return
            }
            const state = await options.service.applyGraphDelta(req.body)
            res.send({ revision: state.revision })
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/writer/apply', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(
                req.body,
                [
                    'characterId',
                    'chatId',
                    'expectedRevision',
                    'command',
                ]
            )
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || !Number.isSafeInteger(req.body.expectedRevision)
                || req.body.expectedRevision < 0
                || !isRecord(req.body.command)
                || Buffer.byteLength(JSON.stringify(req.body), 'utf8')
                    > 64 * 1_024) {
                res.status(400).send({
                    error: 'Invalid RisuBard writer command request',
                })
                return
            }
            const receipt = await options.service.applyWriterCommand(req.body)
            res.send({ revision: receipt.revision })
        }
        catch (error) {
            if (error instanceof Error
                && error.message === 'Writer graph revision is stale') {
                res.status(409).send({
                    error: 'Writer graph revision is stale',
                })
                return
            }
            next(error)
        }
    })

    app.post(
        '/api/risubard/memory/graph/reconcile',
        async (req, res, next) => {
            try {
                if (!await options.auth(req, res)) return
                if (!hasExactKeys(req.body, ['characterId', 'chatId'])
                    || !hasBoundedId(req.body.characterId)
                    || !hasBoundedId(req.body.chatId)) {
                    res.status(400).send({
                        error: 'Invalid narrative graph reconciliation request',
                    })
                    return
                }
                const state = await options.service.reconcileGraphV1(
                    req.body.characterId,
                    req.body.chatId
                )
                res.send({ revision: state.revision })
            }
            catch (error) {
                next(error)
            }
        }
    )

    app.post('/api/risubard/memory/source', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(
                req.body,
                ['characterId', 'chatId', 'snapshot']
            )
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || !isRecord(req.body.snapshot)
                || Buffer.byteLength(JSON.stringify(req.body), 'utf8')
                    > 512_000) {
                res.status(400).send({ error: 'Invalid source snapshot request' })
                return
            }
            res.send(await options.service.ensureSourceSnapshot(
                req.body.characterId,
                req.body.chatId,
                req.body.snapshot
            ))
        }
        catch (error) {
            next(error)
        }
    })

    app.post('/api/risubard/memory/baseline', async (req, res, next) => {
        try {
            if (!await options.auth(req, res)) return
            if (!hasExactKeys(req.body, ['characterId', 'chatId', 'summary'])
                || !hasBoundedId(req.body.characterId)
                || !hasBoundedId(req.body.chatId)
                || typeof req.body.summary !== 'string'
                || req.body.summary.trim().length === 0
                || req.body.summary.length > 12_000) {
                res.status(400).send({ error: 'Invalid baseline request' })
                return
            }
            res.send({
                summary: await options.service.saveSourceBaseline(
                    req.body.characterId,
                    req.body.chatId,
                    req.body.summary
                ),
            })
        }
        catch (error) {
            next(error)
        }
    })
}

module.exports = {
    createRisuBardMemoryJsonParser,
    registerRisuBardMemoryRoutes,
}
