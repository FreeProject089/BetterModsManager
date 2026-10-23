-- BMM join gate, SERVER side. For server admins: players never install this file.
--
-- Where it goes: the Saved Games folder of your DEDICATED SERVER, in Scripts\Hooks\
-- (for example Saved Games\DCS.server\Scripts\Hooks\BMM-JoinGate-Server.lua). Restart the
-- server after copying it.
--
-- What it does: players who run BMM's « DCS server join gate » automation send one chat line
-- starting with [BMMGATE] when their mission starts. This script reads that line, hides it
-- from everybody else, and checks it against YOUR settings below: the result says the
-- player's mod list was active, in place and intact, its fingerprint is one you accept, and
-- it is recent. A player who sends no passing line within `grace` seconds is, with `enforce`
-- on, kicked with your message. With `enforce` off (the default) the script only writes what
-- it WOULD do to dcs.log, so you can watch it for a session before switching it on.
--
-- What it is not: anti-cheat. The line is written by the player's own PC, and a determined
-- player can forge it. It exists so that honest players arrive with the right mods and get a
-- clear message when they do not. DCS's own integrity check stays your tool for the rest.
-- The kick is YOUR server's decision, made by this file you chose to install; BMM itself never
-- kicks anybody and never touches the server.
--
-- The fingerprint: open BMM, Plugins & API › Automations, « DCS server join gate », pick your
-- server's mod list (.mm): the form shows its fingerprint (16 letters and digits). The same
-- list gives the same fingerprint on every machine; a different version of one mod does not.

local CONFIG = {
    -- One or more accepted fingerprints (keep the previous one while players update).
    fingerprints = { "0000000000000000" },
    -- Seconds after connecting before a player without a passing result is acted on. Loading a
    -- big mission takes time: keep it generous.
    grace = 240,
    -- false: only log what would happen. true: kick.
    enforce = false,
    -- How old a result may be, in seconds (the player runs the gate before joining).
    max_age = 6 * 3600,
    -- What a kicked player reads.
    message = "This server checks your mods with Better Mods Manager. Run the DCS server join gate automation, fix what it reports, then join again.",
    -- UCIDs never acted on (admins, testers).
    exempt = {},
}

local gate = {}
local pending = {}   -- player id -> real time of connection
local passed = {}    -- player id -> true
local last_sweep = 0

local function try(f, ...)
    if type(f) ~= "function" then return nil end
    local ok, v = pcall(f, ...)
    if ok then return v end
    return nil
end

local function log(text)
    try(net.log, "[BMMGATE] " .. text)
end

local function who(id)
    local name = try(net.get_player_info, id, "name") or "?"
    local ucid = try(net.get_player_info, id, "ucid") or "?"
    return string.format("%s (%s)", tostring(name), tostring(ucid))
end

local function is_exempt(id)
    local ucid = try(net.get_player_info, id, "ucid")
    for _, u in ipairs(CONFIG.exempt) do
        if u == ucid then return true end
    end
    return false
end

local function accepted(fp)
    for _, f in ipairs(CONFIG.fingerprints) do
        if f == fp then return true end
    end
    return false
end

function gate.onPlayerConnect(id)
    if id == try(net.get_my_player_id) then return end
    pending[id] = try(DCS.getRealTime) or 0
    passed[id] = nil
end

function gate.onPlayerDisconnect(id)
    pending[id] = nil
    passed[id] = nil
end

function gate.onPlayerTrySendChat(id, msg, all)
    if type(msg) ~= "string" or msg:sub(1, 9) ~= "[BMMGATE]" then
        return msg
    end
    local ok = msg:match("ok=(%d)")
    local fp = msg:match("fp=(%w+)") or ""
    local at = tonumber(msg:match("at=(%d+)")) or 0
    local fresh = math.abs(os.time() - at) <= CONFIG.max_age
    if ok == "1" and accepted(fp) and fresh then
        if not passed[id] then log("passed: " .. who(id)) end
        passed[id] = true
        pending[id] = nil
    else
        log(string.format("not passing: %s ok=%s fp=%s fresh=%s", who(id), tostring(ok), fp, tostring(fresh)))
    end
    -- The line never reaches the other players.
    return ""
end

function gate.onSimulationFrame()
    local now = try(DCS.getRealTime) or 0
    if now - last_sweep < 5 then return end
    last_sweep = now
    for id, t0 in pairs(pending) do
        if not passed[id] and now - t0 > CONFIG.grace then
            pending[id] = nil
            if is_exempt(id) then
                log("exempt, not checked: " .. who(id))
            elseif CONFIG.enforce then
                log("kicking: " .. who(id))
                try(net.kick, id, CONFIG.message)
            else
                log("would kick (enforce is off): " .. who(id))
            end
        end
    end
end

DCS.setUserCallbacks(gate)
log("BMM join gate loaded (enforce = " .. tostring(CONFIG.enforce) .. ")")
