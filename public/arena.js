/**
 * GLADIATOR STREAM - 60FPS HTML5 Canvas Renderer & Interpolation Engine
 */
const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');

// HUD DOM References
const bossHpFill = document.getElementById('boss-hp-fill');
const bossHpTrail = document.getElementById('boss-hp-damage-trail');
const bossHpText = document.getElementById('boss-hp-text');
const bossStatusBadge = document.getElementById('boss-status-badge');
const activeGladiatorsEl = document.getElementById('active-gladiators');
const actionFeedEl = document.getElementById('action-feed');
const victoryBannerEl = document.getElementById('victory-banner');
const victoryKillerEl = document.getElementById('victory-killer');
const leaderboardListEl = document.getElementById('leaderboard-list');
const victoryCountdownEl = document.getElementById('victory-countdown');

// Enable debug panel if URL contains ?debug=true
if (new URLSearchParams(window.location.search).get('debug') === 'true') {
    document.getElementById('debug-panel').classList.remove('hidden');
}

// --- CLIENT INTERPOLATION & VISUAL STATE ---
const GROUND_Y = 960;
const clientPlayers = new Map(); // username -> interpolated gladiator
const particles = [];
const floatingTexts = [];
const projectiles = [];
const activeAuras = [];

let screenShake = 0;
let telegraphZone = null;

const clientBoss = {
    name: 'MALAKOR THE ANNIHILATOR',
    x: 960,
    y: GROUND_Y,
    targetX: 960,
    hp: 2500,
    maxHp: 2500,
    state: 'IDLE',
    facing: 1,
    attackRadius: 240
};

// --- WEBSOCKET CONNECTION WITH AUTO-RECONNECT ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
        const { type, payload } = JSON.parse(event.data);
        handleServerMessage(type, payload);
    };

    ws.onclose = () => {
        setTimeout(connectWebSocket, 2000);
    };
}
connectWebSocket();

// --- SERVER PACKET HANDLER ---
function handleServerMessage(type, payload) {
    switch (type) {
        case 'STATE_TICK':
            syncWorldState(payload);
            break;

        case 'FEED':
            addFeedEntry(payload.text);
            break;

        case 'FLOATING_TEXT':
            spawnFloatingText(payload.x, payload.y, payload.text, payload.color, payload.style);
            break;

        case 'PARTICLE_BURST':
            spawnParticleBurst(payload.x, payload.y, payload.color, payload.count || 20);
            break;

        case 'ATTACK_VFX':
            spawnAttackVisual(payload);
            break;

        case 'HEAL_AURA':
            activeAuras.push({ x: payload.x, y: payload.y, radius: payload.radius, color: '#4ade80', alpha: 0.85 });
            break;

        case 'TAUNT_WAVE':
            activeAuras.push({ x: payload.x, y: payload.y, radius: 140, color: '#fb923c', alpha: 0.9 });
            break;

        case 'BOSS_TELEGRAPH':
            telegraphZone = {
                x: payload.x,
                y: payload.y,
                attackType: payload.attackType,
                facing: payload.facing,
                radius: payload.radius,
                createdAt: performance.now(),
                duration: payload.durationMs
            };
            break;

        case 'BOSS_IMPACT':
            telegraphZone = null;
            screenShake = 18;
            spawnParticleBurst(payload.x, GROUND_Y, '#ef4444', 45);
            break;

        case 'BOSS_DEFEATED':
            telegraphZone = null;
            screenShake = 30;
            // Massive celebratory fireworks
            for (let i = 0; i < 6; i++) {
                setTimeout(() => {
                    spawnParticleBurst(
                        payload.x + (Math.random() * 400 - 200),
                                       payload.y - (Math.random() * 200),
                                       ['#facc15', '#38bdf8', '#4ade80', '#f43f5e'][i % 4],
                                       55
                    );
                }, i * 220);
            }
            showVictoryBanner(payload.killer, payload.leaderboard);
            break;

        case 'BOSS_RESET':
            victoryBannerEl.classList.add('hidden');
            spawnParticleBurst(960, GROUND_Y - 80, '#a855f7', 50);
            break;
    }
}

