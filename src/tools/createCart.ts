import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "../index";
import { callCartMcp, toUcpCart } from "./ucpCart";

const cartSchema = z.object({
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
		.describe("Complete list of cart line items."),
	context: z
		.object({
			address_country: z.string().optional(),
			address_region: z.string().optional(),
			postal_code: z.string().optional(),
		})
		.optional()
		.describe("Localization hints; not an authoritative shipping address."),
	attribution: z.record(z.string(), z.unknown()).optional(),
	buyer: z.record(z.string(), z.unknown()).optional(),
});

export function registerCreateCart(server: McpServer, env: Env) {
	server.registerTool(
		"create_cart",
		{
			title: "Create Cart",
			description:
				"Creates a merchant-scoped UCP cart. Use the selected offer's seller domain for global-catalog items or the storefront merchant domain for storefront items.",
			inputSchema: z.object({
				shop_domain: z
					.string()
					.describe("Merchant domain that owns the selected product variant."),
				cart: cartSchema,
			}),
		},
		async (input) =>
			callCartMcp(env, {
				shop_domain: input.shop_domain,
				name: "create_cart",
				arguments: {
					cart: toUcpCart(input.cart),
				},
			}),
	);
}
