function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Gemini's responseSchema/response_schema is an OpenAPI subset: it rejects
// `$schema`, `additionalProperties`, `oneOf` and `const` as unknown fields.
export function toGeminiResponseSchema(
    value: unknown,
    preserveAdditionalProperties = false,
): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => toGeminiResponseSchema(
            item,
            preserveAdditionalProperties,
        ))
    }
    if (!isRecord(value)) return value

    const converted: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
        if (key === '$schema'
            || (key === 'additionalProperties' && !preserveAdditionalProperties)) continue
        if (key === 'oneOf') {
            converted.anyOf = toGeminiResponseSchema(
                item,
                preserveAdditionalProperties,
            )
            continue
        }
        // The OpenAPI subset takes one type: `["integer", "null"]` is rejected
        // as "Proto field is not repeating", so write it as `nullable`.
        // (responseJsonSchema, which preserves additionalProperties, takes arrays.)
        if (key === 'type' && Array.isArray(item) && !preserveAdditionalProperties) {
            const types = item.filter((type) => type !== 'null')
            if (types.length !== item.length) converted.nullable = true
            if (types.length === 1) converted.type = types[0]
            else if (types.length > 1) converted.anyOf = types.map((type) => ({ type }))
            continue
        }
        if (key === 'const') {
            if (typeof item === 'string') {
                converted.type = 'string'
                converted.enum = [item]
            }
            else if (Number.isSafeInteger(item)) {
                converted.type = 'integer'
                converted.minimum = item
                converted.maximum = item
            }
            else if (typeof item === 'number') {
                converted.type = 'number'
                converted.minimum = item
                converted.maximum = item
            }
            else if (typeof item === 'boolean') converted.type = 'boolean'
            continue
        }
        converted[key] = toGeminiResponseSchema(
            item,
            preserveAdditionalProperties,
        )
    }
    return converted
}
