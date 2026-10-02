ROLE

You are a principal game architect, senior full-stack engineer, AI systems engineer,
3D web graphics engineer, backend engineer, and DevOps engineer.

Your task is to PLAN, IMPLEMENT, TEST, DOCUMENT, AND RUN a production-quality
browser-based 3D strategy game.

Do not build a superficial mockup.

Build a genuinely playable strategy game with:
- 3D graphics
- meaningful strategy
- an evolving world
- persistent save/load
- AI-generated narrative/content
- AI-driven strategic decisions
- server-authoritative deterministic game rules
- Google Gemini integration for narrative/text and image generation
- TypeSafe AI integration for structured strategic decisions
- Docker Compose local development
- automated tests
- production-minded architecture
- graceful AI failure handling

The application must work locally with:

    docker compose up --build

and expose a browser-playable game.

============================================================
1. GAME CONCEPT
============================================================

Create a new original game called:

    "ECHOES OF THE FRONTIER"

Genre:

    3D evolving grand-strategy / colony-management / exploration game

Perspective:

    isometric / slightly elevated 3D tactical camera

Core fantasy:

The player leads the last surviving civilization on a dynamically evolving frontier.
The world is not static. Geography, climate, ecosystems, factions, technologies,
alliances, cities, resources, political relationships, and historical events change
throughout the campaign.

The player should feel that:

    "The world is remembering what I did."

The game should not be a clone of an existing commercial game.

It may take inspiration from:
- Civilization
- Anno
- Frostpunk
- Against the Storm
- XCOM
- Stellaris
- Northgard
- Into the Breach
- classic 4X/colony strategy games

but all game mechanics, names, assets, lore, factions, UI, and narrative should be
original.

============================================================
2. CORE GAME LOOP
============================================================

The game is turn-based / strategic-tick based.

Each turn represents a meaningful period of time in the world.

Recommended progression:

    Explore
       ↓
    Gather resources
       ↓
    Build / expand
       ↓
    Research
       ↓
    Manage population
       ↓
    Diplomacy
       ↓
    Respond to events
       ↓
    Make strategic decisions
       ↓
    Advance the world
       ↓
    World evolves
       ↓
    New opportunities/threats
       ↓
    Repeat

The game must NOT depend on an AI API call for every frame or every mouse movement.

AI calls occur only at meaningful strategic points.

The rendering/gameplay loop must remain responsive even when AI APIs are unavailable.

============================================================
3. WHAT MAKES THE GAME "EVOLVING"
============================================================

Evolution is the defining feature.

The world must permanently react to player actions.

Examples:

- Over-harvesting forests reduces future timber availability.
- Industrialization increases pollution.
- Pollution can change local ecosystems.
- Destroyed settlements can become ruins.
- Trade routes can create wealthy regions.
- Neglected regions can become unstable.
- Repeated diplomatic behavior changes faction relationships.
- Factions remember previous conflicts.
- A faction repeatedly defeated by the player may change strategy.
- A civilization that loses territory may migrate.
- Technologies change the economy.
- Technology can unlock new building classes.
- Climate conditions influence resource production.
- Natural disasters can permanently modify terrain.
- Player choices generate historical events.
- Factions may adopt new technologies independently.
- The strategic map should evolve from the history of the campaign.

Implement a concept called:

    WORLD MEMORY

Every important action generates a compact historical event.

Example:

    Turn 17
    Player destroyed Forest Region #82
    Timber production decreased by 12%
    Local faction "The Verdant Assembly" opinion -18
    Pollution +5
    Habitat quality -11

Later AI systems can be given relevant history.

The game should maintain:

    short-term state
    medium-term trends
    long-term historical memory

============================================================
4. GAME MAP
============================================================

Create a procedural strategic map.

Recommended implementation:

    Hexagonal strategy grid

Map characteristics:

- 40x40 minimum playable region
- multiple terrain types
- rivers
- forests
- mountains
- plains
- deserts
- wetlands
- coast
- lakes
- resource deposits
- points of interest
- ruins
- faction territories

Terrain must visually exist in actual 3D.

The map should be deterministic from:

    worldSeed

If two games use the same seed and the same deterministic commands,
the base world generation must be identical.

Use seeded procedural generation.

DO NOT use Math.random() directly for game-critical randomness.

Implement:

    SeededRandom

and use it everywhere in the authoritative simulation.

============================================================
5. 3D GRAPHICS
============================================================

Use a modern WebGL/WebGPU-compatible stack.

Preferred stack:

    React
    TypeScript
    Three.js
    React Three Fiber
    @react-three/drei

Use modern 3D techniques while keeping browser performance reasonable.

Visual requirements:

- stylized high-quality 3D
- attractive lighting
- atmospheric fog
- shadows
- terrain elevation
- water
- forests
- mountains
- structures
- units
- resource nodes
- territory borders
- selection highlights
- animated units
- camera transitions

Do not make everything a flat colored cube.

Use a coherent art direction.

Recommended visual direction:

    sophisticated stylized 3D
    slightly painterly
    cinematic lighting
    readable strategy-game silhouettes
    beautiful terrain
    restrained UI

The game should look like a premium indie strategy game.

============================================================
6. PERFORMANCE REQUIREMENTS
============================================================

The browser must remain responsive.

Target:

    60 FPS on a reasonable modern desktop

Use:

- InstancedMesh where appropriate
- LOD where appropriate
- texture reuse
- compressed assets where possible
- frustum culling
- lazy loading
- batching
- efficient React state management

NEVER put React state updates inside a high-frequency render loop.

Game simulation and rendering must be separated.

============================================================
7. CLIENT/SERVER ARCHITECTURE
============================================================

Use a server-authoritative architecture.

The browser is NOT authoritative.

Client:

    UI
    3D rendering
    input
    camera
    local presentation
    optimistic UX where safe

Server:

    authoritative game state
    rules
    validation
    turn processing
    AI calls
    persistence
    save/load
    event generation
    world evolution

The client must never be trusted to submit arbitrary resource values,
unit statistics, scores, technology unlocks, etc.

