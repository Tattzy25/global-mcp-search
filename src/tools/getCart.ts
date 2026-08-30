import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { callCartMcp } from "./ucpCart";

export function registerGetCart(server: McpServer, env: Env) {
	server.registerTool(
		"get_cart",
		{
			title: "Get Cart",
			description:
				"Retrieves a merchant-scoped UCP cart using its merchant domain and cart ID.",
			inputSchema: z.object({
				shop_domain: z.string().describe("Merchant domain that owns the cart."),
				cart_id: z.string().describe("Merchant-issued cart ID."),
			}),
		},
		async (input) =>
			callCartMcp(env, {
				shop_domain: input.shop_domain,
				name: "get_cart",
				arguments: {
					id: input.cart_id,
				},
			}),
	);
}
