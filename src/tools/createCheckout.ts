import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { getAccessToken } from "../auth";

export function registerCreateCheckout(server: McpServer, env: Env) {
  server.registerTool(
    "create_checkout",
    {
      title: "Create Checkout Session",
      description: [
        "Use this tool when the buyer is ready to purchase items and you need to initiate the checkout process.",
        "You can either provide a cart_id to convert an existing cart into a checkout, OR provide a full checkout object with line_items and buyer info.",
        "If cart_id is provided, the checkout object becomes optional, and the cart's contents will be used.",
        "The response will include a continue_url. You must pass this URL to the frontend to load the Embedded Checkout Protocol."
      ].join(" "),
      inputSchema: z.object({
        shop_domain: z
          .string()
          .describe("Required. The shop domain where the checkout is happening (e.g., 'example.myshopify.com')."),
        cart_id: z
          .string()
          .optional()
          .describe("Optional. The ID of an existing cart to convert into a checkout."),
        checkout: z
          .object({
            currency: z.string().describe("ISO 4217 currency code, e.g., 'USD'."),
            line_items: z
              .array(
                z.object({
                  quantity: z.number().int().min(1),
                  item: z.object({
                    id: z.string().describe("Product variant GID, e.g., gid://shopify/ProductVariant/123")
                  })
                })
              )
              .optional()
              .describe("Required if cart_id is not provided. Array of items to purchase."),
            buyer: z
              .object({
                email: z.string().email().optional(),
                phone_number: z.string().optional()
              })
              .optional()
              .describe("Required if cart_id is not provided. Must include at least email or phone_number."),
            fulfillment: z
              .object({
                methods: z.array(
                  z.object({
                    type: z.literal("shipping"),
                    destinations: z.array(
                      z.object({
                        first_name: z.string(),
                        last_name: z.string(),
                        street_address: z.string(),
                        address_locality: z.string(),
                        address_region: z.string(),
                        postal_code: z.string(),
                        address_country: z.string().length(2).describe("ISO 3166-1 alpha-2 country code, e.g., 'US'")
                      })
                    )
                  })
                ).optional()
              })
              .optional()
          })
          .optional()
          .describe("The checkout payload. Optional if cart_id is provided.")
      })
    },
    async (input) => {
      const accessToken = await getAccessToken(env);
      
      const shopUrl = input.shop_domain.startsWith("http") 
        ? input.shop_domain 
        : `https://${input.shop_domain}`;

      const payload: Record<string, unknown> = {
        meta: {
          "ucp-agent": {
            profile: env.AGENT_PROFILE_URL
          }
        }
      };

      if (input.cart_id) {
        payload.cart_id = input.cart_id;
      }
      
      if (input.checkout) {
        payload.checkout = input.checkout;
      }

      if (!input.cart_id && !input.checkout) {
        return {
          content: [{ 
            type: "text" as const, 
            text: "Error: You must provide either a cart_id or a checkout object to create a checkout session." 
          }]
        };
      }

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
          id: 4,
          params: {
            name: "create_checkout",
            arguments: payload
          }
        })
      });

      const shopifyResponse = await upstream.json() as any;
      
      // Handle protocol errors silently and professionally for the Agent
      if (shopifyResponse.error) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Checkout system error: ${shopifyResponse.error.message}. Please inform the customer that there is a temporary issue processing the checkout and ask them to try again in a moment.` 
          }]
        };
      }

      const checkoutData = shopifyResponse.result?.structuredContent;
      const messages = checkoutData?.messages || [];
      
      if (!checkoutData) {
        return {
          content: [{ type: "text" as const, text: "Failed to create checkout. No structured content returned from the server." }]
        };
      }

      // Construct the Embedded Checkout Protocol (ECP) URL cleanly
   let ecpUrl = checkoutData.continue_url;
   if (ecpUrl) {
     const url = new URL(ecpUrl);
     url.searchParams.set("ec_version", "2026-01-23");
     url.searchParams.set("ec_auth", accessToken);
     url.searchParams.set("ec_delegate", "fulfillment.address_change,payment.instruments_change,payment.credential");
     ecpUrl = url.toString();
   }

      // Format a clean, actionable, emoji-free response for the LLM Agent
      const statusText = checkoutData.status === "requires_escalation" 
        ? "Action Required: The buyer must complete this checkout in the embedded UI. Provide the customer with the Embedded Checkout URL below." 
        : `Status: ${checkoutData.status}`;

      const totalAmount = checkoutData.totals?.find((t: any) => t.type === "total")?.amount || 0;
      const totalDisplay = checkoutData.totals?.find((t: any) => t.type === "total")?.display_text || "Total";

      const markdown = [
        "### Checkout Session Created",
        "",
        `Checkout ID: ${checkoutData.id}`,
        `Status: ${checkoutData.status}`,
        `${totalDisplay}: $${(totalAmount / 100).toFixed(2)}`,
        "",
        statusText,
        "",
        ecpUrl ? `Embedded Checkout URL: \n\`\`\`json\n${ecpUrl}\n\`\`\`\n(Pass this URL to your frontend ECP Webview/Iframe component)` : "",
        "",
        ...messages.map((msg: any) => `Note: ${msg.content}`),
        "",
        "Next Steps for Agent:",
        "1. Provide the Embedded Checkout URL to the user's frontend.",
        "2. If the status is 'incomplete', ask the user for missing info (e.g., email, shipping address) and use the update_checkout tool.",
        "3. If the status is 'requires_escalation', the frontend will handle the ECP flow and notify you when the purchase is complete."
      ].filter(Boolean).join("\n");

      return {
        content: [{ type: "text" as const, text: markdown }]
      };
    }
  );
}