The client sends commands such as:

    BUILD_STRUCTURE
    MOVE_UNIT
    GATHER_RESOURCE
    RESEARCH_TECH
    DECLARE_TRADE
    DIPLOMACY_ACTION
    END_TURN

The server validates and executes the command.

============================================================
8. RECOMMENDED TECHNOLOGY STACK
============================================================

Frontend:

    Next.js
    React
    TypeScript
    Three.js
    React Three Fiber
    drei
    Zustand

Backend:

    TypeScript
    Node.js
    Next.js server/API routes OR a dedicated Fastify service

Choose the architecture that produces the cleanest production result.

Database:

    PostgreSQL

ORM:

    Prisma

Caching / jobs:

    Redis
    BullMQ

Development:

    Docker
    Docker Compose

Testing:

    Vitest
    Playwright
    integration tests

Validation:

    Zod

Logging:

    structured JSON logging

Observability:

    request IDs
    game IDs
    AI request IDs
    latency metrics
    error metrics
    AI usage accounting

============================================================
9. DOCKER COMPOSE
============================================================

Provide a complete:

    docker-compose.yml

Services should include at minimum:

    web
    postgres

Prefer:

    redis

as well.

Example conceptual architecture:

    Browser
       |
       v
    Web/API
       |
       +---------- PostgreSQL
       |
       +---------- Redis
       |
       +---------- Google Gemini
       |
       +---------- TypeSafe AI

The game MUST be playable with:

    docker compose up --build

Provide:

    docker compose down

and document persistent database volumes.

Do not require Kubernetes just to run locally.

============================================================
10. ENVIRONMENT VARIABLES
============================================================

Use environment variables.

Required integrations:

    GOOGLE_API_KEY
    TYPESAFE_API_KEY

Important:

Google's current official JavaScript SDK is @google/genai and normally uses
GEMINI_API_KEY when relying on automatic environment configuration.

However, this application MUST use:

    GOOGLE_API_KEY

as the application's canonical variable.

Implementation should explicitly pass:

    process.env.GOOGLE_API_KEY

to the Google GenAI client.

For compatibility, optionally support:

    GEMINI_API_KEY

as a fallback.

Never expose either key to the browser.

Never embed keys in JavaScript bundles.

Never return API keys from an API endpoint.

Never store keys in the database.

Never commit keys to Git.

Provide:

    .env.example

with placeholders only.

============================================================
11. GOOGLE GEMINI INTEGRATION
============================================================

Use the official Google GenAI JavaScript SDK:

    @google/genai

Do NOT use the deprecated legacy:

    @google/generative-ai

unless the current Google documentation explicitly requires it.

Create a dedicated abstraction:

    GoogleAIService

Do not scatter raw Google API calls throughout the game code.

Configuration:

    GOOGLE_API_KEY
    GOOGLE_TEXT_MODEL
    GOOGLE_IMAGE_MODEL
    GOOGLE_IMAGE_HERO_MODEL

Suggested defaults as of the current API:

    GOOGLE_TEXT_MODEL=gemini-3.8-flash
    GOOGLE_IMAGE_MODEL=gemini-3.1-flash-image
    GOOGLE_IMAGE_HERO_MODEL=gemini-3-pro-image

These must be configurable.

The code must NOT hardcode the model everywhere.

Keep all model names in configuration.

============================================================
12. GOOGLE TEXT AI
============================================================

Google Gemini is responsible primarily for:

- narrative generation
- world-event descriptions
- faction dialogue
- discovered-location descriptions
- civilization histories
- mission descriptions
- lore
- explanations of major world changes
- dynamic flavor text
- procedural story arcs

Example:

The deterministic game engine detects:

    drought + food shortage + hostile neighbor

Then Google Gemini receives a structured description of the situation and generates:

    event title
    narrative description
    faction reactions
    player-facing explanation
    possible consequences text

The AI generates presentation/narrative content.

The authoritative game engine decides actual mechanics.

============================================================
13. NEVER LET GEMINI DIRECTLY MUTATE GAME STATE
============================================================

This is a hard architectural requirement.

Gemini may propose:

    "A drought should reduce crop production."

But Gemini itself must NOT directly modify:

    food
    gold
    population
    hit points
    ownership
    inventory
    technology
    victory points

Instead:

    Gemini output
        ↓
    schema validation
        ↓
    deterministic game rules
        ↓
    state mutation

All authoritative changes must pass through:

    GameEngine

============================================================
14. STRUCTURED GOOGLE OUTPUT
============================================================

Where Gemini must return machine-readable content, use structured output /
JSON Schema support.

Use Zod schemas in TypeScript.

Examples:

    WorldEventNarrative
    FactionNarrative
    DiscoveryNarrative
    CampaignSummary
    AIAssetPrompt

Do NOT parse arbitrary prose with regex.

Example schema:

    {
      eventId: string,
      title: string,
      description: string,
      tone: enum,
      factionReactions: [...],
      visualPrompt: string
    }

Validate everything.

Reject malformed model responses.

Implement safe retry logic.

============================================================
15. GOOGLE IMAGE GENERATION
============================================================

Use Google Gemini's current image-generation models.

Normal dynamic asset generation:

    gemini-3.1-flash-image

Premium/important assets:

    gemini-3-pro-image

Do NOT use Imagen for this project.

Images generated by Google should be used for:

- event artwork
- loading screens
- discovered locations
- faction portraits
- technology illustrations
- civilization artwork
- map landmarks
- chapter illustrations
- special world events
- end-of-era illustrations

IMPORTANT:

Do not attempt to generate every 3D object dynamically with AI.

The 3D world itself should use:
- procedural geometry
- reusable 3D assets
- deterministic shaders
- instancing

AI-generated images should complement the game rather than become the real-time
rendering engine.

============================================================
16. IMAGE GENERATION PIPELINE
============================================================

Implement:

    ImageGenerationService

with:

    generateEventImage()
    generateFactionPortrait()
    generateLocationImage()
    generateTechnologyImage()

Store generated assets.

