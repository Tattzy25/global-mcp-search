import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

import { registerLookupCatalog } from "./tools/lookupCatalog";
import { registerGetProduct } from "./tools/getProduct";

interface Env {
  AGENT_PROFILE_URL: string;
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "Global Catalog Search",
    version: "1.0.0"
  });

  server.registerTool(
    "search_products",
    {
      title: "Global Product Search",
      description:
        "Searches for products across all Shopify merchants.

The response conforms to the UCP catalog search 
response
, including a UCP metadata envelope; products with title, description, price range (minor units), media, and variants.

When to use:

A customer asks "I'm looking for trail running shoes under $150."
You need to find products matching criteria from any merchant.
A customer wants to compare products across multiple stores..",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("What the shopper wants to find. Example: comfortable black trail running shoes or heavy red hoodie."),
        catalog_id: z
          .string()
          .optional()
          .describe("Optional target Shopify catalog ID to scope the search to a specific merchant. Leave empty for open global search."),
        image: z
          .object({
            content_type: z
              .string()
              .describe("Image MIME type. Example: image/jpeg, image/png, or image/webp."),
            data: z
              .string()
              .describe("Base64-encoded image data used to find visually similar products.")
          })
          .optional()
          .describe("Optional image upload for visual product similarity search."),
        min_price: z
          .number()
          .optional()
          .describe("Optional minimum price in minor currency units. Example: 5000 means $50.00."),
        max_price: z
          .number()
          .optional()
          .describe("Optional maximum price in minor currency units. Example: 15000 means $150.00."),
        in_stock: z
          .boolean()
          .optional()
          .describe("Show only currently available products. Default: true."),
        condition: z
          .array(z.string())
          .optional()
          .describe("Optional accepted product conditions. Example: new, used, or refurbished."),
        categories: z
          .array(z.string())
          .optional()
          .describe("Optional product category names. Example: Hoodies, Outerwear, or Electronics."),
        color: z
          .array(z.string())
          .optional()
          .describe("Optional preferred colors. Example: Red, Black, or Gray."),
        size: z
          .array(z.string())
          .optional()
          .describe("Optional preferred sizes. Example: S, M, L, XL, or 10."),
        gender: z
          .array(z.string())
          .optional()
          .describe("Optional target gender. Example: Men, Women, Kids, or Unisex."),
        min_rating: z
          .number()
          .optional()
          .describe("Optional minimum product rating from 1 through 5. Example: 4.5."),
        min_reviews: z
          .number()
          .optional()
          .describe("Optional minimum number of product reviews. Example: 10."),
        ships_to: z
          .object({
            country: z.string().optional().describe("Two-letter destination country code. Example: US."),
            region: z.string().optional().describe("Destination state, province, or region. Example: CA."),
            postal_code: z.string().optional().describe("Destination postal code. Example: 90210.")
          })
          .optional()
          .describe("Optional delivery destination used to find shippable products."),
        ships_from: z
          .array(z.string())
          .optional()
          .describe("Optional origin country preferences. Example: US or CA."),
        language: z
          .string()
          .optional()
          .describe("Result language and formatting locale. Example: en."),
        currency: z
          .string()
          .optional()
          .describe("Buyer currency code. Example: USD."),
        intent: z
          .string()
          .optional()
          .describe("Optional shopping context to improve relevance. Example: thick winter streetwear hoodie."),
        view: z
          .string()
          .optional()
          .describe("Optional catalog result view. Example: offer, product, or variant."),
        limit: z
          .number()
          .optional()
          .describe("Optional result count. Maximum is 4."),
        cursor: z
          .string()
          .optional()
          .describe("Optional next-page cursor from a previous result.")
      })
    },
    async (input) => {
      const filters: Record<string, unknown> = {};

      if (input.in_stock !== undefined) filters.available = input.in_stock;
      if (input.condition?.length) filters.condition = input.condition;
      if (input.ships_to) filters.ships_to = input.ships_to;
      if (input.ships_from?.length) filters.ships_from = input.ships_from.map(country => ({ country }));
      
      if (input.min_price !== undefined || input.max_price !== undefined) {
        filters.price = {
          ...(input.min_price !== undefined ? { min: input.min_price } : {}),
          ...(input.max_price !== undefined ? { max: input.max_price } : {})
        };
      }
      
      if (input.categories?.length) filters.categories = input.categories.map(name => ({ name }));

      const attributes = [
        ...(input.color?.length ? [{ name: "Color", values: input.color }] : []),
        ...(input.size?.length ? [{ name: "Size", values: input.size }] : []),
        ...(input.gender?.length ? [{ name: "Target gender", values: input.gender }] : [])
      ];
      if (attributes.length) filters.attributes = attributes;

      if (input.min_rating !== undefined || input.min_reviews !== undefined) {
        filters.rating = {
          variant: {
            ...(input.min_rating !== undefined ? { min: input.min_rating } : {}),
            ...(input.min_reviews !== undefined ? { min_count: input.min_reviews } : {})
          }
        };
      }

      const catalog: Record<string, unknown> = {
        query: input.search?.trim() || "",
        context: {
          address_country: input.ships_to?.country || "US",
          language: input.language || "en",
          currency: input.currency || "USD",
          ...(input.intent ? { intent: input.intent } : {}),
          ...(input.ships_to?.region ? { address_region: input.ships_to.region } : {}),
          ...(input.ships_to?.postal_code ? { postal_code: input.ships_to.postal_code } : {})
        },
        ...(Object.keys(filters).length > 0 ? { filters } : {}),
        view: input.view || "offer",
        pagination: {
          limit: Math.min(Math.max(input.limit || 4, 1), 4),
          ...(input.cursor ? { cursor: input.cursor } : {})
        }
      };

      if (input.catalog_id) {
        catalog.catalog_id = input.catalog_id;
      }

      if (input.image?.content_type && input.image.data) {
        catalog.like = [{ image: { content_type: input.image.content_type, data: input.image.data } }];
      }

      const upstream = await fetch("https://catalog.shopify.com/api/ucp/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2026-03-26",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          id: 1,
          params: {
            name: "search_catalog",
            arguments: {
              meta: {
                "ucp-agent": {
                  profile: env.AGENT_PROFILE_URL
                }
              },
              catalog
            }
          }
        })
      });

      const shopifyResponse = await upstream.json() as any;
      const products = shopifyResponse.result?.structuredContent?.products || [];
      const pagination = shopifyResponse.result?.structuredContent?.pagination || {};
      const messages = shopifyResponse.result?.structuredContent?.messages || [];

      const context = catalog.context as { language: string; currency: string; };

      const markdown = [
        "# Global Catalog Results",
        "",
        ...products.flatMap((product: any, index: number) => {
          const variant = product.variants?.[0] || {};
          const media = variant.media?.[0] || product.media?.[0] || {};
          const price = variant.price || product.price_range?.min || {};
          const seller = variant.seller || product.seller || {};
          const rating = variant.rating || product.rating || {};
          const title = product.title || variant.title || "Product";
          const description = variant.description?.plain || product.description?.plain || "";
          const options = (variant.options || [])
            .map((option: any) => `${option.name || "Option"}: ${option.label || ""}`)
            .filter(Boolean)
            .join(" · ");

          const priceText = typeof price.amount === "number"
            ? new Intl.NumberFormat(context.language, {
                style: "currency",
                currency: price.currency || context.currency
              }).format(price.amount / 100)
            : "Price unavailable";

          const ratingText = typeof rating.value === "number"
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
            ""
          ].filter(Boolean);
        }),
        products.length === 0 ? "No matching products found." : "",
        pagination.has_next_page ? "More results are available." : "",
        ...messages
          .map((message: any) => message.content || message.message || "")
          .filter(Boolean)
          .map((message: string) => `> ${message}`)
      ].filter(Boolean).join("\n");

      return {
        content: [{ type: "text" as const, text: markdown }]
      };
    }
  );

  registerLookupCatalog(server, env);
  registerGetProduct(server, env);

  return server;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;
