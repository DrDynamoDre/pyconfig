import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface StructuredSearchArgs {
	query?: string;
	exactPhrases?: string[];
	excludeTerms?: string[];
	site?: string;
	count?: number;
}

interface BuiltSearchQuery {
	query: string;
	baseQuery?: string;
	exactPhrases: string[];
	excludeTerms: string[];
	site?: string;
}

// ---------------------------------------------------------------------------
// Tavily backend (free tier: 1,000 credits/month, no card required)
// Docs: https://docs.tavily.com
// ---------------------------------------------------------------------------
async function tavilySearch(
	query: string,
	count: number,
	apiKey: string,
	site?: string,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const body: Record<string, unknown> = {
		query,
		max_results: Math.min(Math.max(count, 1), 20),
		search_depth: "basic", // "basic" costs 1 credit; "advanced" costs more
	};
	if (site) body.include_domains = [site];

	const resp = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
		signal,
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Tavily API ${resp.status}: ${text.slice(0, 200)}`);
	}

	const data = (await resp.json()) as {
		results?: Array<{ title?: string; url: string; content?: string }>;
	};

	if (!data.results || data.results.length === 0) return [];

	return data.results.map((item) => ({
		title: item.title ?? item.url,
		url: item.url,
		snippet: (item.content ?? "").replace(/\s+/g, " ").slice(0, 300),
	}));
}

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));
const AUTH_PATH = path.join(EXT_DIR, "auth.json");

function loadApiKey(): string | null {
	const envKey = process.env.TAVILY_API_KEY;
	if (envKey) return envKey;

	if (!fs.existsSync(AUTH_PATH)) return null;

	let config: { tavily_api_key?: string };
	try {
		config = JSON.parse(fs.readFileSync(AUTH_PATH, "utf-8")) as {
			tavily_api_key?: string;
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid auth.json at ${AUTH_PATH}: ${message}`);
	}

	const key = config.tavily_api_key;
	if (key) return key;
	return null;
}

function formatResults(results: SearchResult[]): string {
	if (results.length === 0) return "No results found.";
	return results
		.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
		.join("\n\n");
}

function stripWrappingQuotes(value: string): string {
	return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
		? value.slice(1, -1).trim()
		: value;
}

function cleanItems(values?: string[]): string[] {
	if (!values) return [];
	return values
		.map((value) => stripWrappingQuotes(value.trim().replace(/\s+/g, " ")))
		.filter(Boolean);
}

function cleanQuery(value?: string): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value.trim().replace(/\s+/g, " ");
	return cleaned || undefined;
}

function normalizeSite(site?: string): string | undefined {
	if (typeof site !== "string") return undefined;

	let value = site.trim().replace(/^site:/i, "").trim();
	if (!value) return undefined;

	try {
		const candidate = /^[a-z]+:\/\//i.test(value)
			? value
			: `https://${value}`;
		const url = new URL(candidate);
		if (url.hostname) value = url.hostname;
	} catch {}

	return value.replace(/\/+$/, "") || undefined;
}

function quoteForSearch(value: string): string {
	return `"${value.replace(/"/g, '\\"')}"`;
}

// Tavily does not understand Google operators (-term, site:), so:
//  - exact phrases stay in the query as quoted text (a hint, not a guarantee)
//  - site is sent separately as include_domains
//  - excluded terms are filtered out of the results after the search
function buildSearchQuery(args: StructuredSearchArgs): BuiltSearchQuery {
	const baseQuery = cleanQuery(args.query);
	const exactPhrases = cleanItems(args.exactPhrases);
	const excludeTerms = cleanItems(args.excludeTerms);
	const site = normalizeSite(args.site);

	if (!baseQuery && exactPhrases.length === 0) {
		throw new Error(
			"At least one of 'query' or 'exactPhrases' is required.",
		);
	}

	const parts: string[] = [];
	if (baseQuery) parts.push(baseQuery);
	for (const phrase of exactPhrases) {
		parts.push(quoteForSearch(phrase));
	}

	return {
		query: parts.join(" "),
		baseQuery,
		exactPhrases,
		excludeTerms,
		site,
	};
}