Architecture:

    Game Event
        |
        v
    Generate image prompt
        |
        v
    Image cache lookup
        |
        +---- exists ---> reuse
        |
        +---- missing --> Google image model
                              |
                              v
                         persistent storage

Do NOT regenerate the same image every page refresh.

Generate only once.

Persist:

    assetId
    promptHash
    model
    dimensions
    mimeType
    createdAt
    gameId / eventId
    storage location

Use a content hash to deduplicate identical requests.

For local development, use filesystem/object-storage emulation.

Design the storage interface so production can later use:

    S3 / GCS / equivalent object storage

without changing game logic.

============================================================
17. AI COST CONTROL
============================================================

AI must never create runaway costs.

Implement:

    AI request queue
    per-game AI budget
    per-turn AI budget
    per-user AI budget
    request deduplication
    response caching
    timeout
    retries
    backoff
    circuit breaker

Example:

    MAX_AI_REQUESTS_PER_TURN=10

Make configurable.

Never call an image model repeatedly because React rerendered.

Never call AI directly from client-side code.

All requests are server-side.

============================================================
18. GOOGLE RATE LIMIT HANDLING
============================================================

Implement retry handling for transient failures such as:

    429
    500
    503

Use exponential backoff with jitter.

Do not infinitely retry.

Recommended:

    attempt 1 -> immediate/small delay
    attempt 2 -> backoff
    attempt 3 -> larger backoff

Then:

    fail gracefully

The game must remain playable when Google is unavailable.

============================================================
19. TYPESAFE AI INTEGRATION
============================================================

Use TypeSafe specifically for game decisions.

TypeSafe is NOT the narrative engine.

TypeSafe is NOT the image engine.

TypeSafe is NOT the authoritative game engine.

TypeSafe is the:

    strategic decision engine

Use the official JavaScript/TypeScript package:

    @typesafe-ai/sdk

Authenticate with:

    TYPESAFE_API_KEY

Create:

    TypeSafeDecisionService

Never access TypeSafe directly from browser code.

============================================================
20. TYPESAFE MODEL
============================================================

Use a configurable model:

    TYPESAFE_MODEL

Default:

    jev-latest

For deterministic/reproducible deployments, support a pinned model such as:

    jev-1.13.0

Record the actual model used in AI decision logs.

Never assume aliases remain permanently unchanged.

============================================================
21. TYPESAFE SYSTEM ONE
============================================================

TypeSafe System One accepts application state and asks structured questions.

Use:

    Choice
    Score
    Noul

decisions.

This is ideal for strategy-game AI.

Do NOT ask:

    "What should the enemy do?"

and expect a paragraph.

Instead ask machine-readable questions.

Example:

    Which strategic action should the faction take?

choices:

    expand
    defend
    trade
    raid
    research
    retreat

Another question:

    How urgent is the food shortage?

score:

    1
    2
    3
    4
    5

Another:

    Is attacking the player strategically justified?

noul:

    yes/no probability

============================================================
22. TYPESAFE DECISION ARCHITECTURE
============================================================

For every AI-controlled faction:

    GameState
       |
       v
    StateReducer / StateProjection
       |
       v
    Relevant strategic state
       |
       v
    TypeSafe
       |
       v
    Typed decisions + probabilities
       |
       v
    Decision Policy
       |
       v
    Validation
       |
       v
    GameEngine
       |
       v
    World Mutation

The TypeSafe model NEVER directly changes the database.

============================================================
23. TYPESAFE DECISION EXAMPLE
============================================================

Construct something conceptually similar to:

    const result = await client.systemOne({
      model: TYPESAFE_MODEL,
      state: {
        faction: factionState,
        player: playerState,
        map: relevantMapState,
        resources: resourceState,
        diplomacy: diplomacyState,
        recentHistory: relevantHistory
      },
      questions: {
        strategicAction: choice(
          "Choose the strategic action with the best expected outcome.",
          {
            expand: "Expand territory toward valuable resources.",
            defend: "Strengthen defenses against immediate threats.",
            trade: "Increase diplomatic trade activity.",
            raid: "Conduct a limited hostile raid.",
            research: "Prioritize technology development.",
            retreat: "Reduce exposure and consolidate territory."
          }
        ),
        threatLevel: score(
          "How severe is the immediate strategic threat?",
          [
            "minimal",
            "low",
            "moderate",
            "high",
            "critical"
          ]
        ),
        shouldAttack: noul(
          "Given the current state, should this faction initiate an attack?"
        )
      }
    });

Use the actual current TypeSafe SDK API rather than blindly copying this example
if its current interface differs.

IMPORTANT:

The coding agent MUST check the current TypeSafe SDK documentation/package
before finalizing the implementation.

============================================================
24. USE TYPESAFE PROBABILITIES
============================================================

Do not treat TypeSafe as a deterministic oracle.

Use:

    probability
    confidence
    score

to influence decision policies.

For example:

    confidence >= 0.80
        -> execute decision

    confidence between 0.55 and 0.80
        -> execute conservative variant

    confidence < 0.55
        -> use deterministic fallback policy

The exact thresholds must be configurable.

This produces more believable AI behavior than:

    if AI says X -> always X

============================================================
25. TYPESAFE + CLASSIC GAME AI
============================================================

Do not make TypeSafe responsible for all AI behavior.

Combine:

    deterministic utility AI
    strategic rules
    TypeSafe decisions

Example:

    hard game rules
       +
    candidate-action filtering
       +
    TypeSafe strategic judgment
       +
    utility scoring
       +
    deterministic resolver

This prevents impossible actions.

If a faction does not have enough resources to perform:

    build_super_weapon

TypeSafe must never be able to make that happen.

The candidate action list should already be legal.

============================================================
26. AI DECISION FALLBACK
============================================================

The game must continue if TypeSafe is:

    unavailable
    rate limited
    timed out
    returning errors

Fallback:

    deterministic strategic policy

Example:

    if food < threshold:
        gather_food

    else if enemy_strength > own_strength * 1.5:
        defend

    else:
        expand

AI enhances the simulation.

AI must never be a single point of failure.

============================================================
27. AI MEMORY
============================================================

