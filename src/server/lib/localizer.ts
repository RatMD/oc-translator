
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import glob from 'fast-glob';

export interface LocalizerOptions {
    /**
     * The root working directory used by the Localizer tool.
     */
    root: string;

    /**
     * The default locale string, used to compar withe.
     */
    defaultLocale: string;

    /**
     * The namespace used to identify and extract locale strings ('<group>.<plugin>').
     */
    namespace: string;

    /**
     * The directory where the individual language files can be found.
     */
    localeDir: string;

    /**
     * Glob patterns of the folders and files to be searched for the locale strings.
     */
    files: string[];
}

export type FlatLocaleIndex = { [key: string]: string; };
export type FlatLocaleFileIndex = { [file: string]: FlatLocaleIndex; };

export type LocaleIndex = { [key: string]: string | LocaleIndex; };
export type LocaleFileIndex = { [file: string]: LocaleIndex; };
export type LocaleStringsIndex = { default: LocaleFileIndex, [locale: string]: LocaleFileIndex };

export interface SourceChunk {
    locale: {
        file: string;
        path: string;
        full: string;
    },
    source: string;
    line: number;
    col: number;
    index: number;
    excerpt: string;
    excerptFocus: number[];
}
export type SourceIndex = { [string: string]: SourceChunk[] };

class Localizer {
    /**
     * Localizer Instance.
     */
    private static instance: Localizer|null = null;

    /**
     * Check if localizer has an instance.
     * @returns 
     */
    public static hasInstance(): boolean {
        return this.instance != null;
    }

    /**
     * Check if localizer has an instance.
     * @returns 
     */
    public static getInstance(): Localizer {
        if (this.instance == null) {
            throw new Error('The Localizer class has not been initialized yet.');
        }
        return this.instance;
    }

    /**
     * Instance Options
     */
    public options: LocalizerOptions;

    /**
     * The resolved root directory.
     */
    public root: string;
    
    /**
     * The resolved root languages.
     */
    public lang: string;

    /**
     * The scanned / available locales.
     */
    public locales: string[];

    /**
     * The main strings index for all langauges.
     */
    public strings: LocaleStringsIndex;

    /**
     * The main file index for the default set language.
     */
    public index: FlatLocaleFileIndex;

    /**
     * The set of sources for each locale string.
     */
    public sources: SourceIndex;

    /**
     * Create a new Localizer class
     * @param {object} options
     */
    constructor(options: LocalizerOptions) {
        if (Localizer.hasInstance()) {
            throw new Error('The Localizer class cannot be instantiated twice.');
        }
        Localizer.instance = this;

        // Set Options
        this.options = options;

        // Set Paths
        this.root = path.resolve(options.root);
        this.lang = path.join(this.root, options.localeDir);

        this.locales = [];

        this.strings = {
            default: {}
        };
        this.index = { };
        this.sources = { };
    }

    /**
     * Get the difference from 2 flat translation objects.
     * @param {FlatLocaleIndex} source The object to compare from
     * @param {FlatLocaleIndex} target Object to compare against
     * @return {FlatLocaleIndex}
     */
    diff(source: FlatLocaleIndex, target: FlatLocaleIndex): FlatLocaleIndex {
        source = {...source};
        target = {...target};

        for (const [key, val] of Object.entries(source)) {
            if (!(key in target)) {
                continue; // Does not exist
            }
            if (target[key] != val) {
                continue; // Not the same value
            }
            if (target[key] == val && target[key].replace(/[0-9]+(\s+)?/, '').split(/[ -]/).length <= 2) {
                continue; // Could be a brand or something similar
            }
            delete target[key];
        }

        return target;
    }

    /**
     * Read locale files
     * @returns {void}
     */
    async readLocales() {
        const locales = (await fs.promises.readdir(this.lang)).filter(
            locale => locale != this.options.defaultLocale
        );

        // Read default locale files
        const files = await fs.promises.readdir(path.join(this.lang, this.options.defaultLocale));
        for (const file of files) {
            const filepath = path.join(this.lang, this.options.defaultLocale, file);
            const content = await this.readLocaleFile(filepath);
            
            this.strings.default[file] = content;
            this.index[file] = {};
            this.prepareIndex(content, '', this.index[file]);
        }

        // Format Locales
        for (const locale of locales) {
            this.locales.push(locale);
            this.strings[locale] = {};
        }
    }

