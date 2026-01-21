--[[ 
    CYBER-DELTA | COMET INTERFACE V4 (NO RADAR EDITION)
    Optimized for: Delta, Fluxus, Hydrogen, Arceus X
]]

-- // SERVICES
local Services = {
    Players = game:GetService("Players"),
    RunService = game:GetService("RunService"),
    TweenService = game:GetService("TweenService"),
    ReplicatedStorage = game:GetService("ReplicatedStorage"),
    Workspace = game:GetService("Workspace"),
    HttpService = game:GetService("HttpService"),
    CoreGui = game:GetService("CoreGui"),
    UserInputService = game:GetService("UserInputService")
}

-- // EXECUTOR CHECK
local Request = (syn and syn.request) or (http and http.request) or http_request or (fluxus and fluxus.request) or request
local QueueOnTeleport = (syn and syn.queue_on_teleport) or queue_on_teleport or (fluxus and fluxus.queue_on_teleport)

-- // LOCAL CACHE
local LP = Services.Players.LocalPlayer
local Camera = Services.Workspace.CurrentCamera
local Vec3 = Vector3.new
local Vec2 = Vector2.new
local CFrameNew = CFrame.new

-- // CONFIGURATION
local CONFIG = {
    REMOTE_PATH = {"rbxts_include", "node_modules", "@rbxts", "remo", "src", "container", "comets.attack"},
    PRIORITIES = {
        "Neon Comet", "Emerald Comet", "Diamond Comet", "Golden Comet", 
        "Iron Comet", "Obsidian Comet", "Lava Comet", "Ice Comet"
    },
    WEBHOOK = {
        Url = "https://discord.com/api/webhooks/1463156950593437716/IKQHeycMF6oIpBPlMkRxkmffAHt7FFiKCd6-iGA2ClCU5cLA_FOTBbu9f7XMmOaV6Ocn", -- [[ PASTE YOUR WEBHOOK URL HERE ]]
        Enabled = true,
        MinTierToNotify = "Ice Comet", -- Logs everything this tier and rarer
        Colors = {
            Search = 3447003, -- Blue
            Lock = 16747520,  -- Orange
            Done = 5763719    -- Green
        }
    },
    THEME = {
        Background = Color3.fromRGB(15, 17, 26),
        Primary = Color3.fromRGB(65, 165, 255), -- Cyber Blue
        Accent = Color3.fromRGB(255, 170, 40),  -- Orange
        Text = Color3.fromRGB(240, 240, 255),
        Success = Color3.fromRGB(80, 255, 120),
        Danger = Color3.fromRGB(255, 60, 60)
    }
}

-- // STATE MANAGEMENT
local State = {
    Enabled = false,
    MenuOpen = true,
    CurrentTab = "Main",
    Filters = {},
    Target = nil,
    LastTarget = nil, -- Used to detect state changes for webhook
    Dragging = nil,
    DragInput = nil,
    DragStart = nil,
    StartPos = nil
}

-- Initialize Filters
for _, name in ipairs(CONFIG.PRIORITIES) do
    State.Filters[name] = true
end

-- // UTILITY LIBRARY
local Library = {}

function Library:Create(class, props)
    local obj = Instance.new(class)
    for k, v in pairs(props) do obj[k] = v end
    return obj
end

function Library:AddStroke(parent, color, thickness)
    local stroke = Instance.new("UIStroke")
    stroke.Color = color
    stroke.Thickness = thickness or 1.5
    stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    stroke.Parent = parent
    return stroke
end

function Library:MakeDraggable(frame)
    frame.InputBegan:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            State.Dragging = frame
            State.DragStart = input.Position
            State.StartPos = frame.Position
            
            input.Changed:Connect(function()
                if input.UserInputState == Enum.UserInputState.End then
                    State.Dragging = nil
                end
            end)
        end
    end)

    frame.InputChanged:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch then
            State.DragInput = input
        end
    end)

    Services.UserInputService.InputChanged:Connect(function(input)
        if input == State.DragInput and State.Dragging then
            local delta = input.Position - State.DragStart
            State.Dragging.Position = UDim2.new(
                State.StartPos.X.Scale,
                State.StartPos.X.Offset + delta.X,
                State.StartPos.Y.Scale,
                State.StartPos.Y.Offset + delta.Y
            )
        end
    end)
end