Every AI decision should optionally record:

    gameId
    turn
    factionId
    stateHash
    model
    question schema version
    answer
    probability
    confidence
    execution result
    timestamp
    latency
    fallbackUsed

This gives the game an explainable strategic history.

============================================================
28. EVENT SYSTEM
============================================================

Implement a first-class event engine.

Event examples:

    drought
    volcanic eruption
    migration
    plague
    discovery
    rebellion
    trade boom
    resource collapse
    religious movement
    technological breakthrough
    faction split
    border conflict
    ecological recovery
    ancient ruin discovery

Events must have:

    deterministic trigger
    severity
    duration
    affected regions
    state effects
    narrative payload
    visual payload
    history record

Example:

    Drought

    Trigger:
        rainfall < threshold

    Game effects:
        crops -20%
        livestock -10%
        migration pressure +15

    Narrative:
        generated by Gemini

    Faction response:
        selected by TypeSafe

============================================================
29. PROCEDURAL QUESTS
============================================================

Create dynamically generated objectives.

Examples:

    restore a ruined city
    defend a trading route
    discover an ancient site
    negotiate peace
    investigate unexplained weather
    rescue a settlement
    exploit a rare resource
    investigate a faction rebellion

Gemini may generate:

    quest title
    description
    flavor
    visuals

The game engine generates:

    actual rewards
    actual requirements
    actual state transitions

============================================================
30. FACTIONS
============================================================

Include at least:

    5 major factions

Each faction should have:

    identity
    territory
    economy
    technology level
    military strength
    personality traits
    diplomatic relationships
    goals
    memories
    strategic preferences

Factions evolve.

Examples:

    aggressive faction
    merchant faction
    ecological faction
    technocratic faction
    nomadic faction

Do not hardcode only one AI personality.

============================================================
31. DIPLOMACY
============================================================

Implement:

    alliance
    trade
    sanctions
    treaties
    war
    ceasefire
    espionage
    gifts
    territorial claims

Relationships should be numeric internally.

Example:

    -100 hostile
    -50 unfriendly
     0 neutral
    +50 friendly
   +100 allied

Use game rules to control legal transitions.

AI can influence diplomatic actions through TypeSafe.

============================================================
32. ECONOMY
============================================================

Resources:

    food
    wood
    stone
    metal
    energy
    knowledge
    influence

At minimum implement:

    gathering
    production
    consumption
    storage
    trade
    growth

Economy must be deterministic.

============================================================
33. TECHNOLOGY TREE
============================================================

Implement a technology tree with multiple branches.

Example:

    Agriculture
       |
       +-- Irrigation
       +-- Selective Breeding
       +-- Hydroponics

    Industry
       |
       +-- Metallurgy
       +-- Automation
       +-- Advanced Manufacturing

    Society
       |
       +-- Administration
       +-- Diplomacy
       +-- Cultural Exchange

Technology should alter the game mechanically.

Do not create technologies that only change a label.

============================================================
34. BUILDINGS
============================================================

Implement at least:

    settlement center
    farm
    lumber camp
    quarry
    mine
    workshop
    warehouse
    laboratory
    market
    barracks
    wall
    watchtower
    power plant

Buildings must have:

    construction cost
    production effects
    upkeep
    prerequisites
    visual representation

============================================================
35. UNITS
============================================================

Implement:

    worker
    scout
    guard
    ranged unit
    heavy unit
    explorer

Units require:

    position
    movement
    health
    faction
    type
    actions
    state

Combat should be simple but strategically meaningful.

============================================================
36. COMBAT
============================================================

Combat must be deterministic.

Do not allow an LLM to calculate damage.

Example:

    attackPower
    defensePower
    terrainModifier
    technologyModifier
    moraleModifier
    randomSeed

Calculate results inside GameEngine.

TypeSafe may choose:

    attack
    defend
    retreat
    flank

but never calculate arbitrary damage values.

============================================================
37. WORLD HISTORY
============================================================

Create a historical event log.

Example:

    YEAR 14
    The Ashfall War

    The player civilization defeated the northern miners.

Then later:

    YEAR 21
    Descendants of the northern miners establish a new settlement.

This creates continuity.

The world should feel persistent.

============================================================
38. GAME SAVE SYSTEM
============================================================

Implement robust save/load.

Required actions:

    New Game
    Save Game
    Load Game
    Delete Save
    Autosave
    Continue Game

Save slots should include:

    saveId
    playerId / anonymous player identifier
    game name
    world seed
    turn
    current era
    timestamp
    version
    state hash

Game state must include:

    map state
    settlements
    units
    resources
    technology
    factions
    diplomacy
    world variables
    quests
    events
    history
    AI memory
    random seed/state

============================================================
39. DATABASE DESIGN
============================================================

Use PostgreSQL.

Use Prisma.

At minimum create tables/models for:

    Game
    GameState
    SaveGame
    Player
    Faction
    Settlement
    Unit
    Tile
    ResourceNode
    Technology
    Quest
    GameEvent
    HistoricalEvent
    DiplomacyRelation
    AIDecision
    AIRequest
    GeneratedAsset

Do not blindly serialize the entire database into one giant JSON blob.

Use a hybrid approach:

    normalized entities
       +
    versioned world snapshots
       +
    event history

Game snapshots can still contain compact serialized simulation state for fast restore.

============================================================
40. VERSIONED SAVES
============================================================

Every save must include:

    schemaVersion

Implement migrations.

Example:

    SAVE_SCHEMA_VERSION = 3

When loading an older save:

    detect version
       ↓
    migration pipeline
       ↓
    current representation

Never silently corrupt an old save.

============================================================
41. EVENT-SOURCED HISTORY
============================================================

Important game actions should generate events.

Example:

    PLAYER_BUILT_BUILDING
    PLAYER_DECLARED_WAR
    FACTION_ATTACKED_SETTLEMENT
    TECHNOLOGY_RESEARCHED
    RESOURCE_DISCOVERED
    NATURAL_DISASTER
    DIPLOMATIC_TREATY_SIGNED

This history feeds the AI context.

