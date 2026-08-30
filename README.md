# Shopify Global Shopping Agent - MCP Server

## Overview

This is a production-ready **Platform Agent** and **Business Agent** implementation built on Cloudflare Workers. It implements the Model Context Protocol (MCP) specification (2026-07-28) to provide AI agents with tools for product discovery, cart management, and checkout operations on the Shopify Global Catalog.

## Agent Profile

The agent exposes its profile at `/.well-known/agent-profile.json`, which includes:

- **Name**: Shopify Global Shopping Agent
- **Description**: An AI shopping agent that helps customers discover, compare, and purchase products from the Shopify Global Catalog.
- **Capabilities**: Product Discovery, Cart Management, Checkout, Order Tracking
- **MCP Integration**: Full MCP protocol support at `/mcp` endpoint

## Available Tools

### Catalog & Product Tools

1. **search_products** - Search the global Shopify catalog using natural language queries, filters, price ranges, visual similarity, and more.
2. **lookup_catalog** - Resolve Shopify product URLs and IDs to get product identifiers.
3. **get_product** - Get detailed product information including variants, options, pricing, and availability.

### Cart Management Tools

4. **create_cart** - Create a shopping cart with specified line items.
5. **get_cart** - Retrieve an existing shopping cart.
6. **update_cart** - Update or replace cart contents.
7. **cancel_cart** - Cancel/abandon a shopping cart.

### Checkout Tools

8. **create_checkout** - Initialize a checkout session from a cart or direct line items.
9. **update_checkout** - Update checkout details like shipping address or line items.
10. **complete_checkout** - Finalize a checkout and place the order.
11. **cancel_checkout** - Cancel an active checkout session.

## Deployment

### Environment Variables

Set these in your Cloudflare Workers dashboard or wrangler.toml:

| Variable | Description | Required |
|----------|-------------|----------|
| `SHOPIFY_CATALOG_ID` | Your Shopify Global Catalog ID | Yes |
| `AGENT_PROFILE_URL` | URL to your agent profile (auto-configured) | Yes |
| `SHOPIFY_CLIENT_ID` | Shopify OAuth Client ID | Yes (Secret) |
| `SHOPIFY_CLIENT_SECRET` | Shopify OAuth Client Secret | Yes (Secret) |

### Deploy to Cloudflare Workers

```bash
npm install
npm run deploy
```

### Local Development

```bash
npm run dev
```

## Connecting MCP Clients

### Cloudflare AI Playground

1. Go to https://playground.ai.cloudflare.com/
2. Enter your deployed MCP server URL: `https://shopify-global-search.facetimefy.com/mcp`
3. Start using your shopping agent!

### Claude Desktop

Add this configuration to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "shopify-shopping-agent": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://shopify-global-search.facetimefy.com/mcp"
      ]
    }
  }
}
```

## Agent-to-Agent Communication

This server is designed for **Platform Agent** and **Business Agent** scenarios:

- **Agent Profile Endpoint**: `/.well-known/agent-profile.json` - Discoverable by other agents
- **MCP Protocol Version**: 2026-07-28 compliant
- **UCP (Universal Commerce Protocol)**: Integrated for cross-platform commerce operations

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                        │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Agent Profile Handler                     │  │
│  │         /.well-known/agent-profile.json               │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                MCP Handler (/mcp)                      │  │
│  │                                                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │   Catalog   │  │     Cart    │  │  Checkout   │   │  │
│  │  │    Tools    │  │    Tools    │  │    Tools    │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 Auth Handler                          │  │
│  │         (Bearer Token / Anonymous)                    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
            ┌─────────────────────────────────┐
            │      Shopify Global Catalog     │
            │      & UCP Commerce APIs        │
            └─────────────────────────────────┘
```

## Features

✅ **100% Agent Ready** - Fully compliant with MCP 2026-07-28 specification  
✅ **Platform Agent Support** - Exposes standardized agent profile for discovery  
✅ **Business Agent Capabilities** - Full e-commerce workflow support  
✅ **Visual Search** - Image-based product similarity search  
✅ **Pagination Support** - Cursor-based pagination for large result sets  
✅ **Promoted Placement Disclosure** - FTC-compliant commission disclosure  
✅ **Multi-Merchant Support** - Works across Shopify merchants globally  
✅ **Embedded Checkout Protocol** - Secure delegated checkout flow  
✅ **Idempotency Keys** - Safe retry handling for critical operations  

## License

MIT
