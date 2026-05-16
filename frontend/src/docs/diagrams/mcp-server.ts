export const mcpServer = {
    titleKey: 'docs.diagram.mcpServer.title',
    explanationPrefix: 'docs.diagram.mcpServer.',
    definition: `
graph LR
    subgraph "AI Client (Claude / Gemini)"
        AI[Agent] --> PROMPT[User Prompt]
        PROMPT --> TOOLS[Call BMM Tools]
    end

    subgraph "BMM Binary (v1.0.0)"
        TOOLS -- "JSON-RPC (stdio)" --> MCP_SRV[MCP Server Engine]
        
        subgraph "Internal State"
            MCP_SRV --> APP_STATE[Initialize AppState]
            APP_STATE --> DB[Read/Write JSON Data]
        end
        
        subgraph "Feature Access"
            DB --> MOD_SYNC[Apply Mods]
            DB --> PROFILE_MGR[Switch Profiles]
            DB --> LAUNCH_EXEC[Run Launch Packs]
        end
        
        FEATURE_RET[Result Data] --> MCP_SRV
    end
    
    MCP_SRV -- "Response" --> AI
    
    style MCP_SRV fill:#06b6d4,stroke:#fff,stroke-width:2px,color:#fff
    style DB fill:#6366f1,stroke:#fff,stroke-width:2px,color:#fff
    style AI fill:#f59e0b,stroke:#fff,stroke-width:2px,color:#fff
    `
};