============================================================
42. REPLAYABILITY
============================================================

Implement deterministic simulation.

Given:

    worldSeed
    initial state
    sequence of validated commands

the simulation should produce the same state.

AI calls may be nondeterministic, therefore:

    NEVER re-run an AI request during replay.

Persist AI results.

Replay uses:

    stored AI decisions

not new external calls.

This is critical.

============================================================
43. AI CONTEXT REDUCTION
============================================================

Never send the entire database to an AI model.

Build:

    StrategicStateProjection

It should contain only information relevant to the current decision.

Example:

    current turn
    faction resources
    army strength
    nearby enemies
    current threats
    technology
    diplomatic state
    recent events
    strategic objectives
    nearby map summary

This reduces latency and cost.

============================================================
44. GOOGLE CONTEXT CACHING
============================================================

Where repeated large prompts/context make sense, architect the system so Google
context caching can be introduced.

Do not blindly create a cache for every request.

Good candidates:

    permanent faction lore
    game rules
    recurring world context
    long campaign summaries

Use current Gemini caching capabilities where supported.

============================================================
45. AI REQUEST QUEUE
============================================================

AI work should be asynchronous where possible.

Example:

    END TURN
       |
       v
    resolve deterministic simulation
       |
       v
    enqueue faction AI decisions
       |
       v
    TypeSafe
       |
       v
    resolve faction actions
       |
       v
    enqueue narrative generation
       |
       v
    Google Gemini
       |
       v
    update presentation assets
       |
       v
    client receives world update

Do not block the entire game on image generation.

Image generation may complete asynchronously after the actual game event occurs.

============================================================
46. REAL-TIME UPDATES
============================================================

Provide a mechanism for server -> browser event updates.

Prefer:

    Server-Sent Events
or
    WebSocket

Use it for:

    AI decision completed
    new event generated
    image generated
    faction action resolved
    turn completed

The game must also work with polling fallback.

============================================================
47. USER INTERFACE
============================================================

The UI must feel like a real strategy game.

Main screen:

    3D strategic map

Top bar:

    Food
    Wood
    Stone
    Metal
    Energy
    Knowledge
    Influence

Left panel:

    selected entity details

Right panel:

    objectives
    events
    faction information

Bottom bar:

    actions
    build
    research
    diplomacy
    end turn

Map overlay:

    territory
    resources
    movement
    danger
    diplomacy

============================================================
48. MINIMAL/HUDLESS VISUAL PHILOSOPHY
============================================================

Do not cover the game with dozens of panels.

Use:

    contextual controls
    clean cards
    animation
    tooltips
    progressive disclosure

The 3D world should remain the focus.

============================================================
49. CAMERA
============================================================

Implement:

    pan
    zoom
    rotate
    smooth focus
    unit focus
    settlement focus
    event camera

Provide keyboard and mouse controls.

============================================================
50. ACCESSIBILITY
============================================================

Support:

    keyboard navigation
    readable contrast
    scalable UI
    tooltips
    reduced animation option
    text descriptions for important events

============================================================
51. GAME START
============================================================

The new-game flow:

    New Game
       |
       +-- civilization name
       |
       +-- difficulty
       |
       +-- world seed / random
       |
       +-- starting location
       |
       v
    World Generation
       |
       v
    Gemini-generated campaign introduction
       |
       v
    Play

The introduction should be generated once and persisted.

============================================================
52. CAMPAIGN ERAS
============================================================

The game is divided into eras.

Example:

    Era I    Survival
    Era II   Expansion
    Era III  Industrialization
    Era IV   Transformation
    Era V    Legacy

Each era changes:

    available technologies
    factions
    threats
    resources
    visuals
    narrative

Advancing eras should visually transform the world.

============================================================
53. ENDGAME
============================================================

Provide multiple victory paths.

Examples:

    Dominion
    Prosperity
    Scientific Ascension
    Ecological Restoration
    Diplomatic Federation

The game should track progress toward several victory conditions.

Do NOT make victory dependent on AI-generated prose.

Victory is deterministic.

============================================================
54. AI-GENERATED WORLD EVENTS
============================================================

Implement an event director.

Concept:

    deterministic world state
          ↓
    identify interesting conditions
          ↓
    choose event class
          ↓
    deterministic mechanics
          ↓
    TypeSafe faction decisions
          ↓
    Gemini narrative
          ↓
    Gemini visual asset
          ↓
    event presentation

This is the main "living world" system.

============================================================
55. AI DIRECTOR PRINCIPLE
============================================================

The AI should create SURPRISE, not randomness without structure.

Good:

    The player industrialized heavily.
    Pollution increased.
    River ecosystem declined.
    Ecological faction became hostile.
    TypeSafe chose diplomatic sanctions.
    Gemini generated a narrative about the "River Crisis".

Bad:

    Random AI event happens for no reason.

Every significant AI-generated event must have an understandable cause in game state.

============================================================
56. ANTI-HALLUCINATION ARCHITECTURE
============================================================

Treat model output as untrusted input.

Every AI response:

    receive
       ↓
    schema validate
       ↓
    semantic validate
       ↓
    game legality checks
       ↓
    deterministic engine
       ↓
    persist

Reject anything invalid.

Never let AI invent:

    arbitrary database IDs
    nonexistent technologies
    illegal actions
    impossible resources
    unauthorized game commands

============================================================
57. SECURITY
============================================================

Implement:

    server-side secrets
    input validation
    output validation
    rate limiting
    request size limits
    authentication abstraction
    authorization checks
    CSRF protection where relevant
    secure headers
    SQL injection protection through ORM
    no secret leakage in logs

API keys MUST NOT appear in:

    source control
    client bundle
    browser localStorage
    database
    normal application logs

============================================================
58. OBSERVABILITY
============================================================

Implement structured logging.

Every AI call should include:

    correlationId
    gameId
    turn
    provider
    model
    operation
    latency
    status
    retryCount

Do NOT log secrets.

Provide:

    /health
    /ready

endpoints.

============================================================
59. ERROR HANDLING
============================================================

Use friendly errors in UI.

