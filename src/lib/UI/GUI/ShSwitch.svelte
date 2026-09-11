<script lang="ts">
    // shadcn-svelte Switch — 1:1 port of _reference/shadcn-components/switch/.
    // Visual classes inlined from shadcn-styles vega .cn-switch / .cn-switch-thumb,
    // with two mechanical translations:
    //   - shadcn semantic tokens → RisuAI theme tokens
    //       bg-primary → bg-primary (RisuAI's primary token — dynamic per theme,
    //         maps to ColorScheme.primary; carries the "on/active" fill role),
    //       bg-input → bg-darkbutton (brighter than dialog background darkbg
    //         so the inactive track stays visible against panel surfaces),
    //       border-ring/ring-ring → border-borderc/ring-borderc,
    //       border-destructive/ring-destructive → border-draculared/ring-draculared,
    //       bg-background → bg-switch-thumb (independently editable thumb —
    //         standard toggle UX has thumb always near-white regardless of
    //         theme; mapping bg-background → bg-textcolor would render a black
    //         thumb in light/monokai-light themes which is jarring and unlike
    //         any platform toggle convention)
    //   - data-checked: / data-unchecked: → data-[state=checked]: / data-[state=unchecked]:
    //       bits-ui v2 emits a single data-state="checked|unchecked" attribute,
    //       not the independent boolean attributes shadcn vega selectors target.
    // dark: variants are dropped because RisuAI ships a single dark theme.
    import { Switch as SwitchPrimitive } from 'bits-ui';
    import { cn } from 'src/lib/utils';

    interface Props {
        ref?: HTMLButtonElement | null;
        checked?: boolean;
        size?: 'default' | 'sm';
        disabled?: boolean;
        name?: string;
        value?: string;
        required?: boolean;
        ariaLabel?: string;
        className?: string;
        onCheckedChange?: (checked: boolean) => void;
    }

    let {
        ref = $bindable(null),
        checked = $bindable(false),
        size = 'default',
        disabled = false,
        name,
        value,
        required,
        ariaLabel,
        className = '',
        onCheckedChange,
    }: Props = $props();
</script>

<SwitchPrimitive.Root
    bind:ref
    bind:checked
    {disabled}
    {name}
    {value}
    {required}
    aria-label={ariaLabel}
    {onCheckedChange}
    data-slot="switch"
    data-size={size}
    class={cn(
        'peer group/switch relative inline-flex items-center transition-all outline-none ' +
        'after:absolute after:-inset-x-3 after:-inset-y-2 ' +
        'data-disabled:cursor-not-allowed data-disabled:opacity-50 ' +
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-darkbutton ' +
        'focus-visible:border-borderc focus-visible:ring-borderc/50 ' +
        'aria-invalid:ring-draculared/20 aria-invalid:border-draculared ' +
        'shrink-0 rounded-full border border-transparent shadow-xs ' +
        'focus-visible:ring-3 aria-invalid:ring-3 ' +
        'data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] ' +
        'data-[size=sm]:h-[14px] data-[size=sm]:w-[24px]',
        className
    )}
>
    <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        class={
            'pointer-events-none block ring-0 transition-transform ' +
            'rtl:data-[state=checked]:translate-x-[calc(-100%)] ' +
            'bg-switch-thumb rounded-full ' +
            'group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 ' +
            'group-data-[size=default]/switch:data-[state=checked]:translate-x-[calc(100%-2px)] ' +
            'group-data-[size=sm]/switch:data-[state=checked]:translate-x-[calc(100%-2px)] ' +
            'group-data-[size=default]/switch:data-[state=unchecked]:translate-x-0 ' +
            'group-data-[size=sm]/switch:data-[state=unchecked]:translate-x-0'
        }
    />
</SwitchPrimitive.Root>
