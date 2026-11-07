<!-- TODO: REMOVE AND REFACTOR TO BASE BUTTON UI COMPONENT -->

<script lang="ts">
  interface Props {
    onClick?: any;
    additionalStyle?: string | Promise<string>;
    ariaLabel?: string;
    title?: string;
    pressed?: boolean;
    disabled?: boolean;
    /** Blinks orange until the user looks at what it leads to. */
    attention?: boolean;
    children?: import('svelte').Snippet;
  }

  let {
    onClick = () => {},
    additionalStyle = "",
    ariaLabel,
    title,
    pressed,
    disabled = false,
    attention = false,
    children,
  }: Props = $props();
</script>

{#await additionalStyle}
  <button onclick={onClick} data-skin-part="rail-icon" data-skin-state={pressed ? 'active' : undefined} class="ico" class:active={pressed} class:attention {disabled} aria-label={ariaLabel} aria-pressed={pressed} {title}>{@render children?.()}</button>
{:then as}
  <button onclick={onClick} data-skin-part="rail-icon" data-skin-state={pressed ? 'active' : undefined} class="ico" class:active={pressed} class:attention {disabled} aria-label={ariaLabel} aria-pressed={pressed} {title} style={as}>{@render children?.()}</button>
{/await}

<style>
  .ico {
    cursor: pointer;
    border-radius: 0.375rem;
    height: 3.5rem;
    width: 3.5rem;
    min-height: 3.5rem;
    --tw-shadow-color: var(--color-shadow);
    --tw-shadow: 0 10px 15px -3px color-mix(in srgb, var(--tw-shadow-color) 10%, transparent),
      0 4px 6px -2px color-mix(in srgb, var(--tw-shadow-color) 5%, transparent);
    -webkit-box-shadow: var(--tw-ring-offset-shadow, 0 0 transparent),
      var(--tw-ring-shadow, 0 0 transparent), var(--tw-shadow);
    box-shadow: var(--tw-ring-offset-shadow, 0 0 transparent),
      var(--tw-ring-shadow, 0 0 transparent), var(--tw-shadow);
    --tw-bg-opacity: 1;
    background-color: color-mix(in srgb, var(--color-selected) calc(var(--tw-bg-opacity) * 100%), transparent);
    display: flex;
    justify-content: center;
    align-items: center;
    transition-property: background-color, border-color, color, fill, stroke;
    transition-duration: 150ms;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }

  .ico:hover {
    background-color: var(--risu-theme-primary);
  }

  .ico.active {
    background-color: var(--color-warning);
    color: var(--color-on-warning);
  }

  /* Orange from the theme's warning and red roles, so custom themes recolor it too. */
  .ico.attention {
    --attention: color-mix(in srgb, var(--color-warning) 70%, var(--color-draculared));
    --attention-deep: color-mix(in srgb, var(--attention) 65%, var(--color-darkbg));
    position: relative;
    color: var(--color-on-warning);
    background-color: var(--attention);
    animation: ico-attention-blink 1.6s ease-in-out infinite, ico-attention-ring 1.6s ease-out infinite;
  }

  .ico.attention::after {
    content: '';
    position: absolute;
    top: -3px;
    right: -3px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-warning);
    border: 2px solid var(--color-bgcolor);
  }

  @keyframes ico-attention-blink {
    0%, 100% { background-color: var(--attention); }
    50% { background-color: var(--attention-deep); }
  }

  @keyframes ico-attention-ring {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--attention) 75%, transparent); }
    70%, 100% { box-shadow: 0 0 0 12px color-mix(in srgb, var(--attention) 0%, transparent); }
  }

  @media (prefers-reduced-motion: reduce) {
    .ico.attention { animation: none; }
  }

  .ico:disabled {
    cursor: wait;
    opacity: 0.65;
  }
</style>