Example:

    "The frontier oracle is temporarily unavailable.
     Your civilization can continue using fallback strategy."

Never expose:

    stack traces
    API keys
    provider internals

to normal players.

============================================================
60. OFFLINE / DEGRADED MODE
============================================================

Core gameplay must continue if:

    Google is unavailable
    TypeSafe is unavailable
    image generation fails

Use:

    deterministic fallback narratives
    deterministic faction AI
    placeholder/procedural visuals

This makes the game robust.

============================================================
61. AI PROVIDER ABSTRACTIONS
============================================================

Use interfaces.

Example:

    interface TextGenerationProvider

    interface ImageGenerationProvider

    interface StrategicDecisionProvider

Production implementations:

    GeminiTextProvider
    GeminiImageProvider
    TypeSafeDecisionProvider

Fallback implementations:

    LocalTextProvider
    LocalImageProvider
    DeterministicDecisionProvider

This makes testing easy.

============================================================
62. TESTING
============================================================

Write actual automated tests.

Unit tests:

    economy
    combat
    movement
    terrain
    technology
    diplomacy
    world evolution
    save/load
    deterministic randomness

Integration tests:

    API
    PostgreSQL
    Redis
    AI service adapters

AI tests:

    malformed output
    timeout
    429
    provider unavailable
    invalid action
    low confidence
    high confidence
    duplicate request

End-to-end:

    start game
    build settlement
    collect resources
    research technology
    interact with faction
    end turn
    observe faction AI
    save
    reload
    continue

============================================================
63. DETERMINISM TEST
============================================================

Implement a test:

    same seed
    same commands
    same stored AI decisions

must produce:

    identical authoritative game state hash

This is a mandatory acceptance criterion.

============================================================
64. DATABASE TEST
============================================================

Verify:

    create save
    save
    restart containers
    load save
    continue campaign

The save must survive Docker container restart.

============================================================
65. PLAYABLE VERTICAL SLICE
============================================================

Before implementing every advanced mechanic, build a complete vertical slice.

Vertical slice must include:

    procedural 3D map
    player settlement
    resources
    at least 3 buildings
    workers
    at least 2 factions
    diplomacy
    one technology branch
    combat
    end turn
    evolving event
    TypeSafe decision
    Gemini text generation
    Gemini image generation
    save
    load

The vertical slice must be genuinely playable.

Then expand.

============================================================
66. ART ASSET STRATEGY
============================================================

Do not wait for hundreds of generated assets.

Create reusable base assets:

    trees
    rocks
    mountains
    farms
    houses
    walls
    mines
    towers
    units

Use procedural variation:

    scale
    rotation
    tint
    position
    animation

Generate a limited number of high-value AI images for:

    major events
    factions
    technologies
    discoveries
    loading screens

============================================================
67. PROCEDURAL TERRAIN
============================================================

Use seeded noise algorithms.

Terrain generation should produce:

    elevation
    moisture
    temperature

Then derive:

    biome

Example:

    elevation + moisture + temperature
         ↓
    forest / plains / desert / tundra / mountain / wetland

Resource placement should be derived from the biome.

============================================================
68. GAME STATE MACHINE
============================================================

Create explicit state transitions.

Example:

    PLANNING
       ↓
    PLAYER_ACTIONS
       ↓
    RESOLUTION
       ↓
    FACTION_AI
       ↓
    WORLD_EVOLUTION
       ↓
    EVENTS
       ↓
    NARRATIVE/ASSETS
       ↓
    TURN_COMPLETE
       ↓
    PLANNING

Do not let unrelated modules mutate global state directly.

============================================================
69. COMMAND PATTERN
============================================================

Use validated commands.

Example:

    type GameCommand =
      | BuildCommand
      | MoveCommand
      | ResearchCommand
      | DiplomacyCommand
      | AttackCommand
      | EndTurnCommand;

Each command must contain:

    commandId
    gameId
    playerId
    turn
    type
    payload

Commands should be idempotent where practical.

============================================================
70. STATE HASHING
============================================================

Generate a canonical state hash after each strategic turn.

Store:

    stateHash

This allows:

    debugging
    reproducibility
    save validation
    replay verification

============================================================
71. API DESIGN
============================================================

Provide REST/JSON APIs such as:

    POST /api/games
    GET  /api/games/:id
    POST /api/games/:id/commands
    POST /api/games/:id/end-turn
    GET  /api/games/:id/events
    POST /api/games/:id/save
    GET  /api/saves
    GET  /api/saves/:id
    POST /api/saves/:id/load
    DELETE /api/saves/:id

AI internal endpoints should be separate from public game APIs.

============================================================
72. SAVE UI
============================================================

Provide:

    Save Game
    Save As
    Load Game
    New Game
    Delete Save

Show:

    campaign name
    era
    turn
    timestamp
    civilization
    world seed

Autosave after:

    end turn
    major event
    major diplomatic event
    technology research

============================================================
73. PLAYER FEEDBACK
============================================================

When a turn completes, show a beautiful summary:

    TURN COMPLETE

    +12 Food
    +4 Knowledge
    Trade treaty signed
    Northern faction expanded
    New event discovered

Then animate the camera to major events.

============================================================
74. GENERATED NARRATIVE
============================================================

Gemini text should be context aware.

A later event should reference previous events.

Example:

Turn 7:
    Player discovers the Black Valley.

Turn 31:
    A faction reacts to the Black Valley discovery.

Gemini should receive relevant campaign history.

This creates persistent narrative continuity.

============================================================
75. CAMPAIGN SUMMARY
============================================================

At any time the player can see:

    History

The system generates a compact campaign summary.

Include:

    major discoveries
    wars
    alliances
    technological milestones
    ecological changes
    disasters
    important faction relationships

Persist the summary.

Use it as compressed context instead of repeatedly sending massive histories.

============================================================
76. MODEL COST OPTIMIZATION
============================================================

Use model specialization.

High-frequency/lightweight:

    Gemini Flash / Flash-Lite style text operations

Image:

    gemini-3.1-flash-image

Premium images:

    gemini-3-pro-image