// --- STATE SYNCHRONIZATION ---
function syncWorldState(state) {
    // Sync Boss
    clientBoss.targetX = state.boss.x;
    clientBoss.hp = state.boss.hp;
    clientBoss.maxHp = state.boss.maxHp;
    clientBoss.state = state.boss.state;
    clientBoss.facing = state.boss.facing;

    // Update Boss HUD Bar
    const hpPercent = Math.max(0, (clientBoss.hp / clientBoss.maxHp) * 100);
    bossHpFill.style.width = `${hpPercent}%`;
    bossHpTrail.style.width = `${hpPercent}%`;
    bossHpText.textContent = `${clientBoss.hp.toLocaleString()} / ${clientBoss.maxHp.toLocaleString()} HP`;

    bossStatusBadge.textContent = clientBoss.state;
    bossStatusBadge.className = clientBoss.state === 'WINDUP'
    ? 'badge-windup'
    : (clientBoss.state === 'AOE_SLAM' || clientBoss.state === 'CLEAVE')
    ? 'badge-attack'
    : 'badge-idle';

    // Sync Players
    const seenUsers = new Set();
    for (const srvPlayer of state.players) {
        seenUsers.add(srvPlayer.username);
        if (!clientPlayers.has(srvPlayer.username)) {
            clientPlayers.set(srvPlayer.username, {
                ...srvPlayer,
                renderX: srvPlayer.x,
                renderY: srvPlayer.y,
                walkPhase: Math.random() * Math.PI * 2,
                              attackSwing: 0
            });
        } else {
            const p = clientPlayers.get(srvPlayer.username);
            p.x = srvPlayer.x;
            p.y = srvPlayer.y;
            p.hp = srvPlayer.hp;
            p.maxHp = srvPlayer.maxHp;
            p.role = srvPlayer.role;
            p.color = srvPlayer.color;
            p.taunting = srvPlayer.taunting;
            p.facing = srvPlayer.facing;
            if (srvPlayer.animState === 'ATTACK') {
                p.attackSwing = 1.0;
            }
        }
    }

    // Remove despawned gladiators
    for (const username of clientPlayers.keys()) {
        if (!seenUsers.has(username)) {
            clientPlayers.delete(username);
        }
    }

    activeGladiatorsEl.textContent = `⚔️ Active Gladiators: ${clientPlayers.size}`;

    if (state.phase === 'VICTORY') {
        victoryCountdownEl.textContent = `Next Boss Spawns in ${state.victoryRemainingSec}s...`;
    }
}

function addFeedEntry(text) {
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.textContent = text;
    actionFeedEl.prepend(div);
    while (actionFeedEl.children.length > 5) {
        actionFeedEl.removeChild(actionFeedEl.lastChild);
    }
}

function showVictoryBanner(killer, leaderboard) {
    victoryKillerEl.textContent = `Final Blow Delivered By: ${killer}`;
    leaderboardListEl.innerHTML = '';
    leaderboard.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'leader-row';
        row.innerHTML = `
        <span>#${entry.rank} ${entry.displayName} <small>(${entry.role.toUpperCase()})</small></span>
        <span class="leader-dmg">${entry.damage.toLocaleString()} DMG</span>
        `;
        leaderboardListEl.appendChild(row);
    });
    victoryBannerEl.classList.remove('hidden');
}

// --- VFX SPAWNERS ---
function spawnFloatingText(x, y, text, color, style) {
    floatingTexts.push({
        x,
        y,
        text,
        color,
        style,
        vy: style === 'CRIT' ? -2.4 : -1.6,
        alpha: 1.0,
        scale: style === 'CRIT' ? 1.35 : 1.0
    });
}

function spawnParticleBurst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 8;
        particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
                       vy: Math.sin(angle) * speed - 3,
                       radius: 3 + Math.random() * 4,
                       color,
                       alpha: 1.0
        });
    }
}

function spawnAttackVisual(vfx) {
    if (vfx.role === 'warrior') {
        // Melee slash arc at target
        spawnParticleBurst(vfx.toX, vfx.toY, vfx.color, 12);
    } else {
        // Projectile for Archer (arrow) or Mage (arcane orb)
        projectiles.push({
            x: vfx.fromX,
            y: vfx.fromY,
            toX: vfx.toX,
            toY: vfx.toY,
            role: vfx.role,
            color: vfx.color,
            progress: 0
        });
    }
}

// --- MAIN 60FPS RENDER LOOP ---
function renderLoop(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    if (screenShake > 0.5) {
        const dx = (Math.random() - 0.5) * screenShake;
        const dy = (Math.random() - 0.5) * screenShake;
        ctx.translate(dx, dy);
        screenShake *= 0.88;
    }

    drawArenaFloor();
    drawTelegraphZone(now);
    drawAuras();

    if (clientBoss.hp > 0) {
        drawBoss(now);
    }

    drawGladiators(now);
    drawProjectiles();
    drawParticles();
    drawFloatingTexts();

    ctx.restore();
    requestAnimationFrame(renderLoop);
}

