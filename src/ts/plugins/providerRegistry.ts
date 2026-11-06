// Plugins may call addProvider again for a name they already registered
// (for example after their own settings change). Re-registration replaces
// the previous entry instead of appending a duplicate to the model lists.

export function withProviderName(names: string[], name: string): string[] {
    return names.includes(name) ? names : [...names, name]
}

export function upsertProviderModel<T extends { id: string }>(models: T[], model: T): void {
    const index = models.findIndex((existing) => existing.id === model.id)
    if (index === -1) models.push(model)
    else models[index] = model
}
