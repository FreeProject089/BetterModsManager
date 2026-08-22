// The server-setup snippets and their copy button, lifted verbatim out of index.html
// so that script-src can drop 'unsafe-inline'.
//
// NOTE: window.bmmCopy is called from NOWHERE -- not in index.html, not in
// frontend/src, not in the build output. It is dead code, kept as-is because
// deleting it is a separate decision from the CSP work.

(function () {
    var _blocks = {
        'start-bat': '@echo off\r\ntitle BMM Server (Node.js)\r\necho Installing dependencies...\r\ncall npm install\r\nif %errorlevel% neq 0 (\r\n    echo [ERROR] Failed to install dependencies. Make sure Node.js and NPM are installed.\r\n    pause\r\n    exit /b\r\n)\r\necho Starting server...\r\ncall npm start\r\npause',
        'start-sh': '#!/bin/bash\necho "Installing dependencies..."\nnpm install\nif [ $? -ne 0 ]; then\n    echo "[ERROR] Failed to install dependencies. Make sure Node.js and NPM are installed."\n    exit 1\nfi\necho "Starting server..."\nnpm start',
        'repo-json': '{\n  "port": 8080,\n  "upload_limit_kb": 0,\n  "password_hash": "$argon2id$v=19$...",\n  "whitelist": [],\n  "banned": [],\n  "creator_id": "<hardware-derived, auto-generated>",\n  "mods": [\n    {\n      "name": "ExampleMod",\n      "version": "1.0.0",\n      "file": "mods/ExampleMod-1.0.0.zip",\n      "sha256": "abc123def456...",\n      "size": 1048576,\n      "required": true\n    }\n  ]\n}',
        'docker-compose': 'services:\n  bmm-server:\n    image: ghcr.io/freeproject089/bettermods-server:latest\n    ports:\n      - "8080:8080"\n    volumes:\n      - ./data:/app/data\n    environment:\n      - BMM_PORT=8080\n      - BMM_SEED=your_secret_seed\n    restart: unless-stopped',
        'docker-up': 'docker compose up -d',
        'ngrok': 'ngrok http 8080',
        'cloudflare': 'cloudflared tunnel run --token YOUR_CLOUDFLARE_TOKEN',
        'docker-update': 'docker compose pull\ndocker compose up -d\ndocker image prune -f'
    };
    var _svgCopy = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';

    window.bmmCopy = function (btn, key) {
        var text = _blocks[key] !== undefined ? _blocks[key] : key;
        function ok() {
            btn.textContent = '✓ Copied';
            setTimeout(function () { btn.innerHTML = _svgCopy; }, 2000);
        }
        if (window.__TAURI__ && window.__TAURI__.clipboard) {
            window.__TAURI__.clipboard.writeText(text).then(ok).catch(function () {
                navigator.clipboard && navigator.clipboard.writeText(text).then(ok);
            });
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(ok).catch(function () {
                _fallback(text, ok);
            });
        } else {
            _fallback(text, ok);
        }
    };

    function _fallback(text, ok) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        try { document.execCommand('copy'); ok(); } catch (e) { }
        document.body.removeChild(ta);
    }
})();
