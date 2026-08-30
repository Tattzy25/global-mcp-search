import type { Env } from "../index";

type UcpRpcError = {
	code?: number | string;
	message?: string;
	data?: unknown;
};

type UcpRpcResponse = {
	jsonrpc?: "2.0";
	id?: string | number | null;
	result?: {
		structuredContent?: {
			cart?: Record<string, unknown>;
			[key: string]: unknown;
		};
		content?: unknown[];
		[key: string]: unknown;
	};
	error?: UcpRpcError;
	[key: string]: unknown;
};

export type CartInput = {
	line_items: Array<{
		quantity: number;
		item: {
			id: string;
		};
	}>;
	context?: {
		address_country?: string;
		address_region?: string;
		postal_code?: string;
	};
	attribution?: Record<string, unknown>;
	buyer?: Record<string, unknown>;
};

export function toShopUrl(shopDomain: string): string {
	return (shopDomain.startsWith("http") ? shopDomain : `https://${shopDomain}`).replace(
		/\/+$/,
		"",
	);
}

export function toUcpCart(cart: CartInput) {
	return {
		lineitems: cart.line_items.map((line) => ({
			quantity: line.quantity,
			item: {
				id: line.item.id,
			},
		})),
		...(cart.context
			? {
					context: {
						...(cart.context.address_country
							? { addresscountry: cart.context.address_country }
							: {}),
						...(cart.context.address_region
							? { addressregion: cart.context.address_region }
							: {}),
						...(cart.context.postal_code
							? { postalcode: cart.context.postal_code }
							: {}),
					},
				}
			: {}),
		...(cart.attribution ? { attribution: cart.attribution } : {}),
		...(cart.buyer ? { buyer: cart.buyer } : {}),
	};
}

function asToolError(value: Record<string, unknown>) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(value),
			},
		],
		structuredContent: value,
		isError: true,
	};
}

export async function callCartMcp(
	env: Env,
	input: {
		shop_domain: string;
		name: "create_cart" | "get_cart" | "update_cart" | "cancel_cart";
		arguments: Record<string, unknown>;
	},
) {
	const shopUrl = toShopUrl(input.shop_domain);
	const rpcId = crypto.randomUUID();
	const { meta: inputMeta, ...toolArguments } = input.arguments;
	const toolMeta = inputMeta === undefined ? {} : (inputMeta as Record<string, unknown>);

	let response: Response;

	try {
		response = await fetch(`${shopUrl}/api/ucp/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				"MCP-Protocol-Version": "2026-04-08",
				"Cache-Control": "no-store",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: rpcId,
				method: "tools/call",
				params: {
					name: input.name,
					arguments: {
						...toolArguments,
						meta: {
							"ucp-agent": {
								profile: env.AGENT_PROFILE_URL,
							},
							...toolMeta,
						},
					},
				},
			}),
		});
	} catch (cause) {
		return asToolError({
			error: {
				type: "transport_error",
				shop_domain: input.shop_domain,
				endpoint: `${shopUrl}/api/ucp/mcp`,
				message: cause instanceof Error ? cause.message : String(cause),
			},
		});
	}

	const raw = await response.text();

	if (!response.ok) {
		return asToolError({
			error: {
				type: "upstream_http_error",
				shop_domain: input.shop_domain,
				endpoint: `${shopUrl}/api/ucp/mcp`,
				status: response.status,
				status_text: response.statusText,
				body: raw.slice(0, 10_000),
			},
		});
	}

	let payload: UcpRpcResponse;

	try {
		payload = JSON.parse(raw) as UcpRpcResponse;
	} catch {
		return asToolError({
			error: {
				type: "invalid_upstream_response",
				shop_domain: input.shop_domain,
				endpoint: `${shopUrl}/api/ucp/mcp`,
				body: raw.slice(0, 10_000),
			},
		});
	}

	if (payload.error) {
		return asToolError({
			upstream: payload,
		});
	}

	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(payload),
			},
		],
		structuredContent: payload,
	};
}