    /**
     * Read a PHP locale file
     * @param {string} filepath 
     * @returns {LocaleIndex}
     */
    async readLocaleFile(filepath: string): Promise<LocaleIndex> {
        const result = cp.execSync(`php -r "echo json_encode(require '${filepath.replace(/\\/g, '\\\\')}');"`);
        return JSON.parse(result.toString()) as LocaleIndex;
    }

    /**
     * Prepare translate index
     * @param {object} data
     * @param {string} prefix
     * @param {object} object
     */
    prepareIndex(data: LocaleIndex, prefix: string, object: FlatLocaleIndex) {
        for (const [key, val] of Object.entries(data)) {
            if (typeof val == 'string') {
                object[`${prefix}${key}`] = val;
            } else {
                this.prepareIndex(val, `${prefix}${key}.`, object);
            }
        }
    }

    /**
     * Read Mall source files
     */
    async readSources() {
        const files = await glob(this.options.files, {
            cwd: this.root,
        });

        // Read File
        const basicRegex = new RegExp(`${this.options.namespace}::`, 'gi');
        const localeRegex = new RegExp(`${this.options.namespace}::([a-z\.\_\-]+)`, 'gi');
        for (const file of files) {
            const content = (await fs.promises.readFile(file, 'utf-8')).replace(/\r\n|\r/g, '\n');
            if (!basicRegex.test(content)) {
                continue;
            }

            let result;
            while((result = localeRegex.exec(content)) !== null) {
                let [_, fullPath] = result[0].split('::');

                let stringPath: string | string[] = fullPath.split('.');
                let fileName: string = stringPath.shift() + '.php';
                stringPath = stringPath.join('.');

                if (!(fullPath in this.sources)) {
                    this.sources[fullPath] = [];
                }

                let line = content.slice(0, result.index).split('\n').length;
                let lineStart = (content.slice(0, result.index)).lastIndexOf('\n');
                let col = result.index - lineStart - 1;

                // Get Excerpt (Strip starting spaces)
                let excerpt = content.slice(
                    content.slice(0, lineStart-1).lastIndexOf('\n') + 1,
                    content.indexOf('\n', content.indexOf('\n', result.index) + 2) ?? content.length
                );
                let strip = excerpt.split('\n').reduce((prev, curr) => {
                    let temp = (curr || '').match(/^\s*/);
                    let num = temp ? temp[0].length : 0;
                    return num < prev ? num : prev;
                }, Infinity);
                excerpt = excerpt.split('\n').map(line => line.slice(strip)).join('\n');

                let toFocus = `${this.options.namespace}::${fullPath}`;
                let excerptFocus = [excerpt.indexOf(toFocus), excerpt.indexOf(toFocus)+toFocus.length];

                this.sources[fullPath].push({
                    locale: {
                        file: fileName,
                        path: stringPath,
                        full: fullPath
                    },
                    source: file,
                    line,
                    col,
                    index: result.index,
                    excerpt,
                    excerptFocus
                });
            }
        }
    }

    /**
     * Load translation static for each locale
     * @param {string|null} restrict
     * @returns {object}
     */
    async stats(restrict: string | null = null) {
        const stats: any = {};

        for (const locale of restrict ? [restrict.toLowerCase()] : this.locales) {
            let lines = 0;
            let translated = 0;
            let files: any = {};

            if (!(locale in this.strings)) {
                if (this.locales.includes(locale)) {
                    this.locales.push(locale);
                }
                this.strings[locale] = {};
            }
            
            for (const [file, entries] of Object.entries(this.index)) {
                let curLines = Object.values(entries).length;
                lines += curLines;

                let empty = false;
                if (!(file in this.strings[locale])) {
                    const filepath = path.join(this.lang, locale, file);
                    if (fs.existsSync(filepath)) {
                        const content = await this.readLocaleFile(filepath);
                        this.strings[locale][file] = content;
                    } else {
                        this.strings[locale][file] = {};
                        empty = true;
                    }
                }

                let curTranslated = 0;
                if (!empty) {
                    let index = {};
                    this.prepareIndex(this.strings[locale][file], '', index);
                    curTranslated = Object.keys(this.diff(this.index[file], index)).length;
                    translated += curTranslated;
                }

                files[file] = {
                    lines: curLines,
                    translated: curTranslated,
                    percentage: 100 / curLines * curTranslated
                };
            }

            stats[locale] = {
                lines,
                translated,
                percentage: 100 / lines * translated,
                files
            };
            break;
        }

        return restrict ? stats[restrict] : stats;
    }

