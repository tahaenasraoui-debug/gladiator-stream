/**
 * GLADIATOR STREAM - Authoritative Game Server & Twitch IRC Bridge
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const tmi = require('tmi.js');
const path = require('path');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const TWITCH_CHANNEL = process.env.TWITCH_CHANNEL || 'twitch';
const TICK_RATE = 30; // 30 Server ticks per second
const USER_COOLDOWN_MS = 2000; // 2 seconds anti-spam per chatter
const INACTIVITY_LIMIT_MS = 60000; // 60 seconds idle despawn
const VICTORY_RESET_MS = 30000; // 30 seconds post-boss defeat banner

const ARENA = {
    WIDTH: 1920,
    HEIGHT: 1080,
    GROUND_Y: 960,
    LEFT_BOUND: 120,
    RIGHT_BOUND: 1800,
    CENTER_X: 960
};

const CLASSES = {
    warrior: { hp: 160, atk: 24, range: 110, speed: 7, color: '#ef4444', label: 'WARRIOR' },
    archer:  { hp: 100, atk: 32, range: 480, speed: 9, color: '#22c55e', label: 'ARCHER' },
    mage:    { hp: 90,  atk: 38, range: 380, speed: 6, color: '#3b82f6', label: 'MAGE' }
};

// --- SERVER INITIALIZATION ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- AUTHORITATIVE GAME STATE ---
const rateLimits = new Map(); // username -> lastCommandTimestamp

const gameState = {
    phase: 'COMBAT', // 'COMBAT' | 'VICTORY'
    victoryTimer: 0,
    players: new Map(), // username -> Gladiator Object
    actionFeed: [],     // Recent actions [{ id, text, timestamp }]
    leaderboard: [],    // Top damage dealers on boss kill
    boss: {
        name: 'MALAKOR THE ANNIHILATOR',
        x: ARENA.CENTER_X,
        y: ARENA.GROUND_Y,
        vx: 0,
        hp: 2500,
        maxHp: 2500,
        baseHp: 2500,
        state: 'IDLE', // 'IDLE' | 'WINDUP' | 'CLEAVE' | 'AOE_SLAM' | 'COOLDOWN'
        stateTimer: 90,
        target: null,
        facing: 1, // 1 = right, -1 = left
        attackRadius: 0
    }
};

// --- HELPER UTILITIES ---
function broadcastEvent(type, payload) {
    const message = JSON.stringify({ type, payload });
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

function logAction(text) {
    const entry = { id: Date.now() + Math.random(), text };
    gameState.actionFeed.unshift(entry);
    if (gameState.actionFeed.length > 6) gameState.actionFeed.pop();
    broadcastEvent('FEED', entry);
}

function recalculateBossScaling() {
    const activeCount = gameState.players.size;
    const newMaxHp = gameState.boss.baseHp + (activeCount * 650);
    const hpRatio = gameState.boss.hp / gameState.boss.maxHp;
    gameState.boss.maxHp = newMaxHp;
    if (gameState.phase === 'COMBAT') {
        gameState.boss.hp = Math.max(1, Math.round(newMaxHp * hpRatio));
    }
}

function resetBossEncounter() {
    gameState.phase = 'COMBAT';
    gameState.leaderboard = [];
    const activeCount = gameState.players.size;
    gameState.boss.maxHp = gameState.boss.baseHp + (activeCount * 650);
    gameState.boss.hp = gameState.boss.maxHp;
    gameState.boss.x = ARENA.CENTER_X;
    gameState.boss.state = 'IDLE';
    gameState.boss.stateTimer = 90;
    gameState.boss.target = null;

    // Reset player damage counters and heal everyone for the new round
    for (const player of gameState.players.values()) {
        player.totalDamage = 0;
        player.hp = player.maxHp;
    }

    logAction('Malakor has risen from the ashes!');
    broadcastEvent('BOSS_RESET', {});
}

// --- COMMAND HANDLER ---
function handleChatCommand(username, displayName, rawMessage, userColor) {
    const now = Date.now();
    const cleanMsg = rawMessage.trim().toLowerCase();
    if (!cleanMsg.startsWith('!')) return;

    // Rate Limiter check
    const lastCmd = rateLimits.get(username) || 0;
    if (now - lastCmd < USER_COOLDOWN_MS) return;
    rateLimits.set(username, now);

    const parts = cleanMsg.split(/\s+/);
    const cmd = parts[0];
    const arg = parts[1];

    // 1. !SPAWN <warrior|archer|mage>
    if (cmd === '!spawn') {
        const chosenClass = CLASSES[arg] ? arg : 'warrior';
        const template = CLASSES[chosenClass];
        const spawnSide = Math.random() > 0.5 ? 1 : -1;
        const spawnX = ARENA.CENTER_X + (spawnSide * (280 + Math.random() * 450));

        if (gameState.players.has(username)) {
            const existing = gameState.players.get(username);
            existing.role = chosenClass;
            existing.maxHp = template.hp;
            existing.hp = template.hp;
            existing.atk = template.atk;
            existing.range = template.range;
            existing.targetX = spawnX;
            existing.lastActive = now;
            existing.animState = 'MOVE';
            logAction(`${displayName} switched class to ${template.label}!`);
            broadcastEvent('FLOATING_TEXT', {
                x: existing.x, y: existing.y - 90,
                text: `CLASS: ${template.label}`, color: template.color, style: 'BUFF'
            });
        } else {
            const gladiator = {
                username,
                displayName,
                role: chosenClass,
                color: userColor || template.color,
                x: spawnX,
                y: ARENA.GROUND_Y,
                targetX: spawnX,
                hp: template.hp,
                maxHp: template.hp,
                atk: template.atk,
                range: template.range,
                speed: template.speed,
                tauntUntil: 0,
                totalDamage: 0,
                lastActive: now,
                animState: 'IDLE',
                facing: spawnX < gameState.boss.x ? 1 : -1
            };
            gameState.players.set(username, gladiator);
            recalculateBossScaling();
            logAction(`${displayName} entered the arena as a ${template.label}!`);
            broadcastEvent('PARTICLE_BURST', { x: spawnX, y: ARENA.GROUND_Y - 30, color: gladiator.color, count: 25 });
            broadcastEvent('FLOATING_TEXT', {
                x: spawnX, y: ARENA.GROUND_Y - 95,
                text: 'SPAWNED!', color: '#facc15', style: 'CRIT'
            });
        }
        return;
    }

    // Require player to be spawned for combat commands
    const player = gameState.players.get(username);
    if (!player) return;
    player.lastActive = now;

    if (gameState.phase !== 'COMBAT') return;

    // 2. !ATTACK
    if (cmd === '!attack') {
        const dist = Math.abs(player.x - gameState.boss.x);
        player.facing = player.x < gameState.boss.x ? 1 : -1;

        // Move into effective range if too far
        if (dist > player.range) {
            const dir = player.x < gameState.boss.x ? 1 : -1;
            player.targetX = gameState.boss.x - (dir * (player.range - 30));
        }

        const isCrit = Math.random() < 0.22;
        const variance = 0.85 + (Math.random() * 0.3);
        const dmg = Math.round(player.atk * variance * (isCrit ? 1.75 : 1));

        gameState.boss.hp = Math.max(0, gameState.boss.hp - dmg);
        player.totalDamage += dmg;
        player.animState = 'ATTACK';

        broadcastEvent('ATTACK_VFX', {
            fromX: player.x,
            fromY: player.y - 45,
            toX: gameState.boss.x + (Math.random() * 60 - 30),
                       toY: gameState.boss.y - 110,
                       role: player.role,
                       color: player.color,
                       isCrit
        });

        broadcastEvent('FLOATING_TEXT', {
            x: gameState.boss.x + (Math.random() * 90 - 45),
                       y: gameState.boss.y - 160 + (Math.random() * 40 - 20),
                       text: isCrit ? `CRIT! -${dmg}` : `-${dmg}`,
                       color: isCrit ? '#facc15' : '#ffffff',
                       style: isCrit ? 'CRIT' : 'NORMAL'
        });

        // Check Boss Defeat
        if (gameState.boss.hp <= 0) {
            triggerBossVictory(player.displayName);
        }
        return;
    }

    // 3. !HEAL
    if (cmd === '!heal') {
        const healRadius = 260;
        const healAmount = player.role === 'mage' ? 55 : 35;
        let healedCount = 0;

        for (const ally of gameState.players.values()) {
            if (Math.abs(ally.x - player.x) <= healRadius) {
                ally.hp = Math.min(ally.maxHp, ally.hp + healAmount);
                healedCount++;
                broadcastEvent('FLOATING_TEXT', {
                    x: ally.x,
                    y: ally.y - 85,
                    text: `+${healAmount} HP`,
                    color: '#4ade80',
                    style: 'HEAL'
                });
            }
        }

        broadcastEvent('HEAL_AURA', { x: player.x, y: player.y, radius: healRadius });
        logAction(`${player.displayName} cast Radiance, healing ${healedCount} gladiator(s)!`);
        return;
    }

    // 4. !TAUNT
    if (cmd === '!taunt') {
        player.tauntUntil = now + 8000; // 8 seconds of high defense + boss aggro
        gameState.boss.target = player.username;
        // Step closer to the boss
        const dir = player.x < gameState.boss.x ? 1 : -1;
        player.targetX = gameState.boss.x - (dir * 130);

        broadcastEvent('FLOATING_TEXT', {
            x: player.x,
            y: player.y - 95,
            text: 'TAUNT! (+50% DEF)',
                       color: '#fb923c',
                       style: 'CRIT'
        });
        broadcastEvent('TAUNT_WAVE', { x: player.x, y: player.y - 40 });
        logAction(`${player.displayName} taunted Malakor!`);
    }
}

// --- BOSS VICTORY SEQUENCE ---
function triggerBossVictory(killingBlowUser) {
    gameState.phase = 'VICTORY';
    gameState.victoryTimer = Date.now() + VICTORY_RESET_MS;
    gameState.boss.state = 'DEFEATED';

    // Compute Top 5 Damage Dealers
    const sorted = Array.from(gameState.players.values())
    .sort((a, b) => b.totalDamage - a.totalDamage)
    .slice(0, 5)
    .map((p, idx) => ({
        rank: idx + 1,
        displayName: p.displayName,
        role: p.role,
        damage: p.totalDamage
    }));

    gameState.leaderboard = sorted;

    logAction(`VICTORY! ${killingBlowUser} delivered the final blow to Malakor!`);
    broadcastEvent('BOSS_DEFEATED', {
        x: gameState.boss.x,
        y: gameState.boss.y - 90,
        killer: killingBlowUser,
        leaderboard: sorted
    });
}

// --- AUTHORITATIVE SERVER TICK LOOP (30 TPS) ---
function updateGameTick() {
    const now = Date.now();

    // 1. Prune Inactive Players (> 60s without commands)
    for (const [username, player] of gameState.players.entries()) {
        if (now - player.lastActive > INACTIVITY_LIMIT_MS) {
            gameState.players.delete(username);
            recalculateBossScaling();
            logAction(`${player.displayName} despawned due to inactivity.`);
        }
    }

    // 2. Update Player Movement & Physics
    for (const player of gameState.players.values()) {
        const dx = player.targetX - player.x;
        if (Math.abs(dx) > 4) {
            player.x += Math.sign(dx) * Math.min(Math.abs(dx), player.speed);
            player.facing = Math.sign(dx);
            player.animState = 'MOVE';
        } else if (player.animState === 'MOVE') {
            player.animState = 'IDLE';
            player.facing = player.x < gameState.boss.x ? 1 : -1;
        }
        player.x = Math.max(ARENA.LEFT_BOUND, Math.min(ARENA.RIGHT_BOUND, player.x));
    }

    // 3. Handle Victory Phase Countdown
    if (gameState.phase === 'VICTORY') {
        if (now >= gameState.victoryTimer) {
            resetBossEncounter();
        }
        broadcastWorldState(now);
        return;
    }

    // 4. Boss AI State Machine
    const boss = gameState.boss;
    boss.stateTimer--;

    // Validate aggro target
    let targetPlayer = boss.target ? gameState.players.get(boss.target) : null;
    if (!targetPlayer && gameState.players.size > 0) {
        const playersArray = Array.from(gameState.players.values());
        targetPlayer = playersArray[Math.floor(Math.random() * playersArray.length)];
        boss.target = targetPlayer.username;
    }

    if (boss.state === 'IDLE') {
        // Slowly stalk toward current aggro target
        if (targetPlayer) {
            const distToTarget = targetPlayer.x - boss.x;
            boss.facing = distToTarget >= 0 ? 1 : -1;
            if (Math.abs(distToTarget) > 160) {
                boss.x += Math.sign(distToTarget) * 2.5;
            }
        }

        if (boss.stateTimer <= 0 && gameState.players.size > 0) {
            boss.state = 'WINDUP';
            boss.stateTimer = 45; // 1.5s telegraph warning
            boss.nextAttackType = Math.random() > 0.45 ? 'AOE_SLAM' : 'CLEAVE';
            boss.attackRadius = boss.nextAttackType === 'AOE_SLAM' ? 320 : 240;

            broadcastEvent('BOSS_TELEGRAPH', {
                x: boss.x,
                y: boss.y,
                attackType: boss.nextAttackType,
                facing: boss.facing,
                radius: boss.attackRadius,
                durationMs: 1500
            });
        }
    } else if (boss.state === 'WINDUP') {
        if (boss.stateTimer <= 0) {
            boss.state = boss.nextAttackType;
            boss.stateTimer = 15; // 0.5s active strike frame
            executeBossStrike(now);
        }
    } else if (boss.state === 'AOE_SLAM' || boss.state === 'CLEAVE') {
        if (boss.stateTimer <= 0) {
            boss.state = 'COOLDOWN';
            boss.stateTimer = 50; // ~1.6s recovery window
        }
    } else if (boss.state === 'COOLDOWN') {
        if (boss.stateTimer <= 0) {
            boss.state = 'IDLE';
            boss.stateTimer = 75; // ~2.5s before next windup
        }
    }

    broadcastWorldState(now);
}

function executeBossStrike(now) {
    const boss = gameState.boss;
    const isSlam = boss.state === 'AOE_SLAM';

    broadcastEvent('BOSS_IMPACT', {
        x: boss.x,
        y: boss.y,
        attackType: boss.state,
        facing: boss.facing,
        radius: boss.attackRadius
    });

    for (const player of gameState.players.values()) {
        const dist = Math.abs(player.x - boss.x);
        const inFront = (player.x - boss.x) * boss.facing >= -30;

        const hit = isSlam
        ? dist <= boss.attackRadius
        : (dist <= boss.attackRadius && inFront);

        if (hit) {
            const isTaunting = now < player.tauntUntil;
            const baseDmg = isSlam ? 38 : 48;
            const finalDmg = isTaunting ? Math.round(baseDmg * 0.5) : baseDmg;

            player.hp = Math.max(0, player.hp - finalDmg);

            // Knockback impulse
            const knockDir = player.x >= boss.x ? 1 : -1;
            player.targetX = Math.max(ARENA.LEFT_BOUND, Math.min(ARENA.RIGHT_BOUND, player.x + knockDir * 110));

            broadcastEvent('FLOATING_TEXT', {
                x: player.x,
                y: player.y - 80,
                text: isTaunting ? `BLOCKED -${finalDmg}` : `-${finalDmg}`,
                color: isTaunting ? '#93c5fd' : '#ef4444',
                style: 'DAMAGE'
            });

            // Respawn gladiator automatically if knocked out
            if (player.hp <= 0) {
                player.hp = player.maxHp;
                const respawnSide = Math.random() > 0.5 ? 1 : -1;
                player.x = ARENA.CENTER_X + respawnSide * 650;
                player.targetX = player.x;
                broadcastEvent('FLOATING_TEXT', {
                    x: player.x,
                    y: player.y - 95,
                    text: 'RESPAWNED!',
                    color: '#cbd5e1',
                    style: 'NORMAL'
                });
            }
        }
    }
}

function broadcastWorldState(now) {
    const serializedPlayers = [];
    for (const p of gameState.players.values()) {
        serializedPlayers.push({
            username: p.username,
            displayName: p.displayName,
            role: p.role,
            color: p.color,
            x: Math.round(p.x),
                               y: Math.round(p.y),
                               hp: p.hp,
                               maxHp: p.maxHp,
                               taunting: now < p.tauntUntil,
                               facing: p.facing,
                               animState: p.animState,
                               totalDamage: p.totalDamage
        });
        // Reset single-frame attack state after broadcast
        if (p.animState === 'ATTACK') p.animState = 'IDLE';
    }

    const statePacket = {
        phase: gameState.phase,
        victoryRemainingSec: gameState.phase === 'VICTORY'
        ? Math.max(0, Math.ceil((gameState.victoryTimer - now) / 1000))
        : 0,
        boss: {
            name: gameState.boss.name,
            x: Math.round(gameState.boss.x),
            y: Math.round(gameState.boss.y),
            hp: gameState.boss.hp,
            maxHp: gameState.boss.maxHp,
            state: gameState.boss.state,
            facing: gameState.boss.facing,
            attackRadius: gameState.boss.attackRadius
        },
        players: serializedPlayers,
        leaderboard: gameState.leaderboard
    };

    broadcastEvent('STATE_TICK', statePacket);
}

// --- TWITCH IRC CLIENT SETUP ---
const twitchClient = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    channels: [TWITCH_CHANNEL]
});

twitchClient.connect().then(() => {
    console.log(`[TWITCH] Connected to IRC channel #${TWITCH_CHANNEL}`);
}).catch((err) => {
    console.warn(`[TWITCH] Warning: Could not connect to #${TWITCH_CHANNEL} (${err.message}). Local simulation still active.`);
});

twitchClient.on('message', (channel, tags, message, self) => {
    if (self) return;
    const username = tags.username || 'chatter';
    const displayName = tags['display-name'] || username;
    const userColor = tags.color || null;
    handleChatCommand(username, displayName, message, userColor);
});

// --- LOCAL REST SIMULATION ENDPOINT (For testing without live chat) ---
app.post('/api/simulate', (req, res) => {
    const { username, message } = req.body;
    if (!username || !message) return res.status(400).json({ error: 'Missing username or message' });
    handleChatCommand(username.toLowerCase(), username, message, null);
    res.json({ status: 'ok' });
});

// --- START SERVER & TICK LOOP ---
setInterval(updateGameTick, 1000 / TICK_RATE);

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`⚔️  GLADIATOR STREAM OVERLAY SERVER RUNNING`);
    console.log(`🔗 OBS Browser Source URL: http://localhost:${PORT}`);
    console.log(`🧪 Test Mode Overlay URL:  http://localhost:${PORT}/?debug=true`);
    console.log(`📺 Listening to Twitch:    #${TWITCH_CHANNEL}`);
    console.log(`====================================================`);
});
