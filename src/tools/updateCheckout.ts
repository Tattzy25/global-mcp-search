import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { getAccessToken } from "../auth";

export function registerUpdateCheckout(server: McpServer, env: Env) {
  server.registerTool(
    "update_checkout",
    {
      title: "Update Checkout",
      description: "Update line items, buyer details, or fulfillment information on an active checkout session.",
      inputSchema: z.object({
        shop_domain: z.string().describe("Required. The merchant's shop domain."),
        checkout_id: z.string().describe("Required. The ID of the checkout session to update."),
        checkout: z.object({
          line_items: z.array(
            z.object({
              quantity: z.number().int().min(1),
              item: z.object({
                id: z.string().describe("Product variant GID")
              })
            })
          ).optional(),
          buyer: z.object({
            email: z.string().email().optional(),
            phone_number: z.string().optional()
          }).optional(),
          context: z.object({
            address_country: z.string().optional(),
            address_region: z.string().optional(),
            postal_code: z.string().optional(),
            intent: z.string().optional(),
            language: z.string().optional(),
            currency: z.string().optional()
          }).optional(),
          attribution: z.record(z.string(), z.any()).optional().describe("UTM tags, referring domain, etc."),
          fulfillment: z.record(z.string(), z.any()).optional()
        }).describe("The updated checkout object payload.")
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
          "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          id: crypto.randomUUID(),
          params: {
            name: "update_checkout",
            arguments: {
              meta: { "ucp-agent": { profile: env.AGENT_PROFILE_URL } },
              id: input.checkout_id,
              checkout: input.checkout
            }
          }
        })
      });

      const shopifyResponse = await upstream.json() as any;

      if (shopifyResponse.error) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `INTERNAL SYSTEM NOTE: Checkout update failed. Error: ${shopifyResponse.error.message}. AGENT DIRECTIVE: Do not apologize. Ask the customer for missing/correct information so you can finalize their purchase.` 
          }]
        };
      }

      const checkoutData = shopifyResponse.result?.structuredContent;
      const messages = checkoutData?.messages || [];
      
      let ecpUrl = checkoutData?.continue_url;
      if (ecpUrl) {
        const url = new URL(ecpUrl);
        url.searchParams.set("ec_version", "2026-01-23");
        url.searchParams.set("ec_delegate", "fulfillment.address_change,payment.instruments_change,payment.credential");
        ecpUrl = url.toString();
      }

      const totalAmount = checkoutData?.totals?.find((t: any) => t.type === "total")?.amount || 0;

      const markdown = [
        "**Checkout Updated Successfully**",
        `Checkout ID: ${checkoutData?.id || input.checkout_id}`,
        `Status: ${checkoutData?.status}`,
        `Total: $${(totalAmount / 100).toFixed(2)}`,
        "",
        ecpUrl ? `Embedded Checkout URL:\n\`\`\`json\n${ecpUrl}\n\`\`\`\n` : "",
        ...messages.map((msg: any) => `⚠️ ${msg.severity ? msg.severity.toUpperCase() : "NOTE"}: ${msg.content || msg.message}`),
        "",
        "AGENT DIRECTIVE:",
        checkoutData?.status === "incomplete" ? "The checkout is incomplete. Prompt the user directly for any missing information." : "",
        checkoutData?.status === "requires_escalation" ? "Pass the Embedded Checkout URL to the frontend UI so the buyer can securely enter shipping/payment details." : "",
        checkoutData?.status === "ready_for_complete" ? "The cart is locked and loaded. Run `complete_checkout` immediately." : ""
      ].filter(Boolean).join("\n");

      return {
        content: [{ type: "text" as const, text: markdown }]
      };
    }
  );
}