-- Modified Webhook Function
function Library:SendWebhook(title, desc, color)
    if not CONFIG.WEBHOOK.Enabled or CONFIG.WEBHOOK.Url == "" then return end
    if not Request then return end
    
    local data = {
        username = "Cyber-Delta Scanner",
        avatar_url = "https://i.imgur.com/8t3685F.png",
        embeds = {{
            title = title,
            description = desc .. "\n>>> **User:** ||" .. LP.Name .. "||",
            color = color,
            fields = {
                {name = "Time", value = os.date("%X"), inline = true},
                {name = "Status", value = "Active", inline = true}
            },
            footer = { text = "Cyber-Delta V4 Mobile" }
        }}
    }
    
    -- Spawn in new thread to prevent yielding the game loop
    task.spawn(function()
        local success, err = pcall(function()
            Request({
                Url = CONFIG.WEBHOOK.Url,
                Method = "POST",
                Headers = {["Content-Type"] = "application/json"},
                Body = Services.HttpService:JSONEncode(data)
            })
        end)
    end)
end

-- // UI SYSTEM
local UI = {}
UI.Tabs = {}

function UI:Init()
    if Services.CoreGui:FindFirstChild("CyberDeltaV4") then
        Services.CoreGui.CyberDeltaV4:Destroy()
    end

    local Screen = Library:Create("ScreenGui", {
        Name = "CyberDeltaV4",
        Parent = Services.CoreGui,
        ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
        ResetOnSpawn = false
    })

    -- TOGGLE BUTTON (Mobile Friendly)
    local ToggleBtn = Library:Create("TextButton", {
        Parent = Screen,
        Name = "Toggle",
        Size = UDim2.new(0, 50, 0, 50),
        Position = UDim2.new(0.02, 0, 0.25, 0),
        BackgroundColor3 = CONFIG.THEME.Background,
        Text = "",
        AutoButtonColor = false,
        Active = true
    })
    Library:Create("UICorner", {Parent = ToggleBtn, CornerRadius = UDim.new(0, 12)})
    Library:AddStroke(ToggleBtn, CONFIG.THEME.Primary, 2)
    Library:MakeDraggable(ToggleBtn)
    
    Library:Create("ImageLabel", {
        Parent = ToggleBtn,
        Size = UDim2.new(0.6, 0, 0.6, 0),
        Position = UDim2.new(0.2, 0, 0.2, 0),
        BackgroundTransparency = 1,
        Image = "rbxassetid://6031763426", -- Comet Icon
        ImageColor3 = CONFIG.THEME.Primary
    })

    -- MAIN FRAME
    local MainFrame = Library:Create("Frame", {
        Parent = Screen,
        Name = "Main",
        Size = UDim2.new(0, 320, 0, 240),
        Position = UDim2.new(0.5, -160, 0.5, -120),
        BackgroundColor3 = CONFIG.THEME.Background,
        ClipsDescendants = true,
        Visible = false,
        Active = true
    })
    Library:Create("UICorner", {Parent = MainFrame, CornerRadius = UDim.new(0, 10)})
    Library:AddStroke(MainFrame, CONFIG.THEME.Primary, 2)
    Library:MakeDraggable(MainFrame)

    -- HEADER
    local Header = Library:Create("Frame", {
        Parent = MainFrame,
        Size = UDim2.new(1, 0, 0, 35),
        BackgroundColor3 = Color3.fromRGB(20, 22, 30),
        BorderSizePixel = 0
    })
    Library:Create("TextLabel", {
        Parent = Header,
        Size = UDim2.new(1, -10, 1, 0),
        Position = UDim2.new(0, 10, 0, 0),
        BackgroundTransparency = 1,
        Text = "CYBER DELTA // V4",
        TextColor3 = CONFIG.THEME.Primary,
        Font = Enum.Font.GothamBlack,
        TextSize = 14,
        TextXAlignment = Enum.TextXAlignment.Left
    })

    -- TABS
    local function CreateTabBtn(text, order)
        local btn = Library:Create("TextButton", {
            Parent = Header,
            Size = UDim2.new(0, 70, 1, 0),
            Position = UDim2.new(1, (-70 * (4-order)) - 5, 0, 0),
            BackgroundTransparency = 1,
            Text = text,
            TextColor3 = CONFIG.THEME.Text,
            Font = Enum.Font.GothamBold,
            TextSize = 11
        })
        return btn
    end

    local TabBtns = {
        Main = CreateTabBtn("HOME", 3),
        Config = CreateTabBtn("FILTER", 2),
        Empty = CreateTabBtn("EMPTY", 1)
    }

    local Pages = {
        Main = Library:Create("Frame", {Parent = MainFrame, Size = UDim2.new(1,0,1,-35), Position = UDim2.new(0,0,0,35), BackgroundTransparency=1, Visible=true}),
        Config = Library:Create("ScrollingFrame", {Parent = MainFrame, Size = UDim2.new(1,0,1,-35), Position = UDim2.new(0,0,0,35), BackgroundTransparency=1, Visible=false, ScrollBarThickness=2, CanvasSize = UDim2.new(0,0,2,0)}),
        Empty = Library:Create("Frame", {Parent = MainFrame, Size = UDim2.new(1,0,1,-35), Position = UDim2.new(0,0,0,35), BackgroundTransparency=1, Visible=false})
    }

    -- PAGE: MAIN
    local StatusText = Library:Create("TextLabel", {
        Parent = Pages.Main,
        Size = UDim2.new(1, 0, 0.3, 0),
        Position = UDim2.new(0, 0, 0.1, 0),
        BackgroundTransparency = 1,
        Text = "SYSTEM IDLE",
        TextColor3 = CONFIG.THEME.Text,
        Font = Enum.Font.SciFi,
        TextSize = 22
    })

    local StartBtn = Library:Create("TextButton", {
        Parent = Pages.Main,
        Size = UDim2.new(0.8, 0, 0.25, 0),
        Position = UDim2.new(0.1, 0, 0.55, 0),
        BackgroundColor3 = CONFIG.THEME.Primary,
        Text = "START SCANNING",
        Font = Enum.Font.GothamBlack,
        TextSize = 14,
        TextColor3 = Color3.new(0,0,0)
    })
    Library:Create("UICorner", {Parent = StartBtn, CornerRadius = UDim.new(0, 6)})

    -- PAGE: CONFIG
    Library:Create("UIListLayout", {Parent = Pages.Config, Padding = UDim.new(0, 5), HorizontalAlignment = Enum.HorizontalAlignment.Center, SortOrder = Enum.SortOrder.LayoutOrder})
    Library:Create("UIPadding", {Parent = Pages.Config, PaddingTop = UDim.new(0, 5)})

    for i, cometName in ipairs(CONFIG.PRIORITIES) do
        local filterFrame = Library:Create("Frame", {Parent = Pages.Config, Size = UDim2.new(0.9, 0, 0, 30), BackgroundColor3 = Color3.fromRGB(25, 28, 40), LayoutOrder = i})
        Library:Create("UICorner", {Parent = filterFrame, CornerRadius = UDim.new(0, 4)})
        
        Library:Create("TextLabel", {
            Parent = filterFrame,
            Size = UDim2.new(0.7, 0, 1, 0),
            Position = UDim2.new(0.05, 0, 0, 0),
            BackgroundTransparency = 1,
            Text = cometName,
            TextColor3 = CONFIG.THEME.Text,
            TextXAlignment = Enum.TextXAlignment.Left,
            Font = Enum.Font.GothamMedium,
            TextSize = 12
        })

        local toggle = Library:Create("TextButton", {
            Parent = filterFrame,
            Size = UDim2.new(0, 20, 0, 20),
            Position = UDim2.new(0.85, 0, 0.5, -10),
            BackgroundColor3 = CONFIG.THEME.Success,
            Text = ""
        })
        Library:Create("UICorner", {Parent = toggle, CornerRadius = UDim.new(0, 4)})

        toggle.MouseButton1Click:Connect(function()
            State.Filters[cometName] = not State.Filters[cometName]
            toggle.BackgroundColor3 = State.Filters[cometName] and CONFIG.THEME.Success or CONFIG.THEME.Danger
        end)
    end

    -- PAGE: EMPTY
    Library:Create("TextLabel", {
        Parent = Pages.Empty,
        Size = UDim2.new(1, 0, 1, 0),
        BackgroundTransparency = 1,
        Text = "NO MODULE LOADED",
        TextColor3 = Color3.fromRGB(80, 80, 80),
        Font = Enum.Font.GothamBold,
        TextSize = 16
    })

    -- Events
    ToggleBtn.MouseButton1Click:Connect(function()
        State.MenuOpen = not State.MenuOpen
        MainFrame.Visible = State.MenuOpen
    end)

    for name, btn in pairs(TabBtns) do
        btn.MouseButton1Click:Connect(function()
            for k, p in pairs(Pages) do p.Visible = false end
            Pages[name].Visible = true
            for _, b in pairs(TabBtns) do b.TextColor3 = Color3.fromRGB(150,150,150) end
            btn.TextColor3 = CONFIG.THEME.Primary
        end)
    end

    StartBtn.MouseButton1Click:Connect(function()
        State.Enabled = not State.Enabled
        StartBtn.Text = State.Enabled and "STOP SCANNING" or "START SCANNING"
        StartBtn.BackgroundColor3 = State.Enabled and CONFIG.THEME.Danger or CONFIG.THEME.Primary
        
        -- Initial Start Log
        if State.Enabled then
             Library:SendWebhook("System Activated", "Started scanning for comets...", CONFIG.WEBHOOK.Colors.Search)
        end
    end)

    UI.Elements = {Status = StatusText, Main = MainFrame}
