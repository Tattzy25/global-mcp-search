import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { getAccessToken } from "../auth";

export function registerCompleteCheckout(server: McpServer, env: Env) {
  server.registerTool(
    "complete_checkout",
    {
      title: "Complete Checkout",
      description: "Submit payment and finalize the order. Use ONLY when checkout status is ready_for_complete. Requires passing payment instruments if handled natively.",
      inputSchema: z.object({
        shop_domain: z.string().describe("Required. The merchant's shop domain."),
        checkout_id: z.string().describe("Required. The ID of the checkout session to complete."),
        checkout: z.object({
          payment: z.object({
            instruments: z.array(z.record(z.string(), z.any()))
          }).optional()
        }).optional().describe("Optional checkout payload containing payment credentials.")
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
            name: "complete_checkout",
            arguments: {
              meta: { 
                "ucp-agent": { profile: env.AGENT_PROFILE_URL },
                "idempotency-key": crypto.randomUUID() // Crucial for retry safety
              },
              id: input.checkout_id,
              ...(input.checkout && { checkout: input.checkout })
            }
          }
        })
      });

      const shopifyResponse = await upstream.json() as any;

      if (shopifyResponse.error) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `INTERNAL SYSTEM NOTE: Completion failed. Code: ${shopifyResponse.error.code}. Message: ${shopifyResponse.error.message}. AGENT DIRECTIVE: If this is a payment failure, prompt the customer for a new payment method. Do not expose raw JSON.` 
          }]
        };
      }

      const checkoutData = shopifyResponse.result?.structuredContent;
      const order = checkoutData?.order;

         if (checkoutData?.status === "requires_escalation" && checkoutData?.continue_url) {
     let ecpUrl = checkoutData.continue_url;
     const url = new URL(ecpUrl);
     url.searchParams.set("ec_version", "2026-01-23");
     url.searchParams.set("ec_auth", accessToken);
     url.searchParams.set("ec_delegate", "fulfillment.address_change,payment.instruments_change,payment.credential");
     return {
          content: [{ 
            type: "text" as const, 
            text: `INTERNAL SYSTEM NOTE: The merchant requires secure buyer verification. AGENT DIRECTIVE: Hand off the following Embedded Checkout URL to the frontend UI so the customer can click to pay. URL: ${url.toString()}` 
          }]
        };
      }

      // Handle Success
      const markdown = [
        "### 🎉 Order Successfully Placed",
        `Order ID: ${order?.id || 'Pending'}`,
        `Permalink: ${order?.permalink_url || 'N/A'}`,
        "",
        "AGENT DIRECTIVE: Congratulate the buyer on securing their items. Provide the Order ID and confirm that a receipt has been sent to their email. Ask if they need help tracking the order or looking for complementary items."
      ].join("\n");

      return {
        content: [{ type: "text" as const, text: markdown }]
      };
    }
  );
}