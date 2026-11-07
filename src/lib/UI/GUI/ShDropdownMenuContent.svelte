<script lang="ts">
    // shadcn-svelte DropdownMenu Content — RisuAI tokens. Portals to body.
    // Default z-50; callers may use a small local override inside base-tier dialogs.
    import { DropdownMenu } from 'bits-ui';
    import { cn } from 'src/lib/utils';

    let {
        ref = $bindable(null),
        sideOffset = 4,
        align = 'start',
        class: className,
        ...restProps
    }: DropdownMenu.ContentProps = $props();
</script>

<DropdownMenu.Portal>
    <DropdownMenu.Content
        data-skin-part="menu"
        bind:ref
        data-slot="dropdown-menu-content"
        {sideOffset}
        {align}
        class={cn(
            'z-50 min-w-32 rounded-md border border-darkborderc bg-darkbg text-textcolor p-1 shadow-md outline-none ' +
            'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ' +
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ' +
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 ' +
            'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            className
        )}
        {...restProps}
    />
</DropdownMenu.Portal>