    /**
     * Fetch translation strings
     * @param {string} locale
     * @returns {object}
     */
    async fetchStrings(locale: string) {
        if (!(locale in this.strings)) {
            if (this.locales.includes(locale)) {
                this.locales.push(locale);
            }
            this.strings[locale] = {};
        }

        const result: any = {};
        for (const [file, entries] of Object.entries(this.index)) {
            if (!(file in this.strings[locale])) {
                const filepath = path.join(this.lang, locale, file);
                if (fs.existsSync(filepath)) {
                    const content = await this.readLocaleFile(filepath);
                    this.strings[locale][file] = content;
                } else {
                    this.strings[locale][file] = {};
                }
            }

            result[file] = {};
            result[file].en = { ...entries };
            result[file][locale] = {};
            result[file].status = {};
            result[file].references = {};

            let index: any = {};
            this.prepareIndex(this.strings[locale][file], '', index);
            for (const [key, val] of Object.entries(entries)) {
                result[file][locale][key] = index[key] ?? '';

                let status = 'missing';
                if (key in index) {
                    if (index[key] != val || index[key].replace(/[0-9]+(\s+)?/, '').split(/[ -]/).length <= 2) {
                        status = 'translated';
                    } else {
                        status = 'untranslated';
                    }
                }
                result[file].status[key] = status;
                result[file].references[key] = this.sources[`${file.slice(0, -3)}${key}`] ?? [];
            }
        }

        return result;
    }

    /**
     * Update translation string
     * @param {string} locale
     * @param {string} file
     * @param {string} key
     * @param {string} string
     * @returns {object}
     */
    async updateString(locale: string, file: string, key: string, string: string) {
        if (!(file in this.strings[locale])) {
            const filepath = path.join(this.lang, locale, file);
            if (fs.existsSync(filepath)) {
                const content = await this.readLocaleFile(filepath);
                this.strings[locale][file] = content;
            } else {
                this.strings[locale][file] = {};
            }
        }

        // Index
        const localeIndex: any = {};
        this.prepareIndex(this.strings[locale][file], '', localeIndex);
        localeIndex[key] = string;

        // Backup and Set
        let backup = JSON.stringify(this.strings[locale][file]);
        this.strings[locale][file] = this.unpackIndex(localeIndex);

        // Create Directory
        const localeDir = path.join(this.lang, locale);
        if (!fs.existsSync(localeDir)) {
            fs.mkdirSync(localeDir);
        }

        // Write File
        const localeFile = path.join(localeDir, file);
        const localeContent = this.createPHPFile(this.strings[locale][file]);

        try {
            fs.promises.writeFile(localeFile, localeContent, 'utf-8');
        } catch (err) {
            this.strings[locale][file] = JSON.parse(backup);
            console.error(err);
            return false;
        } finally {
            return true;
        }
    }

    /**
     * Unpack Index
     * @param {*} index 
     */
    unpackIndex(index: FlatLocaleIndex): LocaleIndex {
        const result: any = {};
        for (const [key, val] of Object.entries({...index})) {
            if (val.trim().length == 0 || val === null) {
                continue; // Skip Empty Values
            }
            const keys = key.split('.');
            const len = keys.length;

            let walker = result;
            for (let i = 0; i < len; i++) {
                let k = keys[i];

                if (i < len-1) {
                    walker[k] = typeof walker[k] != 'undefined' ? walker[k] : {};
                    walker = walker[k];
                } else {
                    walker[k] = val;
                }
            }
        }
        return result;
    }

    /**
     * Create PHP Locale File
     * @param {object} index 
     */
    createPHPFile(index: any) {
        const content: string[] = [];
        content.push('<?php');
        content.push('return [');

        function recursive(index: any, content: string[], prefix: string, depth: number) {
            for (const [key, val] of Object.entries(index)) {
                let fullPath = `${prefix}${key}`;
                if (typeof val == 'string') {
                    let value = val.replace(/\"/g, '\\"');
                    content.push('    '.repeat(depth) + `"${key}" => "${value}",`);
                } else {
                    content.push('    '.repeat(depth) + `"${key}" => [`);
                    recursive(val, content, `${fullPath}.`, depth+1);
                    content.push('    '.repeat(depth) + `],`);
                }
            }
        }
        recursive(index, content, '', 1);

        content.push('];');
        return content.join('\n');
    }
}

export default Localizer;
