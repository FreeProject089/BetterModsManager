export const launchPacks = {
    titleKey: 'docs.diagram.launchPacks.title',
    explanationPrefix: 'docs.diagram.launchPacks.',
    definition: `
graph TD
    START((Launch Trigger)) --> USER_SELECT[User selects Pack]
    USER_SELECT --> BACKEND_CALL{Tauri Invoke}
    
    subgraph "Rust Backend (Launch Engine)"
        BACKEND_CALL --> FETCH_PACK[Fetch Pack JSON]
        FETCH_PACK --> ITER_APPS[Iterate Executables]
        
        subgraph "Per Executable"
            ITER_APPS --> CHECK_PATH{File Exists?}
            CHECK_PATH -- No --> LOG_ERR[Log Error]
            CHECK_PATH -- Yes --> SHELL_EXEC[Shell Command]
            
            SHELL_EXEC --> VBS_BRIDGE[VBScript Bridge]
            VBS_BRIDGE --> SILENT_LAUNCH["Silent Launch (No Console Window)"]
        end
    end
    
    SILENT_LAUNCH --> NOTIFY_UI[Success Notification]
    LOG_ERR --> NOTIFY_ERR[Error Notification]
    
    style START fill:#f97316,stroke:#fff,stroke-width:2px,color:#fff
    style SILENT_LAUNCH fill:#22c55e,stroke:#fff,stroke-width:2px,color:#fff
    style VBS_BRIDGE fill:#6366f1,stroke:#fff,stroke-width:2px,color:#fff
    `
};
