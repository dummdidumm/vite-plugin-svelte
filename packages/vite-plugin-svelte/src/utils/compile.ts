import { Arrayable, CompileOptions, ResolvedOptions } from './options';
import { compile, preprocess, walk } from 'svelte/compiler';
// @ts-ignore
import { createMakeHot } from 'svelte-hmr';
import { SvelteRequest } from './id';
import { safeBase64Hash } from './hash';
import { log } from './log';
import { createEnhanceCssHmrPreprocessor } from './preprocess';
//eslint-disable-next-line node/no-missing-import
import { PreprocessorGroup } from 'svelte/types/compiler/preprocess';

const scriptLangRE = /<script [^>]*lang=["']?([^"' >]+)["']?[^>]*>/;

const _createCompileSvelte = (makeHot: Function) => {
	const cssHmrPreprocessor = createEnhanceCssHmrPreprocessor();
	return async function compileSvelte(
		svelteRequest: SvelteRequest,
		code: string,
		options: Partial<ResolvedOptions>
	): Promise<CompileData> {
		const { filename, normalizedFilename, cssId, ssr } = svelteRequest;
		const { emitCss = true } = options;
		const dependencies = [];

		const compileOptions: CompileOptions = {
			...options.compilerOptions,
			filename,
			generate: ssr ? 'ssr' : 'dom',
			format: 'esm'
		};
		let preprocessors: Arrayable<PreprocessorGroup> | undefined;
		if (options.hot && options.emitCss) {
			const hash = `s-${safeBase64Hash(normalizedFilename)}`;
			log.debug(`setting cssHash ${hash} for ${normalizedFilename}`);
			compileOptions.cssHash = () => hash;
			if (options.preprocess) {
				preprocessors = Array.isArray(options.preprocess)
					? [...options.preprocess, cssHmrPreprocessor]
					: [options.preprocess, cssHmrPreprocessor];
			} else {
				preprocessors = cssHmrPreprocessor;
			}
		} else {
			preprocessors = options.preprocess;
		}
		if (ssr && compileOptions.enableSourcemap !== false) {
			if (typeof compileOptions.enableSourcemap === 'object') {
				compileOptions.enableSourcemap.css = false;
			} else {
				compileOptions.enableSourcemap = { js: true, css: false };
			}
		}

		let preprocessed;

		if (preprocessors) {
			try {
				preprocessed = await preprocess(code, preprocessors, { filename });
			} catch (e) {
				e.message = `Error while preprocessing ${filename}${e.message ? ` - ${e.message}` : ''}`;
				throw e;
			}

			if (preprocessed.dependencies) dependencies.push(...preprocessed.dependencies);
			if (preprocessed.map) compileOptions.sourcemap = preprocessed.map;
		}
		const finalCode = preprocessed ? preprocessed.code : code;
		const dynamicCompileOptions = await options.experimental?.dynamicCompileOptions?.({
			filename,
			code: finalCode,
			compileOptions
		});
		if (dynamicCompileOptions && log.debug.enabled) {
			log.debug(
				`dynamic compile options for  ${filename}: ${JSON.stringify(dynamicCompileOptions)}`
			);
		}
		const finalCompileOptions = dynamicCompileOptions
			? {
					...compileOptions,
					...dynamicCompileOptions
			  }
			: compileOptions;
		const compiled = compile(finalCode, finalCompileOptions);
		const hasCss = compiled.css?.code?.trim().length > 0;
		// compiler might not emit css with mode none or it may be empty
		if (emitCss && hasCss) {
			// TODO properly update sourcemap?
			compiled.js.code += `\nimport ${JSON.stringify(cssId)};\n`;
		}

		// only apply hmr when not in ssr context and hot options are set
		if (!ssr && makeHot) {
			compiled.js.code = makeHot({
				id: filename,
				compiledCode: compiled.js.code,
				hotOptions: { ...options.hot, injectCss: options.hot?.injectCss === true && hasCss },
				compiled,
				originalCode: code,
				compileOptions: finalCompileOptions
			});
		}

		compiled.js.dependencies = dependencies;

		return {
			filename,
			normalizedFilename,
			lang: code.match(scriptLangRE)?.[1] || 'js',
			// @ts-ignore
			compiled,
			ssr,
			dependencies
		};
	};
};
function buildMakeHot(options: ResolvedOptions) {
	const needsMakeHot = options.hot !== false && options.isServe && !options.isProduction;
	if (needsMakeHot) {
		// @ts-ignore
		const hotApi = options?.hot?.hotApi;
		// @ts-ignore
		const adapter = options?.hot?.adapter;
		return createMakeHot({
			walk,
			hotApi,
			adapter,
			hotOptions: { noOverlay: true, ...(options.hot as object) }
		});
	}
}

export function createCompileSvelte(options: ResolvedOptions) {
	const makeHot = buildMakeHot(options);
	return _createCompileSvelte(makeHot);
}

export interface Code {
	code: string;
	map?: any;
	dependencies?: any[];
}

export interface Compiled {
	js: Code;
	css: Code;
	ast: any; // TODO type
	warnings: any[]; // TODO type
	vars: {
		name: string;
		export_name: string;
		injected: boolean;
		module: boolean;
		mutated: boolean;
		reassigned: boolean;
		referenced: boolean;
		writable: boolean;
		referenced_from_script: boolean;
	}[];
	stats: {
		timings: {
			total: number;
		};
	};
}

export interface CompileData {
	filename: string;
	normalizedFilename: string;
	lang: string;
	compiled: Compiled;
	ssr: boolean | undefined;
	dependencies: string[];
}
