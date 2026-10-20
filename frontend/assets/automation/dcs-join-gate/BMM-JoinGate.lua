-- BMM join gate, CLIENT side. Written by Better Mods Manager; safe to delete.
--
-- Where it lives: Saved Games\DCS\Scripts\Hooks\ (and DCS.openbeta), put there by the
-- « DCS server join gate » automation, only after you said yes in BMM.
--
-- What it does: when this DCS client starts a MULTIPLAYER mission, it reads the result the
-- join gate wrote just before (Saved Games\DCS\Config\bmm-joingate.json: was your mod list
-- active, in place and intact, and its fingerprint) and sends it to the server as ONE chat
-- line starting with [BMMGATE]. A server running BMM-JoinGate-Server.lua reads that line,
-- hides it from the other players, and applies ITS OWN rule. Without that server script the
-- line is an ordinary chat message and nothing else happens.
--
-- What it does not do: it reads no other file, changes no game state, writes nothing, and
-- talks to nobody but the server you joined. It never runs in single player.
--
-- Every DCS call is inside pcall: a hook that raises is dropped by DCS for the whole session.
local gate = {}

local REPORT = lfs.writedir() .. "Config/bmm-joingate.json"
local RESEND_AFTER = 15   -- seconds between the first line and each repeat
local sent_at = nil
local repeats = 0

local function try(f, ...)
    if type(f) ~= "function" then return nil end
    local ok, v = pcall(f, ...)
    if ok then return v end
    return nil
end

local function read_report()
    local fh = io.open(REPORT, "r")
    if not fh then return nil end
    local text = fh:read("*a")
    fh:close()
    return try(net.json2lua, text)
end

-- One line, letters, digits and a few separators only: nothing in it can be read as a command.
local function token()
    local r = read_report()
    if type(r) ~= "table" then
        return "BMMGATE1 ok=0 fp=none at=0 why=noreport"
    end
    local ok = (r.ok == true) and 1 or 0
    local fp = tostring(r.fingerprint or "none"):gsub("[^%w]", "")
    local at = math.floor(tonumber(r.at) or 0)
    local server = tostring(r.server or ""):gsub("[^%w%.:%-]", "")
    return string.format("BMMGATE1 ok=%d fp=%s at=%d server=%s", ok, fp, at, server)
end

local function send()
    if try(DCS.isMultiplayer) ~= true then return end
    if try(DCS.isServer) == true then return end
    try(net.send_chat, "[BMMGATE] " .. token(), false)
    sent_at = try(DCS.getRealTime) or 0
end

function gate.onSimulationStart()
    repeats = 2
    send()
end

-- Said again twice, in case the server's script was still busy with the slot change.
function gate.onSimulationFrame()
    if repeats <= 0 or sent_at == nil then return end
    local now = try(DCS.getRealTime) or 0
    if now - sent_at >= RESEND_AFTER then
        repeats = repeats - 1
        send()
    end
end

function gate.onSimulationStop()
    repeats = 0
    sent_at = nil
end

DCS.setUserCallbacks(gate)
