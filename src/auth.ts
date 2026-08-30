import type { Env } from "./index";

export async function getAccessToken(env: Env): Promise<string> {
  const shopAccessToken = env.SHOP_ACCESS_TOKEN;

  // ==========================================
  // PATH A: Buyer-Linked Token (Personalized)
  // REQUIRED for Storefront Cart/Checkout/ECP
  // ==========================================
  if (shopAccessToken) {
    const grantRes = await fetch("https://accounts.shop.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

    if (!grantRes.ok) throw new Error(`Failed to exchange Shop token: ${grantRes.status} ${grantRes.statusText}`);

    const grantData = await grantRes.json() as { access_token?: string };
    if (!grantData.access_token) throw new Error("No JWT authorization grant returned from Shop");

    const tokenRes = await fetch("https://api.shopify.com/auth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: grantData.access_token,
        scope: "dev.ucp.shopping.catalog.search:read dev.ucp.shopping.catalog.lookup:read dev.ucp.shopping.cart:manage dev.ucp.shopping.checkout:manage dev.ucp.shopping.order:read dev.ucp.shopping.order:manage",
        client_id: env.SHOPIFY_CLIENT_ID,
        client_secret: env.SHOPIFY_CLIENT_SECRET,
      }).toString(),
    });

    if (!tokenRes.ok) throw new Error(`Failed to redeem JWT grant: ${tokenRes.status} ${tokenRes.statusText}`);

    const tokenData = await tokenRes.json() as { access_token?: string };
    if (!tokenData.access_token) throw new Error("No buyer-linked access_token returned from Shopify");

    return tokenData.access_token;
  }

  // ==========================================
  // PATH B: App-Only Token (Anonymous Fallback)
  // ONLY works for Global Catalog
  // ==========================================
  const res = await fetch("https://api.shopify.com/auth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials"
    }),
  });

  if (!res.ok) throw new Error(`Failed to get Shopify access token: ${res.status} ${res.statusText}`);

  const json = await res.json() as { access_token?: string };
  if (!json.access_token) throw new Error("No access_token in Shopify auth response");

  return json.access_token;
}