Strategic decisions:

    TypeSafe Jev

Do not use an expensive image model for tiny UI icons.

Do not use Gemini when deterministic code can solve the problem.

============================================================
77. AI CACHE
============================================================

Cache based on normalized input.

Concept:

    sha256(
      provider +
      model +
      promptVersion +
      normalizedInput
    )

If identical request already exists:

    return cached result

Persist cache metadata.

============================================================
78. PROMPT VERSIONING
============================================================

Every AI prompt must have:

    promptId
    promptVersion

Example:

    faction_decision_v3
    event_narrative_v5
    location_art_v2

This is important for production debugging.

============================================================
79. AI TELEMETRY
============================================================

Display developer metrics, NOT player-facing secrets.

Example internal dashboard:

    Gemini requests
    Gemini failures
    Gemini latency
    Gemini token usage
    TypeSafe decisions
    TypeSafe latency
    fallback count
    image generation count

============================================================
80. DEVELOPMENT MODE
============================================================

Implement:

    AI_MODE=live
    AI_MODE=mock
    AI_MODE=deterministic

Mock mode must not require external API keys.

This allows:

    docker compose up

to run even without AI credentials, while enabling full AI features when keys exist.

============================================================
81. LOCAL DEVELOPMENT EXPERIENCE
============================================================

Provide:

    .env.example

Example:

    GOOGLE_API_KEY=
    GEMINI_API_KEY=
    TYPESAFE_API_KEY=

    GOOGLE_TEXT_MODEL=gemini-3.8-flash
    GOOGLE_IMAGE_MODEL=gemini-3.1-flash-image
    GOOGLE_IMAGE_HERO_MODEL=gemini-3-pro-image

    TYPESAFE_MODEL=jev-latest

    DATABASE_URL=...
    REDIS_URL=...

    AI_MODE=live

Also provide:

    README.md

with exact commands.

============================================================
82. LOCAL BOOTSTRAP
============================================================

The agent must ensure:

    docker compose up --build

starts the application.

Database migrations should run automatically or through a documented command.

Provide optional seed data:

    npm run seed

or equivalent.

============================================================
83. DEMO MODE
============================================================

Implement a one-command demo:

    docker compose up --build

then:

    http://localhost:3000

The first game should be immediately playable.

Do not make the developer manually configure ten services.

============================================================
84. HEALTH CHECKS
============================================================

Docker health checks:

    web
    postgres
    redis

The application should wait for dependencies to become healthy.

============================================================
85. PRODUCTION CONTAINER
============================================================

Use a multi-stage Dockerfile.

Requirements:

    small final image
    non-root user
    deterministic package install
    no development dependencies in production image
    proper signal handling
    health endpoint

============================================================
86. CI
============================================================

Provide CI that performs:

    install
    lint
    typecheck
    unit tests
    integration tests
    build
    Docker build

Do not require live Google or TypeSafe credentials for ordinary CI.

Use mock providers for CI.

============================================================
87. ARCHITECTURE DOCUMENTATION
============================================================

Create:

    docs/architecture.md

Include diagrams in Mermaid.

Document:

    browser
    API
    game engine
    persistence
    Redis
    Gemini
    TypeSafe
    asset pipeline

============================================================
88. AI ARCHITECTURE DOCUMENT
============================================================

Create:

    docs/ai-architecture.md

Explain:

    Gemini text
    Gemini images
    TypeSafe decisions
    prompt versioning
    caching
    retries
    fallback behavior
    deterministic state
    AI memory
    cost control

============================================================
89. GAME DESIGN DOCUMENT
============================================================

Create:

    docs/game-design.md

Document:

    game loop
    factions
    resources
    technologies
    buildings
    units
    combat
    diplomacy
    events
    evolution
    victory conditions

============================================================
90. SECURITY DOCUMENT
============================================================

Create:

    docs/security.md

Explain:

    secret handling
    server-side AI access
    validation
    authorization
    rate limiting
    logging
    data protection

============================================================
91. CODE QUALITY
============================================================

Use strict TypeScript.

Enable:

    noImplicitAny
    strict
    strictNullChecks
    noUncheckedIndexedAccess

Avoid:

    any

unless absolutely unavoidable.

Use:

    interfaces
    discriminated unions
    Zod
    domain modules

Prefer small testable modules.

============================================================
92. DIRECTORY STRUCTURE
============================================================

Use a clean architecture.

Suggested structure:

    apps/
      web/
      worker/

    packages/
      game-engine/
      game-types/
      ai/
      database/
      shared/
      procedural-world/
      rendering/

    prisma/
    docs/
    tests/

Do not force this exact structure if another architecture is demonstrably cleaner,
but maintain strong separation between:

    rendering
    UI
    game simulation
    persistence
    AI
    infrastructure

============================================================
93. DOMAIN SEPARATION
============================================================

The GameEngine must NOT depend directly on:

    React
    Three.js
    PostgreSQL
    Google
    TypeSafe

The GameEngine must operate as a pure domain simulation where possible.

Then adapters connect it to:

    database
    AI providers
    rendering

This is critical for testing.

============================================================
94. GAME ENGINE API
============================================================

Provide an API conceptually similar to:

    createGame(seed)
    getState()
    executeCommand(command)
    resolveTurn()
    evolveWorld()
    getLegalActions()
    calculateStateHash()

The game engine must be independently testable.

============================================================
95. AI POLICY LAYER
============================================================

Create:

    DecisionPolicy

which takes:

    candidate actions
    game state
    TypeSafe probabilities/confidence

and returns:

    validated action

This prevents an AI provider from directly controlling gameplay.

============================================================
96. NARRATIVE POLICY
============================================================

Gemini should receive:

    structured facts

not invented facts.

Example:

    {
      type: "drought",
      severity: 0.73,
      affectedRegion: "north",
      foodReduction: 0.2
    }

Gemini should turn that into player-facing narrative.

The game engine remains the source of truth.

============================================================
97. IMAGE PROMPT POLICY
============================================================

Image prompts should be generated from canonical world facts.

Example:

    faction identity
    technology level
    biome
    architecture
    event
    era