// --- DRAWING SUB-ROUTINES ---
function drawArenaFloor() {
    // Subtle translucent arena ground platform at the bottom 120px
    const grad = ctx.createLinearGradient(0, GROUND_Y - 15, 0, 1080);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.0)');
    grad.addColorStop(0.15, 'rgba(15, 23, 42, 0.78)');
    grad.addColorStop(1, 'rgba(2, 6, 23, 0.92)');
    ctx.fillStyle = grad;
    ctx.fillRect(60, GROUND_Y - 10, 1800, 130);

    // Glowing Arena Baseline
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(80, GROUND_Y);
    ctx.lineTo(1840, GROUND_Y);
    ctx.stroke();
}

function drawTelegraphZone(now) {
    if (!telegraphZone) return;
    const elapsed = now - telegraphZone.createdAt;
    const progress = Math.min(1, elapsed / telegraphZone.duration);

    ctx.save();
    ctx.fillStyle = `rgba(239, 68, 68, ${0.18 + progress * 0.28})`;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;

    if (telegraphZone.attackType === 'AOE_SLAM') {
        const width = telegraphZone.radius * 2;
        ctx.fillRect(clientBoss.x - telegraphZone.radius, GROUND_Y - 18, width, 24);
        ctx.strokeRect(clientBoss.x - telegraphZone.radius, GROUND_Y - 18, width, 24);
    } else {
        // Directional Cleave Zone
        const startX = clientBoss.facing === 1 ? clientBoss.x : clientBoss.x - telegraphZone.radius;
        ctx.fillRect(startX, GROUND_Y - 18, telegraphZone.radius, 24);
        ctx.strokeRect(startX, GROUND_Y - 18, telegraphZone.radius, 24);
    }
    ctx.restore();
}

function drawBoss(now) {
    // Smooth horizontal interpolation
    clientBoss.x += (clientBoss.targetX - clientBoss.x) * 0.14;
    const breath = Math.sin(now * 0.004) * 6;
    const bx = clientBoss.x;
    const by = clientBoss.y;

    ctx.save();
    ctx.translate(bx, by);

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 85, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.scale(clientBoss.facing, 1);

    // Boss Aura when winding up
    if (clientBoss.state === 'WINDUP') {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, -95, 115 + Math.sin(now * 0.03) * 10, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Armored Demon Torso
    ctx.fillStyle = '#450a0a';
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-65, 0);
    ctx.lineTo(-80, -135 + breath);
    ctx.lineTo(0, -175 + breath);
    ctx.lineTo(80, -135 + breath);
    ctx.lineTo(65, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Glowing Core
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(0, -90 + breath, 22, 0, Math.PI * 2);
    ctx.fill();

    // Horned Crown & Head
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, -165 + breath, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Horns
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-22, -182 + breath);
    ctx.lineTo(-58, -225 + breath);
    ctx.moveTo(22, -182 + breath);
    ctx.lineTo(58, -225 + breath);
    ctx.stroke();

    // Glowing Eyes
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(6, -172 + breath, 14, 7);
    ctx.fillRect(-16, -172 + breath, 10, 7);

    // Giant War Cleaver / Mace
    const swingAngle = (clientBoss.state === 'AOE_SLAM' || clientBoss.state === 'CLEAVE')
    ? 1.1
    : (clientBoss.state === 'WINDUP' ? -0.85 : 0.15);
    ctx.save();
    ctx.translate(55, -115 + breath);
    ctx.rotate(swingAngle);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-8, -110, 16, 130);
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.moveTo(-35, -110);
    ctx.lineTo(45, -135);
    ctx.lineTo(45, -70);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
}