end

-- // LOGIC ENGINE
local Logic = {}

function Logic:GetRemote()
    local current = Services.ReplicatedStorage
    for _, name in ipairs(CONFIG.REMOTE_PATH) do
        current = current:FindFirstChild(name)
        if not current then return nil end
    end
    return current
end

function Logic:Scan()
    local bestPriority = 999
    local bestTarget = nil
    
    local playerGui = LP:FindFirstChild("PlayerGui")
    if not playerGui then return nil end
    
    local cometsFolder = Services.Workspace:FindFirstChild("COMETS")
    
    -- Iterate through HUDs to find active comets
    for _, child in ipairs(playerGui:GetChildren()) do
        if child.Name == "CometHud" and child.Adornee then
            local frame = child:FindFirstChild("Frame")
            local title = frame and frame:FindFirstChild("TitleText")
            
            if title and title.Text then
                local rawName = title.Text
                local model = child.Adornee
                
                -- Verify physical model exists
                local physical = cometsFolder and cometsFolder:FindFirstChild(tostring(model))
                if physical then
                    local part = physical.PrimaryPart or physical:FindFirstChildWhichIsA("BasePart", true)
                    
                    if part then
                        -- Filter Logic
                        local isAllowed = false
                        for fName, enabled in pairs(State.Filters) do
                            if string.find(rawName, fName) and enabled then
                                isAllowed = true
                                break
                            end
                        end
                        
                        if isAllowed then
                            -- Priority Logic
                            local pIndex = 999
                            for i, pName in ipairs(CONFIG.PRIORITIES) do
                                if string.find(rawName, pName) then
                                    pIndex = i
                                    break
                                end
                            end
                            
                            if pIndex < bestPriority then
                                bestPriority = pIndex
                                bestTarget = {
                                    Part = part,
                                    Name = rawName,
                                    Id = tonumber(tostring(model)),
                                    Priority = pIndex
                                }
                            end
                        end
                    end
                end
            end
        end
    end
    
    return bestTarget