Avoid contradictory image prompts.

Store canonical visual descriptions for major factions.

============================================================
98. ART STYLE CONSISTENCY
============================================================

Use a global visual style bible.

Example:

    "stylized high-end 3D strategy game,
     painterly surfaces,
     realistic cinematic lighting,
     slightly exaggerated scale,
     readable silhouettes,
     rich natural environments,
     coherent architectural language"

Generated assets must use a shared style description.

============================================================
99. AI FAILURE DEMONSTRATION
============================================================

Provide developer simulation controls:

    Disable Gemini
    Disable TypeSafe
    Force rate limit
    Force timeout

Verify that the game continues.

============================================================
100. ACCEPTANCE CRITERIA
============================================================

The project is NOT complete until all of the following are true:

[ ] docker compose up --build works

[ ] browser game loads

[ ] 3D map is visible

[ ] player can move around the map

[ ] player can build structures

[ ] resources change correctly

[ ] technology can be researched

[ ] at least two factions exist

[ ] factions make strategic decisions

[ ] TypeSafe is called in live mode

[ ] TypeSafe decisions are schema-safe

[ ] TypeSafe failures have fallback behavior

[ ] Gemini can generate narrative

[ ] Gemini can generate images

[ ] generated images are cached

[ ] Gemini failures do not crash gameplay

[ ] world changes over turns

[ ] historical events are stored

[ ] diplomacy works

[ ] combat works

[ ] player can save

[ ] player can load

[ ] save survives container restart

[ ] state hash is generated

[ ] deterministic simulation tests pass

[ ] unit tests pass

[ ] integration tests pass

[ ] e2e test passes

[ ] application runs without AI credentials in mock mode

[ ] API keys never reach browser

[ ] README explains setup

[ ] architecture documentation exists

============================================================
101. IMPORTANT IMPLEMENTATION RULE
============================================================

DO NOT stop at scaffolding.

DO NOT simply create:

    empty components
    fake buttons
    placeholder APIs
    TODO comments
    mocked gameplay disguised as implementation

Every major system must work.

A feature can be simplified internally,
but the player-facing behavior must be real.

============================================================
102. DEVELOPMENT STRATEGY
============================================================

Implement in phases.

PHASE 1
    project bootstrap
    Docker Compose
    PostgreSQL
    Redis
    Next.js
    Three.js
    basic 3D world

PHASE 2
    GameEngine
    deterministic world
    player settlement
    resources
    buildings
    units

PHASE 3
    factions
    diplomacy
    combat
    technology

PHASE 4
    TypeSafe integration

PHASE 5
    Gemini text integration

PHASE 6
    Gemini image integration

PHASE 7
    evolution/event system

PHASE 8
    persistence/save/load

PHASE 9
    observability/security

PHASE 10
    tests
    performance
    polish

After every phase:

    run tests
    run typecheck
    run build
    manually verify functionality

============================================================
103. RESEARCH-FIRST REQUIREMENT
============================================================

Before implementing AI integrations, verify the current official documentation
for:

Google Gemini API:
- @google/genai
- current text models
- current image-generation models
- authentication
- rate limits
- structured output
- retries
- current deprecations

TypeSafe:
- current @typesafe-ai/sdk package
- System One API
- current Jev models
- Choice
- Score
- Noul
- probabilities
- confidence
- retries
- current API endpoint
- current authentication mechanism

Do not rely on stale blog posts or old SDK examples.

Use the installed/package versions and current official API contracts.

============================================================
104. RESEARCH BASIS
============================================================

The architecture is intentionally aligned with the current documented APIs:

GOOGLE GEMINI

Use the official Google GenAI SDK:

    @google/genai

The current Google documentation exposes:
- text generation
- structured output
- function calling
- multimodal input
- image generation
- streaming
- embeddings
- caching

Use the current official APIs rather than legacy Google AI SDKs.

Current image generation should use Nano Banana models.

Preferred:

    gemini-3.1-flash-image

Premium:

    gemini-3-pro-image

Current Google documentation identifies these as the current native image-generation
models and indicates that Imagen is no longer the path for Gemini API image generation.

GOOGLE API KEY

The application variable is:

    GOOGLE_API_KEY

The key must remain server-side.

The official Google GenAI SDK normally recognizes:

    GEMINI_API_KEY

but this project intentionally reads:

    GOOGLE_API_KEY

and passes the key explicitly.

TYPE SAFE

Use:

    @typesafe-ai/sdk

Environment:

    TYPESAFE_API_KEY

Default endpoint:

    https://api.typesafe.ai

Current System One endpoint concept:

    POST /v1/systemone

The request contains:

    state
    model
    questions

The questions are typed.

Supported concepts include:

    Choice
    Score
    Noul

Responses provide structured results including probabilities/confidence where
applicable.

The official TypeSafe client currently uses:

    jev-latest

as its default model alias.

A versioned model can be configured for reproducibility.

============================================================
105. FINAL DELIVERY
============================================================

At the end, provide:

1. Complete source code
2. Dockerfile(s)
3. docker-compose.yml
4. .env.example
5. Prisma schema
6. database migrations
7. seed script
8. automated tests
9. README
10. architecture documentation
11. AI documentation
12. game design documentation
13. security documentation

Also provide a final developer report containing:

    what was implemented
    architecture
    how to run
    how to configure GOOGLE_API_KEY
    how to configure TYPESAFE_API_KEY
    how to run without AI keys
    how saves work
    how AI works
    how deterministic replay works
    known limitations
    next recommended enhancements

============================================================
106. DEFINITION OF DONE
============================================================

The final result should feel like:

    a real small strategy game

not:

    an AI demo

AI should make the world feel alive,
but the game engine should remain deterministic,
testable, secure, and authoritative.

The most important design principle is:

    CODE DEFINES REALITY.
    TYPESAFE MAKES STRATEGIC DECISIONS.
    GEMINI TELLS THE STORY.
    GEMINI CREATES VISUAL CONTENT.
    THE PLAYER CREATES THE HISTORY.

Build the system accordingly.
