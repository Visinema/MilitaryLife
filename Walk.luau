--==================================================
-- NPC WALK SYSTEM (ULTRA LIGHT + ERROR HANDLING 2025)
-- Custom Body | No Humanoid | 200+ NPC Safe
--==================================================
-- PUBLIC API:
-- NPCWalk.Walk(npc, speed)
-- NPCWalk.WalkTarget(npc, targetPart, speed)
-- NPCWalk.Stop(npc)
--==================================================

local RunService = game:GetService("RunService")

local NPCWalk = {}

--========================
-- CONFIGURATION (OPTIMAL FOR PERFORMANCE)
--========================
local UPDATE_RATE = 0.05       -- 20 FPS (sweet spot NPC)
local DEFAULT_SPEED = 10
local STOP_DISTANCE = 1.2

--========================
-- INTERNAL STATE
--========================
local NPCS = {}        -- [Model] = Data
local timeBuffer = 0

--========================
-- INTERNAL: UTILS
--========================

-- Safely retrieve the PrimaryPart or log errors
local function getPrimaryPart(model: Model)
    if not model:IsA("Model") then
        warn(("[NPCWalk] %s is not a valid Model!"):format(tostring(model)))
        return nil
    end
    local root = model.PrimaryPart
    if not root then
        warn(("[NPCWalk] %s has no PrimaryPart! Ensure it is set in the Model properties."):format(model:GetFullName()))
    end
    return root
end

-- Log debug messages only if debugging is enabled
local DEBUG_ENABLED = true
local function logDebug(message)
    if DEBUG_ENABLED then
        print("[NPCWalk Debug]: " .. message)
    end
end

--========================
-- INTERNAL: INITIALIZE NPC
--========================
local function initNPC(model)
    if NPCS[model] then
        logDebug(("NPC %s already initialized."):format(model:GetFullName()))
        return NPCS[model]
    end

    local root = getPrimaryPart(model)
    if not root then return nil end

    -- Movement setup
    local alignPos = Instance.new("AlignPosition")
    alignPos.MaxForce = 1e5
    alignPos.Responsiveness = 35
    alignPos.RigidityEnabled = true
    alignPos.Attachment0 = Instance.new("Attachment", root)
    alignPos.Parent = root

    local alignOri = Instance.new("AlignOrientation")
    alignOri.MaxTorque = 1e5
    alignOri.Responsiveness = 35
    alignOri.RigidityEnabled = true
    alignOri.Attachment0 = Instance.new("Attachment", root)
    alignOri.Parent = root

    local data = {
        Root = root,
        AlignPos = alignPos,
        AlignOri = alignOri,
        TargetPart = nil,
        Speed = DEFAULT_SPEED,
        Active = false
    }

    NPCS[model] = data
    logDebug(("NPC %s initialized successfully."):format(model:GetFullName()))
    return data
end

--========================
-- PUBLIC FUNCTION: WALK FORWARD
--========================
function NPCWalk.Walk(model, speed)
    local npc = initNPC(model)
    if not npc then
        warn("[NPCWalk.Walk] Failed to initialize NPC.")
        return
    end
    npc.TargetPart = nil
    npc.Speed = speed or DEFAULT_SPEED
    npc.Active = true
    logDebug(("NPC %s is walking forward at speed %d."):format(model:GetFullName(), npc.Speed))
end

--========================
-- PUBLIC FUNCTION: WALK TO TARGET PART
--========================
function NPCWalk.WalkTarget(model, targetPart, speed)
    if not targetPart or not targetPart:IsA("BasePart") then
        warn("[NPCWalk.WalkTarget] Target is not a valid BasePart.")
        return
    end

    local npc = initNPC(model)
    if not npc then
        warn("[NPCWalk.WalkTarget] Failed to initialize NPC.")
        return
    end

    npc.TargetPart = targetPart
    npc.Speed = speed or DEFAULT_SPEED
    npc.Active = true
    logDebug(("NPC %s is walking towards %s at speed %d."):format(model:GetFullName(), targetPart:GetFullName(), npc.Speed))
end

--========================
-- PUBLIC FUNCTION: STOP
--========================
function NPCWalk.Stop(model)
    local npc = NPCS[model]
    if not npc then
        warn("[NPCWalk.Stop] NPC not found.")
        return
    end

    npc.Active = false
    npc.TargetPart = nil
    logDebug(("NPC %s has stopped."):format(model:GetFullName()))
end

--========================
-- CORE UPDATE LOOP
--========================
RunService.Heartbeat:Connect(function(deltaTime)
    timeBuffer += deltaTime
    if timeBuffer < UPDATE_RATE then return end
    timeBuffer = 0

    for model, npc in pairs(NPCS) do
        if not npc.Active then
            continue
        end

        local root = npc.Root
        if not root or not root.Parent then
            NPCS[model] = nil
            logDebug(("Removed invalid NPC %s (missing root or parent)."):format(model:GetFullName()))
            continue
        end

        local targetPos
        if npc.TargetPart then
            targetPos = npc.TargetPart.Position
        else
            targetPos = root.Position + root.CFrame.LookVector * (npc.Speed * UPDATE_RATE)
        end

        local delta = targetPos - root.Position
        local dist = delta.Magnitude

        if dist <= STOP_DISTANCE then
            npc.Active = false
            logDebug(("NPC %s reached its target."):format(model:GetFullName()))
            continue
        end

        local dir = Vector3.new(delta.X, 0, delta.Z).Unit
        local step = dir * npc.Speed * UPDATE_RATE

        -- MOVE
        npc.AlignPos.Position = root.Position + step

        -- ROTATE
        npc.AlignOri.CFrame = CFrame.new(root.Position, root.Position + dir)
    end
end)

return NPCWalk