end

function Logic:Start()
    local Remote = self:GetRemote()
    if not Remote then 
        warn("Cyber-Delta: Attack Remote Not Found!")
        UI.Elements.Status.Text = "ERROR: REMOTE NOT FOUND"
        return 
    end

    -- THREAD: Physics (Movement & Scanning)
    Services.RunService.Heartbeat:Connect(function()
        if not State.Enabled then 
            State.LastTarget = nil -- Reset state if stopped
            return 
        end

        local target = self:Scan()
        State.Target = target

        -- [[ WEBHOOK LOGIC: STATE COMPARISON ]]
        -- 1. DETECT TARGET LOCK (Transition from Nil to Target, or Target ID Changed)
        if target and (not State.LastTarget or State.LastTarget.Id ~= target.Id) then
            -- Check priority tier
            local threshold = 99
            for i, pName in ipairs(CONFIG.PRIORITIES) do
                if pName == CONFIG.WEBHOOK.MinTierToNotify then threshold = i break end
            end
            
            if target.Priority <= threshold then
                 Library:SendWebhook("☄️ TARGET LOCKED", "Found: **" .. target.Name .. "**\nStarting attack sequence...", CONFIG.WEBHOOK.Colors.Lock)
            end
            State.LastTarget = target
        end

        -- 2. DETECT TARGET DONE/DESTROYED (Transition from Target to Nil)
        if not target and State.LastTarget then
            Library:SendWebhook("✅ TARGET ELIMINATED", "Finished: **" .. State.LastTarget.Name .. "**\nResume Scanning...", CONFIG.WEBHOOK.Colors.Done)
            State.LastTarget = nil
        end

        if target then
            UI.Elements.Status.Text = "LOCKED: " .. target.Name
            UI.Elements.Status.TextColor3 = CONFIG.THEME.Success
            
            -- TP
            local char = LP.Character
            if char then
                local hrp = char:FindFirstChild("HumanoidRootPart")
                if hrp then
                    local tCFrame = target.Part.CFrame
                    -- Teleport slightly above
                    hrp.CFrame = tCFrame + Vec3(0, 5, 0)
                    hrp.Velocity = Vec3.zero
                end
            end
        else
            UI.Elements.Status.Text = "SCANNING SECTOR..."
            UI.Elements.Status.TextColor3 = CONFIG.THEME.Primary
        end
    end)

    -- THREAD: Attack (Async Loop)
    task.spawn(function()
        while true do
            if State.Enabled and State.Target then
                -- Fire Remote
                Remote:FireServer(State.Target.Id)
            end
            -- Adjust speed here (0.001 is safe for most executors)
            task.wait(0.001) 
        end
    end)
end

-- // EXECUTE
UI:Init()
Logic:Start()
