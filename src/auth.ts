import type { Env } from "./index";

export async function getAccessToken(env: Env): Promise<string> {
  const shopAccessToken = env.SHOP_ACCESS_TOKEN;

  // ==========================================
  // PATH A: Buyer-Linked Token (Personalized)
  // ==========================================
  if (shopAccessToken) {
    try {
      // Step 2: Exchange the Shop access token for a JWT authorization grant (RFC 8693)
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

      if (!grantRes.ok) {
        throw new Error(`Failed to exchange Shop token: ${grantRes.status} ${grantRes.statusText}`);
      }

      const grantData = await grantRes.json() as { access_token?: string };
      const jwtGrant = grantData.access_token;

      if (!jwtGrant) {
        throw new Error("No JWT authorization grant returned from Shop");
      }

      // Step 3: Redeem the JWT grant for a buyer-linked token at Shopify (RFC 7523)
      const tokenRes = await fetch("https://api.shopify.com/auth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwtGrant,
          // ADDED: dev.ucp.shopping.order:read and dev.ucp.shopping.order:manage
          scope: "dev.ucp.shopping.catalog.search:read dev.ucp.shopping.catalog.lookup:read dev.ucp.shopping.cart:manage dev.ucp.shopping.checkout:manage dev.ucp.shopping.order:read dev.ucp.shopping.order:manage",
          client_id: env.SHOPIFY_CLIENT_ID,
          client_secret: env.SHOPIFY_CLIENT_SECRET,
        }).toString(),
      });

      if (!tokenRes.ok) {
        throw new Error(`Failed to redeem JWT grant: ${tokenRes.status} ${tokenRes.statusText}`);
      }

      const tokenData = await tokenRes.json() as { access_token?: string };
      if (!tokenData.access_token) {
        throw new Error("No buyer-linked access_token returned from Shopify");
      }

      return tokenData.access_token; // Returns the personalized buyer-linked token
      
    } catch (error) {
      // If the buyer-linked flow fails, log it and safely fall back to app-only
      console.error("Buyer-linked token exchange failed, falling back to app-only token:", error);
    }
  }

  // ==========================================
  // PATH B: App-Only Token (Anonymous Fallback)
  // ==========================================
  const res = await fetch("https://api.shopify.com/auth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
      // ADDED: dev.ucp.shopping.order:read and dev.ucp.shopping.order:manage
      scope: "dev.ucp.shopping.catalog.search:read dev.ucp.shopping.catalog.lookup:read dev.ucp.shopping.cart:manage dev.ucp.shopping.checkout:manage dev.ucp.shopping.order:read dev.ucp.shopping.order:manage"
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to get Shopify access token: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { access_token?: string };
  if (!json.access_token) {
    throw new Error("No access_token in Shopify auth response");
  }

  return json.access_token;
}