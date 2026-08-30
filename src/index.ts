import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

import { registerCreateCheckout } from "./tools/createCheckout";
import { registerCompleteCheckout } from "./tools/completeCheckout";
import { registerUpdateCheckout } from "./tools/updateCheckout";
import { registerCancelCheckout } from "./tools/cancelCheckout";
import { registerLookupCatalog } from "./tools/lookupCatalog";
import { registerGetProduct } from "./tools/getProduct";
import { getAccessToken } from "./auth";

export interface Env {
  AGENT_PROFILE_URL: string;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_CATALOG_ID: string;
  SHOP_ACCESS_TOKEN?: string;
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "Global Catalog Search",
    version: "1.0.0"
  });

  server.registerTool(
  "search_products",
  {
    title: "Search Global Shopify Catalog",
    description: [
      "Use this FIRST for product discovery across all Shopify merchants.",
      "Use it when the customer gives a natural-language shopping request, such as a product type, style, color, size, budget, availability, rating, image, or shipping destination.",
      "DO NOT use this to resolve a specific product URL. If you have an http/https Shopify product or variant URL, use lookup_catalog first.",
      "Price values are integer minor currency units: 2000 means $20.00 USD and 15000 means $150.00 USD.",
      "For exact budget wording such as 'under $20', use max_price: 2000. For approximate wording such as 'around $20', use a price range rather than claiming an exact hard cutoff.",
      "If a strict search returns no matches, retry with fewer nonessential constraints while preserving the product type and clear must-have requirements. Never claim an over-budget result meets the stated budget.",
      "Results can include promoted placements. A promoted variant has a placement object and must be clearly labeled to the shopper. Use the returned product URL exactly as supplied."
    ].join(" "),
    inputSchema: z.object({
      search: z
        .string()
        .optional()
        .describe(
          "Free-text product discovery query. Use for what the shopper wants, for example: 'waterproof trail running shoes' or 'heavy red pullover hoodie'."
        ),

      // NEW: UCP-compliant similarity search parameter
      like: z
        .array(
          z.union([
            z.object({
              id: z.string().describe("Product or variant GID, e.g., gid://shopify/Product/123 or gid://shopify/ProductVariant/123")
            }),
            z.object({
              image: z.object({
                content_type: z.string().describe("Image MIME type, e.g., image/jpeg, image/png, or image/webp."),
                data: z.string().describe("Base64-encoded image data for visual similarity search.")
              })
            })
          ])
        )
        .optional()
        .describe("Similar item(s) to search by. Use for visual similarity or multimodal search. Pass an array of objects containing either 'id' or 'image'."),
      
      // KEPT: For backward compatibility
      image: z
        .object({
          content_type: z.string().describe("Image MIME type, for example image/jpeg, image/png, or image/webp."),
          data: z.string().describe("Base64-encoded image data for visual or multimodal similarity search.")
        })
        .optional()
        .describe("Optional image for similarity search. Combine with search to describe what should match the image. Do not use for a URL lookup."),

      min_price: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Minimum price in minor currency units. Example: 5000 means $50.00 USD."
        ),

      max_price: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Maximum price in minor currency units. Example: 2000 means $20.00 USD; 15000 means $150.00 USD."
        ),

      price_tier: z
        .array(z.enum(["low", "medium", "high"]))
        .optional()
        .describe(
          "Optional relative price level within the product category. Use for nonnumeric language such as budget, cheap, mid-range, or premium. Allowed values: low, medium, high."
        ),

      in_stock: z
        .boolean()
        .optional()
        .describe(
          "Filter by availability. Omit or set true for sale-ready products. Set false only when the shopper accepts unavailable products."
        ),

      condition: z
        .array(z.enum(["new", "secondhand"]))
        .optional()
        .describe(
          "Optional product condition filter. Allowed values: new or secondhand."
        ),

      shops: z
        .array(z.string())
        .optional()
        .describe(
          "Optional Shopify merchant shop GIDs to restrict this global search to specific stores. Use this when the customer explicitly names a store. Example: gid://shopify/Shop/123. Do not pass a domain such as tattty.com; use the store's Shopify Shop GID."
        ),

      category_ids: z
        .array(z.string())
        .optional()
        .describe(
          "Optional Shopify taxonomy category GIDs only, for example gid://shopify/TaxonomyCategory/123. Do not pass category display names such as 'Hoodies'."
        ),

      color: z
        .array(z.string())
        .optional()
        .describe(
          "Optional color requirement. Supported Global Catalog attribute name: Color. Multiple values mean any listed color is acceptable."
        ),

      size: z
        .array(z.string())
        .optional()
        .describe(
          "Optional size requirement. Supported Global Catalog attribute name: Size. Examples: S, M, L, XL, 10, 10.5."
        ),

      gender: z
        .array(z.string())
        .optional()
        .describe(
          "Optional target-gender requirement. Supported Global Catalog attribute name: Target gender. Examples: Men, Women, Kids, Unisex."
        ),

      min_rating: z
        .number()
        .min(0)
        .max(5)
        .optional()
        .describe("Optional minimum product rating from 0 through 5."),

      min_reviews: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Optional minimum number of reviews."),

      ships_to: z
        .object({
          country: z
            .string()
            .optional()
            .describe("Two-letter destination country code, for example US."),
          region: z
            .string()
            .optional()
            .describe("Destination state, province, or region, for example CA."),
          postal_code: z
            .string()
            .optional()
            .describe("Destination postal or ZIP code, for example 90210.")
        })
        .optional()
        .describe("Optional delivery destination used to return products that ship to the buyer."),

      ships_from: z
        .array(z.string())
        .optional()
        .describe(
          "Optional merchant origin-country preferences using two-letter country codes. Multiple countries use OR logic."
        ),

      language: z
        .string()
        .optional()
        .describe("Result language and formatting locale, for example en."),

      currency: z
        .string()
        .optional()
        .describe("Buyer currency code, for example USD."),

      intent: z
        .string()
        .optional()
        .describe(
          "Optional buyer context that improves relevance but is not necessarily a strict filter. Example: 'runs marathons and needs cushioning'."
        ),

      view: z
        .string()
        .optional()
        .describe("Optional response view. Use offer for comparison shopping."),

      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe(
          "Number of results to return. Minimum 1, maximum 50, default 10. Use 3 to 10 for normal shopper-facing comparisons."
        ),

      cursor: z
        .string()
        .optional()
        .describe(
          "Opaque pagination cursor returned by a previous search result. Reuse it unchanged to fetch the next page."
        )
    })
  },
  async (input) => {
    const filters: Record<string, unknown> = {};

    if (input.in_stock !== undefined) {
      filters.available = input.in_stock;
    }

    if (input.condition?.length) {
      filters.condition = input.condition;
    }

    if (input.ships_to) {
      filters.ships_to = input.ships_to;
    }

    if (input.ships_from?.length) {
      filters.ships_from = input.ships_from.map((country) => ({ country }));
    }

    if (input.min_price !== undefined || input.max_price !== undefined) {
      filters.price = {
        ...(input.min_price !== undefined ? { min: input.min_price } : {}),
        ...(input.max_price !== undefined ? { max: input.max_price } : {})
      };
    }

    if (input.price_tier?.length) {
      filters.price_tier = input.price_tier;
    }

    if (input.category_ids?.length) {
      filters.categories = input.category_ids.map((id) => ({ id }));
    }

    const attributes = [
      ...(input.color?.length ? [{ name: "Color", values: input.color }] : []),
      ...(input.size?.length ? [{ name: "Size", values: input.size }] : []),
      ...(input.gender?.length
        ? [{ name: "Target gender", values: input.gender }]
        : [])
    ];

    if (attributes.length) {
      filters.attributes = attributes;
    }

    if (input.min_rating !== undefined || input.min_reviews !== undefined) {
      filters.rating = {
        variant: {
          ...(input.min_rating !== undefined ? { min: input.min_rating } : {}),
          ...(input.min_reviews !== undefined
            ? { min_count: input.min_reviews }
            : {})
        }
      };
    }

    const catalog: Record<string, unknown> = {
      query: input.search?.trim() || "",
      catalog_id: env.SHOPIFY_CATALOG_ID,
      context: {
        address_country: input.ships_to?.country || "US",
        language: input.language || "en",
        currency: input.currency || "USD",
        ...(input.intent ? { intent: input.intent } : {}),
        ...(input.ships_to?.region
          ? { address_region: input.ships_to.region }
          : {}),
        ...(input.ships_to?.postal_code
          ? { postal_code: input.ships_to.postal_code }
          : {})
      },
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      view: input.view || "offer",
      pagination: {
        limit: Math.min(Math.max(input.limit || 10, 1), 50),
        ...(input.cursor ? { cursor: input.cursor } : {})
      }
    };
        // NEW: Map similarity search to UCP 'like' parameter
    if (input.like?.length) {
      catalog.like = input.like;
    } else if (input.image) {
      catalog.like = [{ image: input.image }];
    }

    const accessToken = await getAccessToken(env);

    const upstream = await fetch("https://catalog.shopify.com/api/ucp/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-03-26",
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`
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

    const context = catalog.context as {
      language: string;
      currency: string;
    };

    const hasPromotedPlacement = products.some((product: any) =>
      (product.variants || []).some((variant: any) => Boolean(variant.placement))
    );

    const markdown = [
      "# Global Catalog Results",
      "",
      hasPromotedPlacement
        ? "> Disclosure: We may earn a commission on purchases made through promoted placements."
        : "",
      "",
      ...products.flatMap((product: any, index: number) => {
        const variant = product.variants?.[0] || {};
        const media = variant.media?.[0] || product.media?.[0] || {};
        const price = variant.price || product.price_range?.min || {};
        const seller = variant.seller || product.seller || {};
        const rating = variant.rating || product.rating || {};
        const placement = variant.placement;
        const title = product.title || variant.title || "Product";
        const description =
          variant.description?.plain || product.description?.plain || "";
        const options = (variant.options || [])
          .map(
            (option: any) =>
              `${option.name || "Option"}: ${option.label || ""}`
          )
          .filter(Boolean)
          .join(" · ");

        const priceText =
          typeof price.amount === "number"
            ? new Intl.NumberFormat(context.language, {
                style: "currency",
                currency: price.currency || context.currency
              }).format(price.amount / 100)
            : "Price unavailable";

        const ratingText =
          typeof rating.value === "number"
            ? `Rating: ${rating.value}/${rating.scale_max || 5}${
                typeof rating.count === "number"
                  ? ` (${rating.count.toLocaleString()} reviews)`
                  : ""
              }`
            : "";

        const promotedText = placement
          ? "Sponsored / Promoted placement — we may earn a commission on a qualifying purchase."
          : "";

        const extraCommission =
          placement?.commission?.percentage?.value;

        const commissionText =
          typeof extraCommission === "number"
            ? `Merchant-added commission: +${extraCommission.toFixed(2)}%.`
            : "";

        return [
          `## ${index + 1}. ${title}`,
          "",
          media.url ? `![${media.alt_text || title}](${media.url})` : "",
          "",
          promotedText,
          `**${priceText}**${seller.name ? ` · ${seller.name}` : ""}`,
          commissionText,
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
      products.length === 0
        ? "No matching products found. Broaden the nonessential constraints and search again."
        : "",
      // NEW: Explicitly expose the cursor so the LLM agent can actually use it
      pagination.has_next_page && pagination.cursor
        ? `> 💡 **Pagination:** More results are available. Use the cursor \`${pagination.cursor}\` in your next search request to load the next page.`
        : "",
      ...messages
        .map((message: any) => message.content || message.message || "")
        .filter(Boolean)
        .map((message: string) => `> ${message}`)
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [{ type: "text" as const, text: markdown }]
    };
  }
);

  registerLookupCatalog(server, env);
  registerGetProduct(server, env);
  registerCreateCheckout(server, env);
  registerCompleteCheckout(server, env);
  registerUpdateCheckout(server, env);
  registerCancelCheckout(server, env);

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // 1. Extract the user's Shop access token from the request headers (if they are signed in)
    const shopAccessToken = request.headers.get("x-shop-access-token") || undefined;

    // 2. Enrich the env object with the token so all tools can access it via getAccessToken(env)
    const enrichedEnv = {
      ...env,
      SHOP_ACCESS_TOKEN: shopAccessToken
    };

    // 3. Pass the enriched env to the MCP handler
    return createMcpHandler(() => createServer(enrichedEnv))(request, enrichedEnv, ctx);
  }
} satisfies ExportedHandler<Env>;
