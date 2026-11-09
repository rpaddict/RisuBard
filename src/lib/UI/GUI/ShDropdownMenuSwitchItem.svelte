<script lang="ts">
    // Dropdown menu row that flips a setting in place. The menu stays open so
    // the user sees the new state; the switch is a visual mirror of `checked`.
    import { DropdownMenu } from 'bits-ui';
    import type { Snippet } from 'svelte';
    import { cn } from 'src/lib/utils';

    interface Props {
        checked: boolean;
        onCheckedChange: (checked: boolean) => void;
        disabled?: boolean;
        title?: string;
        class?: string;
        children?: Snippet;
    }

    let { checked, onCheckedChange, disabled = false, title, class: className, children }: Props = $props();
</script>

<DropdownMenu.CheckboxItem
    data-slot="dropdown-menu-switch-item"
    {checked}
    {onCheckedChange}
    {disabled}
    {title}
    closeOnSelect={false}
    class={cn(
        'relative flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm select-none outline-hidden transition-colors ' +
        'data-highlighted:bg-selected data-highlighted:text-textcolor ' +
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        className
    )}
>
    <span class="min-w-0">{@render children?.()}</span>
    <span
        aria-hidden="true"
        data-skin-part="switch"
        class={cn(
            'relative inline-flex h-[18.4px] w-[32px] shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all',
            checked ? 'bg-primary' : 'bg-darkbutton'
        )}
    >
        <span
            class={cn(
                'block size-4 rounded-full bg-switch-thumb transition-transform',
                checked ? 'translate-x-[calc(100%-2px)]' : 'translate-x-0'
            )}
        ></span>
    </span>
</DropdownMenu.CheckboxItem>
