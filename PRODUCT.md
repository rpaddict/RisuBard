# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Desktop browser, Electron-style desktop launcher, and mobile browser. Users split roughly evenly between desktop and mobile.)

## Users

People who run long-form AI character roleplay and storytelling sessions with their own model providers. They read and write long Korean (and English) prose turns for hours, switch between bots, and frequently open management screens: prompt presets, modules, lorebooks, plugins, BardWiki memory.

## Product Purpose

RisuBard is a self-hosted AI character chat frontend for stories that outlast the model's context window. Raw conversation is kept as evidence, long-term narrative state is written to Obsidian-compatible Markdown, and each request carries only relevant memory inside an explicit budget. Success is a session that stays coherent and comfortable to read across hundreds of turns.

## Positioning

Fork lineage: a RisuAI-family fork, compatible with the RisuAI ecosystem (characters, CHARX cards, lorebooks, modules, prompt presets, providers, plugins), plus file-native storage and fixed-budget narrative memory (BardWiki) that RisuAI does not have.

## Operating Context

- Long reading sessions in the chat screen are the core scene; management screens (presets, modules, lorebook, wiki, settings) are frequent secondary work.
- Bots may ship their own CSS, background HTML and assets that restyle the chat body. Those bot skins must keep working.
- Korean is the primary UI language; English is supported.

## Capabilities and Constraints

- Svelte 5 + Tailwind. Colors are tokenized (`src/ts/gui/uiThemeTokens.ts`, `src/styles.css`) and guarded by tests; radius, typography, shadow and density are not yet tokenized.
- Compatibility decision for the reskin: RisuAI-compatible bot CSS must keep working. Existing app color themes and user custom CSS may be migrated or broken by a new structure.
- No AI model is bundled or hosted.

## Brand Commitments

- Name: RisuBard. Existing hero art: `assets/readme/risubard-hero.png` (bard girl with lute, blue field).
- The current look stays the default skin. Personality comes from optional, switchable app skins (e.g. one modeled on a bot's own design), while long-form reading stays first.

## Product Principles

1. Reading comes first: long prose must stay comfortable for hours on both desktop and phone.
2. The app has its own character, but never competes with the story text.
3. Bot-authored skins remain first-class; the app must not break RisuAI-compatible bot CSS.
4. Management screens are tools: scannable, consistent, fast to operate.
