import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";

export function registerLookupCatalog(server: McpServer, env: Env) {
	server.registerTool(
		"lookup_catalog",
		{
			title: "Resolve Shopify Product URLs and IDs",
			description: [
				"Use this tool FIRST when you have a specific Shopify product URL, variant URL, product ID, variant ID, or multiple known product references.",
				"This is the REQUIRED URL-resolution tool.",
				"For every http or https Shopify product or variant URL, call lookup_catalog before get_product.",
				"DO NOT send a URL directly to get_product.",
				"Use the returned product or variant identifier with get_product only when you need full details, option availability, or variant selection.",
				"This tool can resolve one to fifty references in one request.",
			].join(" "),
			inputSchema: z.object({
				ids: z
					.array(z.string())
					.min(1)
					.max(50)
					.describe(
						"Required. One to fifty known references. Accepts gid://shopify/p/{upid}, gid://shopify/ProductVariant/{id}, and full http/https Shopify product or variant URLs. If the input is a URL, this is the correct tool. Do not call get_product with URLs.",
					),
				in_stock: z
					.boolean()
					.optional()
					.describe("Filter by availability. Defaults to true (only sale-ready items)."),
				condition: z
					.array(z.string())
					.optional()
					.describe(
						"Optional product condition filter. Known values: 'new', 'secondhand'.",
					),
				shops: z
					.array(z.string())
					.optional()
					.describe(
						"Optional array of specific shop GIDs to filter by (e.g. gid://shopify/Shop/123).",
					),
				ships_to: z
					.object({
						country: z
							.string()
							.optional()
							.describe("Two-letter destination country code. Example: US."),
						region: z
							.string()
							.optional()
							.describe("Destination state, province, or region. Example: CA."),
						postal_code: z
							.string()
							.optional()
							.describe("Destination postal code. Example: 90210."),
					})
					.optional()
					.describe("Filter to products that ship to a given location."),
				ships_from: z
					.array(z.string())
					.optional()
					.describe(
						"Filter by merchant origin country (ISO 3166-1 alpha-2). Example: US or CA.",
					),
				language: z
					.string()
					.optional()
					.describe("Result language and formatting locale. Example: en."),
				currency: z.string().optional().describe("Buyer currency code. Example: USD."),
				intent: z
					.string()
					.optional()
					.describe("Optional shopping context to improve relevance."),
				view: z
					.string()
					.optional()
					.describe("Predefined output shape. Use 'offer' for comparison shopping."),
			}),
		},
		async (input) => {
			const filters: Record<string, unknown> = {};

			if (input.in_stock !== undefined) filters.available = input.in_stock;
			if (input.condition?.length) filters.condition = input.condition;
			if (input.shops?.length) filters.shops = input.shops;
			if (input.ships_to) filters.ships_to = input.ships_to;
			if (input.ships_from?.length)
				filters.ships_from = input.ships_from.map((country) => ({ country }));

			const catalog: Record<string, unknown> = {
				ids: input.ids,
				context: {
					address_country: input.ships_to?.country || "US",
					language: input.language || "en",
					currency: input.currency || "USD",
					...(input.intent ? { intent: input.intent } : {}),
					...(input.ships_to?.region ? { address_region: input.ships_to.region } : {}),
					...(input.ships_to?.postal_code
						? { postal_code: input.ships_to.postal_code }
						: {}),
				},
				...(Object.keys(filters).length > 0 ? { filters } : {}),
			};

			if (input.view) catalog.view = input.view;

			const upstream = await fetch("https://catalog.shopify.com/api/ucp/mcp", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"MCP-Protocol-Version": "2026-04-08", // FIXED from 2026-03-26
					Accept: "application/json",
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					"Cache-Control": "public, max-age=3600",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "tools/call",
					id: 2,
					params: {
						name: "lookup_catalog",
						arguments: {
							meta: {
								"ucp-agent": {
									profile: env.AGENT_PROFILE_URL,
								},
							},
							catalog,
						},
					},
				}),
			});

			const shopifyResponse = (await upstream.json()) as any;
			const products = shopifyResponse.result?.structuredContent?.products || [];
			const messages = shopifyResponse.result?.structuredContent?.messages || [];
			const context = catalog.context as { language: string; currency: string };

			const markdown = [
				"# Catalog Lookup Results",
				"",
				...products.flatMap((product: any, index: number) => {
					const variant = product.variants?.[0] || {};
					const media = variant.media?.[0] || product.media?.[0] || {};
					const price = variant.price || product.price_range?.min || {};
					const seller = variant.seller || product.seller || {};
					const rating = variant.rating || product.rating || {};
					const title = product.title || variant.title || "Product";
					const description =
						variant.description?.plain || product.description?.plain || "";
					const options = (variant.options || [])
						.map((option: any) => `${option.name || "Option"}: ${option.label || ""}`)
						.filter(Boolean)
						.join(" · ");

					const priceText =
						typeof price.amount === "number"
							? new Intl.NumberFormat(context.language, {
									style: "currency",
									currency: price.currency || context.currency,
								}).format(price.amount / 100)
							: "Price unavailable";

					const ratingText =
						typeof rating.value === "number"
							? `Rating: ${rating.value}/${rating.scale_max || 5}${typeof rating.count === "number" ? ` (${rating.count.toLocaleString()} reviews)` : ""}`
							: "";

					return [
						`## ${index + 1}. ${title}`,
						"",
						media.url ? `![${media.alt_text || title}](${media.url})` : "",
						"",
						`**${priceText}**${seller.name ? ` · ${seller.name}` : ""}`,
						ratingText,
						options,
						"",
						description,
						"",
						variant.url ? `[View product](${variant.url})` : "",
						variant.checkout_url ? `[Buy now](${variant.checkout_url})` : "",
						"",
					].filter(Boolean);
				}),
				products.length === 0 ? "No products found." : "",
				...messages.map((msg: any) => `> ${msg.content || msg.message || ""}`),
			]
				.filter(Boolean)
				.join("\n");
			return { content: [{ type: "text" as const, text: markdown }] };
		},
	);
}
