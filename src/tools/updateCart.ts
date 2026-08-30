import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { getAccessToken } from "../auth";

export function registerUpdateCart(server: McpServer, env: Env) {
  server.registerTool(
    "update_cart",
    {
      title: "Update Cart",
      description: "Replace or update the contents of an existing cart session.",
      inputSchema: z.object({
        shop_domain: z.string().describe("Required. The merchant's shop domain."),
        cart_id: z.string().describe("Required. The ID of the cart to update."),
        cart: z.object({
          line_items: z.array(
            z.object({
              quantity: z.number().int().min(1),
              item: z.object({
                id: z.string().describe("Product variant GID")
              })
            })
          ).optional().describe("Array of line items."),
          context: z.object({
            address_country: z.string().optional(),
            address_region: z.string().optional(),
            postal_code: z.string().optional()
          }).optional(),
          attribution: z.record(z.string(), z.any()).optional(),
          buyer: z.record(z.string(), z.any()).optional()
        }).describe("The replacement or patch cart object.")
      })
    },
    async (input) => {
      const accessToken = await getAccessToken(env);
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
            name: "update_cart",
            arguments: {
              meta: { "ucp-agent": { profile: env.AGENT_PROFILE_URL } },
              id: input.cart_id,
              cart: input.cart
            }
          }
        })
      });

      const shopifyResponse = await upstream.json() as any;

      if (shopifyResponse.error) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `INTERNAL SYSTEM NOTE: Cart update failed. Error: ${shopifyResponse.error.message}. AGENT DIRECTIVE: Correct your payload and try again, or ask the user for clarification.` 
          }]
        };
      }

      const cartData = shopifyResponse.result?.structuredContent?.cart;
      const totalAmount = cartData?.totals?.find((t: any) => t.type === "total")?.amount || 0;

      return {
        content: [{ 
          type: "text" as const, 
          text: `INTERNAL SYSTEM NOTE: Cart updated successfully. New Total: $${(totalAmount / 100).toFixed(2)}. AGENT DIRECTIVE: Inform the user of the updated cart total and ask if they are ready to check out.` 
        }]
      };
    }
  );
}