import { get, writable } from "svelte/store";
import { getDatabase, setDatabase } from "../storage/database.svelte";
import { downloadFile } from "../globalApi.svelte";
import { BufferToText, selectSingleFile } from "../util";
import { notifyError } from "../alert";
import { isLite } from "../lite";
import { CustomCSSStore, SafeModeStore } from "../stores.svelte";
import { applyAppSkin } from "./appSkinRuntime";
import { resolveUiThemeColors, type UiThemeColors } from './uiThemeTokens';
import { resolveChatTextSurface, resolveTextTheme } from './textTheme';
import {
    builtInColorSchemes,
    copyColorSchemeForEdit,
    darkColorScheme,
    normalizeColorSchemeName,
    resolveBuiltInColorScheme,
} from "./colorschemePalettes";

export interface ColorScheme{
    bgcolor: string;
    darkbg: string;
    borderc: string;
    selected: string;
    draculared: string;
    textcolor: string;
    textcolor2: string;
    darkBorderc: string;
    darkbutton: string;
    primary: string;
    accentText: string;
    // Keep palette-specific surface foregrounds when a built-in skin is customized.
    baseScheme?: 'dark' | 'light' | 'pastel-pop';
    uiColors?: Partial<UiThemeColors>;
    type:'light'|'dark';
}


export const defaultColorScheme: ColorScheme = { ...darkColorScheme }

const colorShemes = builtInColorSchemes

export const ColorSchemeTypeStore = writable('dark' as 'dark'|'light')

export const colorSchemeList = Object.keys(colorShemes) as (keyof typeof colorShemes)[]

export const colorSchemeLabels: Record<string, string> = {
    dark: "Dark",
    light: "Light",
    "pastel-pop": "Pastel Pop",
}

export function changeColorScheme(colorScheme: string){
    try {
        let db = getDatabase()
        const normalizedName = normalizeColorSchemeName(colorScheme)
        if(normalizedName !== 'custom'){
            db.colorScheme = safeStructuredClone(colorShemes[normalizedName])
        } else if(db.colorSchemeName !== 'custom'){
            db.colorScheme = copyColorSchemeForEdit(db.colorSchemeName, db.colorScheme)
        }
        db.colorSchemeName = normalizedName
        updateColorScheme()   
    } catch (error) {}
}

export function updateColorScheme(){
    try {
        let db = getDatabase()

        let colorScheme = db.colorScheme

        if(colorScheme == null){
            colorScheme = safeStructuredClone(defaultColorScheme)
        }

        const normalizedName = normalizeColorSchemeName(db.colorSchemeName)
        db.colorSchemeName = normalizedName
        colorScheme = resolveBuiltInColorScheme(normalizedName, colorScheme)
        db.colorScheme = colorScheme
        let appliedSchemeName = normalizedName

        if(get(isLite)){
            colorScheme = safeStructuredClone(darkColorScheme)
            appliedSchemeName = 'dark'
        }

        //set css variables
        document.documentElement.dataset.risuColorScheme = appliedSchemeName
        document.documentElement.dataset.risuBaseScheme = appliedSchemeName === 'custom'
            ? colorScheme.baseScheme ?? 'custom' : appliedSchemeName
        document.documentElement.style.colorScheme = colorScheme.type
        document.documentElement.style.setProperty("--risu-theme-bgcolor", colorScheme.bgcolor);
        document.documentElement.style.setProperty("--risu-theme-darkbg", colorScheme.darkbg);
        document.documentElement.style.setProperty("--risu-theme-borderc", colorScheme.borderc);
        document.documentElement.style.setProperty("--risu-theme-selected", colorScheme.selected);
        document.documentElement.style.setProperty("--risu-theme-draculared", colorScheme.draculared);
        document.documentElement.style.setProperty("--risu-theme-textcolor", colorScheme.textcolor);
        document.documentElement.style.setProperty("--risu-theme-textcolor2", colorScheme.textcolor2);
        document.documentElement.style.setProperty("--risu-theme-darkborderc", colorScheme.darkBorderc);
        document.documentElement.style.setProperty("--risu-theme-darkbutton", colorScheme.darkbutton);
        // Legacy data may lack `primary` (added later); fall back to default so
        // the toggle/CTA fill stays usable until the user picks a custom value.
        document.documentElement.style.setProperty("--risu-theme-primary", colorScheme.primary ?? defaultColorScheme.primary);
        document.documentElement.style.setProperty("--risu-theme-accenttext", colorScheme.accentText ?? colorScheme.textcolor);
        for (const [token, color] of Object.entries(resolveUiThemeColors(colorScheme))) {
            document.documentElement.style.setProperty(`--risu-theme-${token}`, color);
        }
        ColorSchemeTypeStore.set(colorScheme.type)
        // Chat text uses separate CSS variables and must follow every palette change.
        updateTextThemeAndCSS()
    } catch (error) {}
}

