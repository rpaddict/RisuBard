<script lang="ts">
    // Fork, copy and delete under each message, shared by the assistant docks.
    import { onDestroy } from 'svelte'
    import { CheckIcon, CopyIcon, GitBranchIcon, TrashIcon } from '@lucide/svelte'
    import { copyAssistantText, type AssistantChatMessage } from 'src/ts/risubard/assistantChat'

    interface Props {
        message: AssistantChatMessage
        /** True while a reply is streaming; fork and delete wait for it. */
        busy: boolean
        onFork: (message: AssistantChatMessage) => void
        onDelete: (message: AssistantChatMessage) => void
        onCopyFailed: () => void
    }

    let { message, busy, onFork, onDelete, onCopyFailed }: Props = $props()

    let copied = $state(false)
    let timer: ReturnType<typeof setTimeout> | undefined

    async function copy() {
        try {
            await copyAssistantText(message.text)
            copied = true
            clearTimeout(timer)
            timer = setTimeout(() => { copied = false }, 1600)
        }
        catch {
            onCopyFailed()
        }
    }

    onDestroy(() => clearTimeout(timer))
</script>

<div class="message-actions" data-message-actions>
    <button type="button" disabled={busy} title={message.role === 'user' ? '이 질문 직전까지 새 프로젝트로 복사하고, 질문은 입력창에 넣습니다' : '이 답변까지 새 프로젝트로 복사합니다'} onclick={() => onFork(message)} data-message-fork>
        <GitBranchIcon size={13} /> 여기서 포크하기
    </button>
    {#if message.role === 'assistant' && !message.failed}
        <button type="button" class:done={copied} onclick={() => void copy()} data-message-copy>
            {#if copied}<CheckIcon size={13} /> 복사됨{:else}<CopyIcon size={13} /> 답변 복사{/if}
        </button>
    {/if}
    <button type="button" class="danger" disabled={busy} onclick={() => onDelete(message)} data-message-delete>
        <TrashIcon size={13} /> 삭제
    </button>
</div>

<style>
    .message-actions {
        display: flex;
        flex-wrap: wrap;
        gap: .15rem .35rem;
        margin-left: -.35rem;
    }
    :global(.message.user) > .message-actions { margin-top: .1rem; }
    .message-actions button {
        display: inline-flex;
        align-items: center;
        gap: .28rem;
        min-height: 1.7rem;
        padding: 0 .4rem;
        border: 0;
        border-radius: calc(var(--risu-radius-sm) * 1.2);
        color: var(--risu-theme-textcolor2);
        background: transparent;
        font-size: .68rem;
        font-weight: 600;
        cursor: pointer;
    }
    .message-actions button:hover:not(:disabled),
    .message-actions button:focus-visible {
        color: var(--risu-theme-textcolor);
        background: color-mix(in srgb, var(--risu-theme-primary) 8%, transparent);
        outline: 0;
    }
    .message-actions button.done { color: var(--risu-theme-primary); }
    .message-actions button.danger:hover:not(:disabled),
    .message-actions button.danger:focus-visible { color: var(--risu-theme-draculared); }
    .message-actions button:disabled { cursor: not-allowed; opacity: .42; }
</style>
