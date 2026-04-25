export const securitySystem = {
    titleKey: 'docs.security',
    explanationPrefix: 'docs.diagram.security.node.',
    definition: `
    flowchart TD
        subgraph CL_USER ["{{docs.diagram.cluster.USER}}"]
            START[<i class='icon-toggle'></i><br>{{docs.diagram.security.node.START}}]
        end

        subgraph CL_CORE ["{{docs.diagram.cluster.CORE}}"]
            MODE_FULL[<i class='icon-unlock'></i><br>{{docs.diagram.security.node.MODE_FULL}}]
            MODE_LIM[<i class='icon-lock'></i><br>{{docs.diagram.security.node.MODE_LIM}}]
            RUST{{<i class='icon-cpu'></i><br>{{docs.diagram.security.node.RUST}}}}
        end

        subgraph CL_UI ["{{docs.diagram.cluster.UI}}"]
            JS[[<i class='icon-layers'></i><br>{{docs.diagram.security.node.JS}}]]
            SCOPE{<i class='icon-shield'></i><br>{{docs.diagram.security.node.SCOPE}}}
        end

        subgraph CL_STORAGE ["{{docs.diagram.cluster.STORAGE}}"]
            DISK[(<i class='icon-folder'></i><br>{{docs.diagram.security.node.DISK}})]
        end

        START -->|Choix| MODE_FULL
        START -->|Choix| MODE_LIM

        MODE_FULL -->|Accès Total| JS
        MODE_LIM -->|Restriction| SCOPE
        
        JS -- "<span class='label-info'>{{docs.diagram.edge.security.JS_SCOPE}}</span>" --> SCOPE
        SCOPE -- "<span class='label-success'>{{docs.diagram.edge.security.SCOPE_DISK}}</span>" --> DISK
        
        RUST -- "<span class='label-purple'>{{docs.diagram.edge.security.RUST_DISK}}</span>" --> DISK
        MODE_FULL -.->|Config| RUST
        MODE_LIM -.->|Config| RUST
        
        RUST -.->|Update Whitelist| SCOPE

        classDef default fill:#1e293b,stroke:#475569,color:#f1f5f9
        classDef highlight fill:#3b82f6,stroke:#3b82f6,color:#fff
        classDef rust fill:#f96,stroke:#333,color:#000
        classDef shield fill:#5af,stroke:#333,color:#fff
        
        class RUST rust
        class SCOPE shield
    `
};
