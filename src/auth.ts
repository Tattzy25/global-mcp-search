import type { Env } from "./index";

export type UcpAuth = { mode: "anonymous" } | { mode: "bearer"; accessToken: string };

type ShopifyTokenResponse = {
	access_token?: string;
};

const DEFAULT_UCP_SCOPE = [
	"dev.ucp.shopping.catalog.search:read",
	"dev.ucp.shopping.catalog.lookup:read",
	"dev.ucp.shopping.cart:manage",
	"dev.ucp.shopping.checkout:manage",
	"dev.ucp.shopping.order:read",
	"dev.ucp.shopping.order:manage",
].join(" ");

async function readTokenResponse(response: Response, operation: string): Promise<string> {
	const raw = await response.text();

	if (!response.ok) {
		throw new Error(
			`${operation} failed: ${response.status} ${response.statusText}. ${raw.slice(0, 2_000)}`,
		);
	}

	let payload: ShopifyTokenResponse;

	try {
		payload = JSON.parse(raw) as ShopifyTokenResponse;
	} catch {
		throw new Error(`${operation} returned non-JSON: ${raw.slice(0, 2_000)}`);
	}

	if (!payload.access_token) {
		throw new Error(`${operation} returned no access_token.`);
	}

	return payload.access_token;
}

export async function getAppAccessToken(env: Env, scope: string): Promise<string> {
	const response = await fetch("https://api.shopify.com/auth/access_token", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			client_id: env.SHOPIFY_CLIENT_ID,
			client_secret: env.SHOPIFY_CLIENT_SECRET,
			grant_type: "client_credentials",
			scope,
		}),
	});

	return readTokenResponse(response, "Shopify app token request");
}

export async function getBuyerLinkedAccessToken(
	env: Env,
	shopAccessToken: string,
	scope: string,
): Promise<string> {
	const grantResponse = await fetch("https://accounts.shop.app/oauth/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
			subject_token: shopAccessToken,
			subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
			requested_token_type: "urn:ietf:params:oauth:token-type:jwt",
			audience: "api.shopify.com",
			client_id: env.SHOPIFY_CLIENT_ID,
			client_secret: env.SHOPIFY_CLIENT_SECRET,
		}).toString(),
	});

	const assertion = await readTokenResponse(grantResponse, "Shop token exchange");

	const tokenResponse = await fetch("https://api.shopify.com/auth/access_token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion,
			scope,
			client_id: env.SHOPIFY_CLIENT_ID,
			client_secret: env.SHOPIFY_CLIENT_SECRET,
		}).toString(),
	});

	return readTokenResponse(tokenResponse, "Buyer-linked token redemption");
}

/**
 * Compatibility export for existing Checkout MCP tools:
 *
 *   import { getAccessToken } from "../auth";
 *
 * If a signed-in buyer's Shop access token exists, use the documented
 * delegated-identity token exchange. Otherwise, use the documented
 * client-credentials app-token flow.
 *
 * There is no catch, retry, anonymous downgrade, or hidden fallback:
 * whichever selected flow fails throws its real error to the caller.
 */
export async function getAccessToken(env: Env): Promise<string> {
	const shopAccessToken = env.SHOP_ACCESS_TOKEN;

	if (shopAccessToken) {
		return getBuyerLinkedAccessToken(env, shopAccessToken, DEFAULT_UCP_SCOPE);
	}

	return getAppAccessToken(env, DEFAULT_UCP_SCOPE);
}