function drawGladiators(now) {
    for (const p of clientPlayers.values()) {
        // Linear interpolation (lerp) between server ticks
        p.renderX += (p.x - p.renderX) * 0.22;
        p.renderY += (p.y - p.renderY) * 0.22;

        const isMoving = Math.abs(p.x - p.renderX) > 1.5;
        const bob = isMoving ? Math.abs(Math.sin(now * 0.018 + p.walkPhase)) * 10 : Math.sin(now * 0.006 + p.walkPhase) * 2;

        if (p.attackSwing > 0) {
            p.attackSwing = Math.max(0, p.attackSwing - 0.08);
        }

        const gx = p.renderX;
        const gy = p.renderY - bob;

        ctx.save();
        ctx.translate(gx, gy);

        // Ground Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.ellipse(0, bob + 2, 22, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Taunt Shield Bubble
        if (p.taunting) {
            ctx.strokeStyle = '#fb923c';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, -32, 42, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Sprite Body
        ctx.save();
        ctx.scale(p.facing, 1);

        // Torso
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-16, -48, 32, 44, 8);
        ctx.fill();
        ctx.stroke();

        // Head
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(0, -60, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Class Specific Headgear & Weapon
        const swingOffset = Math.sin(p.attackSwing * Math.PI) * 0.9;
        ctx.save();
        ctx.translate(14, -30);
        ctx.rotate(swingOffset);

        if (p.role === 'warrior') {
            // Broadsword & Shield
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(0, -34, 8, 38);
            ctx.fillStyle = '#facc15';
            ctx.fillRect(-6, -6, 20, 6);
        } else if (p.role === 'archer') {
            // Recurve Bow
            ctx.strokeStyle = '#a16207';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(4, -6, 22, -Math.PI * 0.45, Math.PI * 0.45);
            ctx.stroke();
        } else if (p.role === 'mage') {
            // Arcane Staff
            ctx.fillStyle = '#78350f';
            ctx.fillRect(2, -38, 6, 46);
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(5, -42, 9, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        ctx.restore();

        // Mini Health Bar above Gladiator
        const hpW = 46;
        const hpRatio = Math.max(0, p.hp / p.maxHp);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(-hpW / 2, -88, hpW, 7);
        ctx.fillStyle = hpRatio > 0.4 ? '#4ade80' : '#ef4444';
        ctx.fillRect(-hpW / 2 + 1, -87, (hpW - 2) * hpRatio, 5);

        // Crisp Twitch Username Tag
        ctx.font = 'bold 14px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.strokeText(p.displayName, 0, -96);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.displayName, 0, -96);

        ctx.restore();
    }
}

function drawProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        proj.progress += 0.12;

        if (proj.progress >= 1) {
            spawnParticleBurst(proj.toX, proj.toY, proj.color, 10);
            projectiles.splice(i, 1);
            continue;
        }

        const curX = proj.x + (proj.toX - proj.x) * proj.progress;
        const arcLift = Math.sin(proj.progress * Math.PI) * (proj.role === 'archer' ? 75 : 25);
        const curY = proj.y + (proj.toY - proj.y) * proj.progress - arcLift;

        ctx.save();
        ctx.fillStyle = proj.color;
        ctx.shadowColor = proj.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(curX, curY, proj.role === 'mage' ? 10 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawAuras() {
    for (let i = activeAuras.length - 1; i >= 0; i--) {
        const aura = activeAuras[i];
        aura.alpha -= 0.03;
        if (aura.alpha <= 0) {
            activeAuras.splice(i, 1);
            continue;
        }
        ctx.save();
        ctx.strokeStyle = aura.color;
        ctx.globalAlpha = aura.alpha;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(aura.x, aura.y - 25, aura.radius * (1.1 - aura.alpha * 0.3), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vy += 0.35; // gravity
        pt.alpha -= 0.025;

        if (pt.alpha <= 0) {
            particles.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.globalAlpha = pt.alpha;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawFloatingTexts() {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const ft = floatingTexts[i];
        ft.y += ft.vy;
        ft.alpha -= 0.018;

        if (ft.alpha <= 0) {
            floatingTexts.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.globalAlpha = ft.alpha;
        ctx.font = `900 ${Math.round(20 * ft.scale)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#000000';
        ctx.strokeText(ft.text, ft.x, ft.y);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
    }
}

// --- LOCAL DEMO HELPER FUNCTIONS (Used by ?debug=true buttons) ---
const demoNames = ['Nightbot', 'CodexHero', 'StreamKnight', 'PixelMage', 'xX_Slayer_Xx', 'GladiatorPrime', 'TwitchChamp'];

function simCmd(command) {
    const randomUser = demoNames[Math.floor(Math.random() * demoNames.length)];
    fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: randomUser, message: command })
    });
}

function simCrowdAttack() {
    demoNames.forEach((name, idx) => {
        setTimeout(() => {
            fetch('/api/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: name, message: '!attack' })
            });
        }, idx * 80);
    });
}

// Kick off 60 FPS Render Loop
requestAnimationFrame(renderLoop);
