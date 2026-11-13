import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MCPTool } from './mcplib';

const state = vi.hoisted(() => ({
    urls: [] as string[],
    httpClients: [] as any[],
}));

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => ({}) }));
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { authRefreshes: [] } } }));
vi.mock('../modules', () => ({ getModuleMcps: () => [...state.urls] }));
vi.mock('src/ts/alert', () => ({}));
vi.mock('src/ts/util', () => ({}));
vi.mock('src/ts/storage/persistentKv', () => ({}));
vi.mock('./mcplib', () => ({
    MCPClient: class {
        serverInfo = { serverInfo: { name: 'HTTP MCP', version: '1' } };
        checkHandshake = vi.fn(async () => this.serverInfo);
        getToolList = vi.fn(async () => [{ name: 'http-tool', inputSchema: { type: 'object' } }]);
        callTool = vi.fn(async () => [{ type: 'text', text: 'http-result' }]);
        destroy = vi.fn();
        constructor(public url: string) {
            state.httpClients.push(this);
        }
    },
}));

import { MCPs, callMCPTool, getMCPMeta, getTools, initializeMCPs } from './mcp';
import { registeredCustomPluginMCPs, registerMCPModule, unregisterMCPModule } from './pluginmcp';

const pluginId = 'plugin:reload-test';

async function registerPlugin(version: string) {
    const getToolList = vi.fn(async (): Promise<MCPTool[]> => [{
        name: `${version}-tool`,
        description: version,
        inputSchema: { type: 'object' },
    }]);
    const callTool = vi.fn(async () => [{ type: 'text' as const, text: `${version}-result` }]);
    await registerMCPModule({
        identifier: pluginId,
        name: 'Reload test',
        version,
        description: '',
    }, getToolList, callTool);
    const client = registeredCustomPluginMCPs.get(pluginId)!;
    const handshake = vi.spyOn(client, 'checkHandshake');
    const destroy = vi.spyOn(client, 'destroy');
    return { client, getToolList, callTool, handshake, destroy };
}

beforeEach(() => {
    registeredCustomPluginMCPs.clear();
    for(const key of Object.keys(MCPs)) delete MCPs[key];
    state.urls = [pluginId];
    state.httpClients = [];
});

describe('plugin MCP lifecycle', () => {
    it('uses replacement callbacks and metadata when the identifier stays the same', async () => {
        const old = await registerPlugin('old');
        await initializeMCPs();
        const current = await registerPlugin('current');

        expect((await getTools()).map(tool => tool.name)).toEqual(['current-tool']);
        expect((await getMCPMeta())[pluginId].serverInfo.version).toBe('current');
        expect(await callMCPTool('current-tool', { input: 'value' })).toEqual([
            { type: 'text', text: 'current-result' },
        ]);
        expect(current.callTool).toHaveBeenCalledWith('current-tool', { input: 'value' });
        expect(MCPs[pluginId]).toBe(current.client);
        expect(old.getToolList).not.toHaveBeenCalled();
        expect(old.callTool).not.toHaveBeenCalled();
        expect(old.destroy).toHaveBeenCalledOnce();
        expect(current.handshake).toHaveBeenCalledOnce();
    });

    it('does not invoke a disposed callback after unregistering and registering again', async () => {
        const old = await registerPlugin('old');
        await initializeMCPs();
        old.getToolList.mockRejectedValue(new Error('The old sandbox was disposed'));
        await unregisterMCPModule(pluginId);
        const current = await registerPlugin('current');

        expect((await getTools()).map(tool => tool.name)).toEqual(['current-tool']);
        expect(MCPs[pluginId]).toBe(current.client);
        expect(old.getToolList).not.toHaveBeenCalled();
    });

    it('stops exposing and calling unregistered tools even when the module remains active', async () => {
        const old = await registerPlugin('old');
        await initializeMCPs();
        await unregisterMCPModule(pluginId);

        expect(await getTools()).toEqual([]);
        expect(await getMCPMeta()).toEqual({});
        expect(await callMCPTool('old-tool', {})).toEqual([
            { type: 'text', text: 'Tool old-tool not found on any MCP' },
        ]);
        expect(MCPs[pluginId]).toBeUndefined();
        expect(old.getToolList).not.toHaveBeenCalled();
        expect(old.callTool).not.toHaveBeenCalled();
        expect(old.destroy).toHaveBeenCalledOnce();
        expect(state.httpClients).toHaveLength(0);
    });

    it('retains an unchanged plugin client and removes it when its module is disabled', async () => {
        const current = await registerPlugin('current');
        await initializeMCPs();
        await getTools();
        expect(current.handshake).toHaveBeenCalledOnce();
        expect(current.destroy).not.toHaveBeenCalled();

        state.urls = [];
        expect(await getTools()).toEqual([]);
        expect(MCPs[pluginId]).toBeUndefined();
        expect(current.destroy).toHaveBeenCalledOnce();
    });

    it('initializes and reuses HTTP MCP clients alongside plugin reloads', async () => {
        const url = 'https://mcp.example.test/tools';
        state.urls = [pluginId, url];
        await registerPlugin('old');
        await initializeMCPs();
        const http = state.httpClients[0];
        await unregisterMCPModule(pluginId);
        await registerPlugin('current');

        expect((await getTools()).map(tool => tool.name).sort()).toEqual(['current-tool', 'http-tool']);
        expect(state.httpClients).toHaveLength(1);
        expect(http.url).toBe(url);
        expect(http.checkHandshake).toHaveBeenCalledOnce();
        expect(MCPs[url]).toBe(http);
        expect(await callMCPTool('http-tool', {})).toEqual([{ type: 'text', text: 'http-result' }]);
        expect(http.destroy).not.toHaveBeenCalled();
    });
});
