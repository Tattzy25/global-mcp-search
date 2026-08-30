import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { callCartMcp } from "./ucpCart";

export function registerCancelCart(server: McpServer, env: Env) {
	server.registerTool(
		"cancel_cart",
		{
			title: "Cancel Cart",
			description:
				"Cancels a merchant-scoped UCP cart. Works for carts created from global catalog or storefront catalog product selection.",
			inputSchema: z.object({
				shop_domain: z.string().describe("Merchant domain that owns the cart."),
				cart_id: z.string().describe("Merchant-issued cart ID."),
			}),
		},
		async (input) =>
			callCartMcp(env, {
				shop_domain: input.shop_domain,
				name: "cancel_cart",
				arguments: {
					id: input.cart_id,
					meta: {
						"idempotency-key": crypto.randomUUID(),
					},
				},
			}),
	);
}
