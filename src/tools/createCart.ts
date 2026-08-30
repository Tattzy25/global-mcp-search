import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { getAccessToken } from "../auth"; // ADDED

export function registerCreateCart(server: McpServer, env: Env) {
  server.registerTool(
    "create_cart",
    {
      title: "Create Cart",
      description: "Create a new shopping cart with line items and optional buyer context. Use this during the browsing phase before the buyer is ready to pay.",
      inputSchema: z.object({
        shop_domain: z.string().describe("Required. The merchant's shop domain."),
        cart: z.object({
          line_items: z.array(
            z.object({
              quantity: z.number().int().min(1),
              item: z.object({
                id: z.string().describe("Product variant GID")
              })
            })
          ).min(1).describe("Required array of items to add to the cart."),
          context: z.object({
            address_country: z.string().optional(),
            address_region: z.string().optional(),
            postal_code: z.string().optional()
          }).optional().describe("Localization hints for pricing/currency estimates."),
          attribution: z.record(z.string(), z.any()).optional().describe("UTM tags, referring domain, etc."),
          buyer: z.record(z.string(), z.any()).optional()
        })
      })
    },
    async (input) => {
      const accessToken = await getAccessToken(env); // ADDED
      const shopUrl = input.shop_domain.startsWith("http") ? input.shop_domain : `https://${input.shop_domain}`;
      
      const upstream = await fetch(`${shopUrl}/api/ucp/mcp`, {
        method: "POST",
        headers: {
  "Content-Type": "application/json",
  "MCP-Protocol-Version": "2026-04-08",
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Cache-Control": "public, max-age=3600",
  "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          id: crypto.randomUUID(),
          params: {
            name: "create_cart",
            arguments: {
              meta: { "ucp-agent": { profile: env.AGENT_PROFILE_URL } },
              cart: input.cart
            }
          }
        })
      });

      const shopifyResponse = await upstream.json() as any;
      if (shopifyResponse.error) {
        return {
          content: [{ type: "text" as const, text: `INTERNAL SYSTEM NOTE: Failed to create cart. Error: ${shopifyResponse.error.message}. AGENT DIRECTIVE: Inform the customer there was an issue adding the item and try again.` }]
        };
      }
      
      const cartData = shopifyResponse.result?.structuredContent?.cart;
      const totalAmount = cartData?.totals?.find((t: any) => t.type === "total")?.amount || 0;
      
      const markdown = [
        "### Cart Created Successfully",
        `Cart ID: ${cartData?.id}`,
        `Total Estimate: $${(totalAmount / 100).toFixed(2)}`,
        "",
        "AGENT DIRECTIVE:",
        "The cart is active. Iterate on it using `update_cart`. When the buyer says they are ready to buy, pass this Cart ID to `create_checkout`."
      ].filter(Boolean).join("\n");
      
      return {
        content: [{ type: "text" as const, text: markdown }]
      };
    }
  );
}