export function changeColorSchemeType(type: 'light'|'dark'){
    try {
        let db = getDatabase()
        db.colorScheme.type = type
        updateColorScheme()
    } catch (error) {}
}

export function exportColorScheme(){
    let db = getDatabase()
    let json = JSON.stringify(db.colorScheme)
    downloadFile('colorScheme.json', json)
}

export async function importColorScheme(){
    const uarray = await selectSingleFile(['json'])
    if(uarray == null){
        return
    }
    const string = BufferToText(uarray.data)
    let colorScheme: ColorScheme
    try{
        colorScheme = JSON.parse(string)
        if(
            typeof colorScheme.bgcolor !== 'string' ||
            typeof colorScheme.darkbg !== 'string' ||
            typeof colorScheme.borderc !== 'string' ||
            typeof colorScheme.selected !== 'string' ||
            typeof colorScheme.draculared !== 'string' ||
            typeof colorScheme.textcolor !== 'string' ||
            typeof colorScheme.textcolor2 !== 'string' ||
            typeof colorScheme.darkBorderc !== 'string' ||
            typeof colorScheme.darkbutton !== 'string' ||
            (colorScheme.type !== 'light' && colorScheme.type !== 'dark')
        ){
            notifyError('Invalid color scheme')
            return
        }
        // `primary` is optional in old export files (pre-primary-token migration).
        // Backfill from the default so a re-export round-trips with the field set.
        if(typeof colorScheme.primary !== 'string'){
            colorScheme.primary = defaultColorScheme.primary
        }
        if(typeof colorScheme.accentText !== 'string'){
            colorScheme.accentText = colorScheme.textcolor
        }
        changeColorScheme('custom')
        let db = getDatabase()
        db.colorScheme = colorScheme
        updateColorScheme()
    }
    catch(e){
        notifyError('Invalid color scheme')
        return
    
    }
}

export function updateTextThemeAndCSS(){
    let db = getDatabase()
    const root = document.querySelector(':root') as HTMLElement;
    if(!root){
        return
    }
    const lite = get(isLite)
    const scheme = lite ? darkColorScheme : db.colorScheme
    const textColors = resolveTextTheme(lite ? 'standard' : db.textTheme, scheme.type, db.customTextTheme, {
        autoContrast: db.textThemeAutoContrast !== false,
        backgrounds: resolveChatTextSurface(scheme, db).backgrounds,
    })
    for (const [token, color] of Object.entries(textColors)) {
        root.style.setProperty(`--${token}`, color)
    }

    switch(db.font){
        case "default":{
            root.style.setProperty('--risu-font-family', '"OpenAI Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif');
            break
        }
        case "timesnewroman":{
            root.style.setProperty('--risu-font-family', 'Times New Roman, serif');
            break
        }
        case "custom":{
            root.style.setProperty('--risu-font-family', db.customFont);
            break
        }
    }

    if(!get(SafeModeStore)){
        CustomCSSStore.set(db.customCSS ?? '')
    }
    else{
        CustomCSSStore.set('')
    }
    applyAppSkin(db)
}
