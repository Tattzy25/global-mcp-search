import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { getAccessToken } from "../auth";

export function registerGetProduct(server: McpServer, env: Env) {
  server.registerTool(
    "get_product", // FIXED: Removed trailing space
    {
      title: "Get Product Details",
      description: "Retrieves full details for a single product, including available options (sizes, colors) and specific variants. Use when a customer wants more info on a specific item or needs to select options.",
      inputSchema: z.object({
        id: z
          .string()
          .describe("Required. Product or variant identifier. Accepts gid://shopify/p/{upid} or gid://shopify/ProductVariant/{id}."),
        selected: z
          .array(
            z.object({
              name: z.string().describe("Option name, e.g., 'Color' or 'Size'"),
              label: z.string().describe("Selected value, e.g., 'Black' or '10'")
            })
          )
          .optional()
          .describe("Option selections for variant narrowing. Example: [{'name': 'Color', 'label': 'Black'}]"),
        preferences: z
          .array(z.string())
          .optional()
          .describe("Option names in relaxation priority order. Example: ['Color', 'Size']."),
        in_stock: z
          .boolean()
          .optional()
          .describe("Filter by availability. Defaults to true (only sale-ready items)."),
        condition: z
          .array(z.string())
          .optional()
          .describe("Optional product condition filter. Known values: 'new', 'secondhand'."),
        shops: z
          .array(z.string())
          .optional()
          .describe("Optional array of specific shop GIDs to filter by."),
        ships_to: z
          .object({
            country: z.string().optional().describe("Two-letter destination country code. Example: US."),
            region: z.string().optional().describe("Destination state, province, or region. Example: CA."),
            postal_code: z.string().optional().describe("Destination postal code. Example: 90210.")
          })
          .optional()
          .describe("Filter to products that ship to a given location."),
        ships_from: z
          .array(z.string())
          .optional()
          .describe("Filter by merchant origin country (ISO 3166-1 alpha-2). Example: US or CA."),
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
          .describe("Optional shopping context to improve relevance."),
        view: z
          .string()
          .optional()
          .describe("Predefined output shape. Use 'summary' for a condensed view.")
      })
    },
    async (input) => {
      const filters: Record<string, unknown> = {};
      if (input.in_stock !== undefined) filters.available = input.in_stock;
      if (input.condition?.length) filters.condition = input.condition;
      if (input.shops?.length) filters.shops = input.shops;
      if (input.ships_to) filters.ships_to = input.ships_to;
      if (input.ships_from?.length) filters.ships_from = input.ships_from.map(country => ({ country }));
      
      const catalog: Record<string, unknown> = {
        id: input.id,
        context: {
          address_country: input.ships_to?.country || "US",
          language: input.language || "en",
          currency: input.currency || "USD",
          ...(input.intent ? { intent: input.intent } : {}),
          ...(input.ships_to?.region ? { address_region: input.ships_to.region } : {}),
          ...(input.ships_to?.postal_code ? { postal_code: input.ships_to.postal_code } : {})
        },
        ...(Object.keys(filters).length > 0 ? { filters } : {})
      };
      
      if (input.selected?.length) catalog.selected = input.selected;
      if (input.preferences?.length) catalog.preferences = input.preferences;
      if (input.view) catalog.view = input.view;

      const accessToken = await getAccessToken(env);

      // FIXED: Removed ALL trailing spaces from fetch URL, headers, and JSON body
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
          id: 3,
          params: {
            name: "get_product", // FIXED: Was "getproduct "
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
      const product = shopifyResponse.result?.structuredContent?.product;
      const messages = shopifyResponse.result?.structuredContent?.messages || [];
      const context = catalog.context as { language: string; currency: string; };
      
      const formatPrice = (priceObj: any) => {
        if (!priceObj || typeof priceObj.amount !== "number") return "Price unavailable";
        return new Intl.NumberFormat(context.language, { 
          style: "currency", 
          currency: priceObj.currency || context.currency 
        }).format(priceObj.amount / 100);
      };

      let markdown: string[] = [];

      if (product) {
        const media = product.media?.[0] || {};
        const title = product.title || "Product";
        const description = product.description?.plain || product.description?.html?.replace(/<[^>]*>?/gm, '') || "";
        const metadata = product.metadata || {}; // NEW: Capture inferred metadata
        
        let priceStr = "";
        if (product.price_range) {
          if (product.price_range.min?.amount === product.price_range.max?.amount) {
            priceStr = formatPrice(product.price_range.min);
          } else {
            priceStr = `${formatPrice(product.price_range.min)} - ${formatPrice(product.price_range.max)}`;
          }
        }

        const rating = product.rating || {};
        const ratingText = typeof rating.value === "number"
          ? `Rating: ${rating.value}/${rating.scale_max || 5}${typeof rating.count === "number" ? ` (${rating.count.toLocaleString()} reviews)` : ""}`
          : "";

        markdown.push(
          `# ${title}`,
          "",
          media.url ? `![${media.alt_text || title}](${media.url})` : "",
          "",
          `**${priceStr}**`,
          ratingText,
          "",
          description,
          ""
        );

        // NEW: Display inferred metadata for a "MAXIMAL" agent experience
        if (metadata.top_features?.length || metadata.unique_selling_points?.length) {
          markdown.push("### ✨ Highlights");
          if (metadata.top_features?.length) {
            markdown.push(`**Top Features:** ${metadata.top_features.join(" • ")}`);
          }
          if (metadata.unique_selling_points?.length) {
            markdown.push(`**Why it stands out:** ${metadata.unique_selling_points.join(" • ")}`);
          }
          markdown.push("");
        }

        if (metadata.attributes?.length || metadata.tech_specs?.length) {
          markdown.push("### 📋 Specifications");
          if (metadata.attributes?.length) {
            metadata.attributes.forEach((attr: any) => {
              markdown.push(`- **${attr.name}**: ${attr.value || attr}`);
            });
          }
          if (metadata.tech_specs?.length) {
            metadata.tech_specs.forEach((spec: string) => {
              markdown.push(`- ${spec}`);
            });
          }
          markdown.push("");
        }

        markdown.push(
          product.url ? `[View on store](${product.url})` : "",
          "---"
        );

        if (product.options && product.options.length > 0) {
          markdown.push("### Options");
          product.options.forEach((opt: any) => {
            const values = (opt.values || []).map((v: any) => {
              return v.available ? v.label : `~~${v.label}~~ (Out of Stock)`;
            }).join(" · ");
            markdown.push(`**${opt.name}**: ${values}`);
          });
          markdown.push("");
        }

        if (product.variants && product.variants.length > 0) {
          markdown.push("### Available Variants");
          product.variants.forEach((variant: any) => {
            const seller = variant.seller?.name ? ` · ${variant.seller.name}` : "";
            const vPrice = formatPrice(variant.price);
            
            // NEW: Promoted placement disclosure for variants
            const placement = variant.placement;
            const promotedText = placement ? "⚠️ Sponsored / Promoted placement — we may earn a commission." : "";
            const extraCommission = placement?.commission?.percentage?.value;
            const commissionText = typeof extraCommission === "number" ? `Merchant-added commission: +${extraCommission.toFixed(2)}%.` : "";
            
            markdown.push(
              `**${variant.title}** - ${vPrice}${seller}`,
              promotedText,
              commissionText,
              variant.checkout_url ? `[Buy Now](${variant.checkout_url})` : "",
              `ID: \`${variant.id}\``,
              ""
            );
          });
        }
      }

      const messageStrings = messages
        .map((msg: any) => {
          if (msg.code === "not_found") return `> ⚠️ **Item Not Found:** ${msg.content}`;
          return `> ${msg.content || msg.message || ""}`;
        })
        .filter(Boolean);

      markdown.push(...messageStrings);

      if (!product && messageStrings.length === 0) {
        markdown.push("No product details found.");
      }

      return { 
        content: [{ type: "text" as const, text: markdown.filter(Boolean).join("\n") }] 
      };
    }
  );
}