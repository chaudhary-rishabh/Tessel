import type { ConnectorCatalogEntry } from "@tessel/contracts";
import type { StaticOAuthClient } from "@tessel/mcp";

/** A catalog entry with what the server needs to connect. */
export interface CatalogEntry extends ConnectorCatalogEntry {
  url: string;
  staticClient?: StaticOAuthClient;
}

export interface CatalogSettings {
  githubUrl: string;
  githubClient?: StaticOAuthClient | undefined;
}

/**
 * Apps Tessel can connect to out of the box. Each runs a remote MCP server;
 * users can also add any other server by URL.
 */
export function connectorCatalog({ githubUrl, githubClient }: CatalogSettings): CatalogEntry[] {
  return [
    {
      id: "github",
      name: "GitHub",
      description: "Search issues and pull requests, read code, and open issues.",
      url: githubUrl,
      ...(githubClient
        ? { auth: "oauth" as const, tokenHelp: null, staticClient: githubClient }
        : {
            auth: "token" as const,
            tokenHelp:
              "Create a fine-grained personal access token at github.com/settings/personal-access-tokens with access to the repositories you want, then paste it here.",
          }),
    },
    {
      id: "notion",
      name: "Notion",
      description: "Search and read pages and databases, and create pages.",
      url: "https://mcp.notion.com/mcp",
      auth: "oauth",
      tokenHelp: null,
    },
    {
      id: "linear",
      name: "Linear",
      description: "Find, create, and update issues and projects.",
      url: "https://mcp.linear.app/mcp",
      auth: "oauth",
      tokenHelp: null,
    },
  ];
}
