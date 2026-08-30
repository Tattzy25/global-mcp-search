import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { callCartMcp, toUcpCart } from "./ucpCart";

const replacementCartSchema = z.object({
	line_items: z
		.array(
			z.object({
				quantity: z.number().int().min(1),
				item: z.object({
					id: z.string().describe("Merchant product variant GID."),
				}),
			}),
		)
		.min(1)
		.describe(
			"Required full replacement line-item array. Preserve all desired items because update_cart replaces the cart.",
		),
	context: z
		.object({
			address_country: z.string().optional(),
			address_region: z.string().optional(),
			postal_code: z.string().optional(),
		})
		.optional(),
	attribution: z.record(z.string(), z.unknown()).optional(),
	buyer: z.record(z.string(), z.unknown()).optional(),
});

export function registerUpdateCart(server: McpServer, env: Env) {
	server.registerTool(
		"update_cart",
		{
			title: "Update Cart",
			description:
				"Replaces a merchant cart's full state. The complete desired line-item array must be supplied.",
			inputSchema: z.object({
				shop_domain: z.string().describe("Merchant domain that owns the cart."),
				cart_id: z.string().describe("Merchant-issued cart ID."),
				cart: replacementCartSchema,
			}),
		},
		async (input) =>
			callCartMcp(env, {
				shop_domain: input.shop_domain,
				name: "update_cart",
				arguments: {
					id: input.cart_id,
					cart: toUcpCart(input.cart),
				},
			}),
	);
}