function applyExclusions(
	results: SearchResult[],
	excludeTerms: string[],
): SearchResult[] {
	if (excludeTerms.length === 0) return results;
	const lowered = excludeTerms.map((t) => t.toLowerCase());
	return results.filter((r) => {
		const haystack = `${r.title} ${r.snippet}`.toLowerCase();
		return !lowered.some((term) => haystack.includes(term));
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web via the Tavily API. Build one search per call from a base query string, optional exact phrases, optional excluded terms, and an optional site. Returns title, URL, and snippet.",
		promptSnippet:
			"Search the web via a query string plus optional exactPhrases, excludeTerms, and site. Use one tool call per search angle.",
		promptGuidelines: [
			"Use exactPhrases for exact phrase matching instead of embedding quote marks inside the main query string.",
			"Use one web_search tool call per search angle instead of batching multiple searches into one call.",
			"Use the site parameter to restrict results to one domain.",
		],

		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					description:
						"Base search query as a normal string. Prefer this for the main search wording.",
				}),
			),
			exactPhrases: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Exact phrases to include in the query as quoted text.",
				}),
			),
			excludeTerms: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Terms to exclude. Results mentioning them in the title or snippet are filtered out.",
				}),
			),
			site: Type.Optional(
				Type.String({
					description:
						"Optional site/domain restriction, such as example.com or a full URL.",
				}),
			),
			count: Type.Optional(
				Type.Number({
					description: "Number of results to return (default: 5, max: 10)",
					minimum: 1,
					maximum: 10,
				}),
			),
		}),

		async execute(_toolCallId, params: StructuredSearchArgs, signal) {
			const apiKey = loadApiKey();
			if (!apiKey) {
				throw new Error(
					`Missing Tavily API key. Set TAVILY_API_KEY, or create ${AUTH_PATH} containing {"tavily_api_key": "..."}. Get a free key at https://app.tavily.com`,
				);
			}

			const count = params.count ?? 5;
			const built = buildSearchQuery(params);
			const raw = await tavilySearch(
				built.query,
				count,
				apiKey,
				built.site,
				signal,
			);
			const results = applyExclusions(raw, built.excludeTerms);

			return {
				content: [
					{
						type: "text" as const,
						text: formatResults(results),
					},
				],
				details: {
					composedQuery: built.query,
					query: built.baseQuery,
					exactPhrases: built.exactPhrases,
					excludeTerms: built.excludeTerms,
					site: built.site,
					resultCount: results.length,
				},
			};
		},

		renderCall(args, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);
			const { count, ...searchArgs } = args as StructuredSearchArgs;

			try {
				const built = buildSearchQuery(searchArgs);
				const display =
					built.query.length > 70
						? built.query.slice(0, 67) + "..."
						: built.query;
				const lines = [
					theme.fg("toolTitle", theme.bold("search ")) +
						theme.fg("accent", `"${display}"`),
				];
				if (built.site) {
					lines.push(theme.fg("dim", `  site: ${built.site}`));
				}
				if (count && count !== 5) {
					lines.push(theme.fg("dim", `  count: ${count}`));
				}
				text.setText(lines.join("\n"));
				return text;
			} catch {
				text.setText(
					theme.fg("toolTitle", theme.bold("search ")) +
						theme.fg("error", "(invalid query)"),
				);
				return text;
			}
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);

			if (isPartial) {
				text.setText(theme.fg("warning", "Searching…"));
				return text;
			}

			if (context.isError) {
				const msg =
					result.content.find((c) => c.type === "text")?.text ||
					"Error";
				text.setText(theme.fg("error", msg));
				return text;
			}

			const details = result.details as {
				composedQuery?: string;
				resultCount?: number;
			};
			const status = theme.fg(
				"success",
				`${details?.resultCount ?? 0} results`,
			);
			if (!expanded) {
				text.setText(status);
				return text;
			}

			const content =
				result.content.find((c) => c.type === "text")?.text || "";
			const preview =
				content.length > 500 ? content.slice(0, 500) + "..." : content;
			const queryLine = details?.composedQuery
				? theme.fg("dim", `query: ${details.composedQuery}`)
				: "";
			text.setText(
				[status, queryLine, theme.fg("dim", preview)]
					.filter(Boolean)
					.join("\n"),
			);
			return text;
		},
	});
}
