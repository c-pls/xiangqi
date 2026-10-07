/**
 * Luxury Piece SVG Rendering Engine - Xiangqi Imperial Edition
 * Faithfully matches traditional high-end Xiangqi pieces with:
 * 1. Warm metallic bronze/gold beveled outer rim with directional lighting.
 * 2. Traditional Chinese meander / key fret pattern (回纹 / 雷纹) repeating around the inner perimeter.
 * 3. Deep lustrous lacquer core:
 *    - Red: Rich imperial cinnabar / vermilion lacquer gradient.
 *    - Black: Rich obsidian / charcoal bronze lacquer gradient.
 * 4. Brilliant 3D embossed gold calligraphy text with dual-bevel depth & specular sheen.
 * 5. Authentic KaiTi / LiShu calligraphy font stack with crystal-clear legibility.
 */

const PIECE_NAMES_ZH = {
    'K': '帥', 'A': '仕', 'E': '相', 'H': '傌', 'R': '俥', 'C': '炮', 'P': '兵',
    'k': '將', 'a': '士', 'e': '象', 'h': '馬', 'r': '車', 'c': '砲', 'p': '卒'
};

const PIECE_NAMES_EN = {
    'K': 'General', 'A': 'Advisor', 'E': 'Elephant', 'H': 'Horse', 'R': 'Chariot', 'C': 'Cannon', 'P': 'Soldier',
    'k': 'General', 'a': 'Advisor', 'e': 'Elephant', 'h': 'Horse', 'r': 'Chariot', 'c': 'Cannon', 'p': 'Soldier'
};

const PIECE_LETTERS_EN = {
    'K': 'GEN', 'A': 'ADV', 'E': 'ELE', 'H': 'HRS', 'R': 'CHR', 'C': 'CAN', 'P': 'SLD',
    'k': 'GEN', 'a': 'ADV', 'e': 'ELE', 'h': 'HRS', 'r': 'CHR', 'c': 'CAN', 'p': 'SLD'
};

const PIECE_ICONS = {
    // General - Imperial Crown
    'K': `<path d="M14 36 L18 20 L24 28 L30 14 L36 28 L42 20 L46 36 Z M14 38 L46 38 L46 43 L14 43 Z" fill="currentColor" />
          <circle cx="30" cy="11" r="2.5" fill="currentColor"/>
          <circle cx="18" cy="18" r="2" fill="currentColor"/>
          <circle cx="42" cy="18" r="2" fill="currentColor"/>`,

    // Advisor - Bodyguard Aegis / Guard Shield
    'A': `<path d="M30 14 L44 20 C44 32 38 41 30 46 C22 41 16 32 16 20 Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
          <path d="M30 22 L30 38 M22 30 L38 30" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`,

    // Elephant - Elephant Head / Curved Tusks
    'E': `<path d="M21 20 C18 14 30 12 30 22 C30 12 42 14 39 20 C38 27 34 32 34 40 C34 44 26 44 26 40 C26 32 22 27 21 20 Z" fill="currentColor"/>
          <path d="M22 28 C16 32 14 38 18 42 C19 36 22 34 25 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M38 28 C44 32 46 38 42 42 C41 36 38 34 35 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`,

    // Horse - Knight / Warhorse Profile
    'H': `<path d="M20 44 L40 44 C40 37 38 32 34 29 C38 28 40 23 37 19 C34 15 28 15 26 18 L27 22 C23 20 18 24 19 29 C20 34 20 37 20 44 Z" fill="currentColor"/>
          <circle cx="28" cy="22" r="1.8" fill="var(--bg-eye, #1e293b)"/>
          <path d="M24 16 L22 12 M27 15 L26 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,

    // Chariot - Battle Fortress / Castle Tower
    'R': `<path d="M18 44 L42 44 L40 26 L44 26 L44 16 L39 16 L39 20 L35 20 L35 16 L31 16 L31 20 L29 20 L29 16 L25 16 L25 20 L21 20 L21 16 L16 16 L16 26 L20 26 Z" fill="currentColor"/>
          <rect x="27" y="30" width="6" height="8" rx="3" fill="var(--bg-eye, #1e293b)"/>`,

    // Cannon - Artillery Mortar / Cannon
    'C': `<path d="M16 34 L38 22 L42 29 L20 41 Z" fill="currentColor"/>
          <circle cx="20" cy="38" r="6" fill="none" stroke="currentColor" stroke-width="3"/>
          <circle cx="20" cy="38" r="2" fill="currentColor"/>
          <path d="M36 17 L44 22 L41 27 L33 22 Z" fill="currentColor"/>`,

    // Soldier - Dagger / Spear Token
    'P': `<path d="M30 14 L37 26 L34 26 L34 40 L26 40 L26 26 L23 26 Z" fill="currentColor"/>
          <circle cx="30" cy="44" r="2" fill="currentColor"/>`
};

/**
 * Precompute the 32-segment traditional Chinese thunder / cloud meander path (回纹 / 云雷纹).
 * Generates an interlocking, continuous 360-degree closed vector loop.
 */
function buildMeanderPath() {
    const N = 32;
    const rIn = 39.2;
    const rOut = 44.0;
    const step = 360 / N;
    let d = '';
    const r1 = rIn + (rOut - rIn) * 0.35;
    const r2 = rIn + (rOut - rIn) * 0.68;

    function polar(r, deg) {
        const rad = (deg - 90) * Math.PI / 180;
        return [+(50 + r * Math.cos(rad)).toFixed(2), +(50 + r * Math.sin(rad)).toFixed(2)];
    }

    for (let i = 0; i < N; i++) {
        const a0 = i * step;
        const pts = [
            polar(rIn, a0),
            polar(rOut, a0),
            polar(rOut, a0 + step * 0.60),
            polar(r2, a0 + step * 0.60),
            polar(r2, a0 + step * 0.25),
            polar(r1, a0 + step * 0.25),
            polar(r1, a0 + step * 0.82),
            polar(rIn, a0 + step * 0.82),
            polar(rIn, a0 + step)
        ];

        if (i === 0) d += 'M ' + pts[0][0] + ' ' + pts[0][1] + ' ';
        for (let k = 1; k < pts.length; k++) {
            d += 'L ' + pts[k][0] + ' ' + pts[k][1] + ' ';
        }
    }
    d += 'Z';
    return d;
}

const MEANDER_PATH_D = buildMeanderPath();

class PieceRenderer {
    /**
     * Shared SVG gradient definitions for the luxury token.
     * Uniquely scoped by pieceCode to ensure zero DOM conflicts.
     */
    static getDefs(pieceCode, isRed) {
        return `
        <defs>
            <!-- Drop Shadow for Outer Token Depth -->
            <filter id="p-shadow-${pieceCode}" x="-20%" y="-20%" width="150%" height="150%">
                <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" flood-color="#000000" flood-opacity="0.65"/>
            </filter>

            <!-- Outer Metallic Bronze/Gold Beveled Rim -->
            <linearGradient id="outer-bevel-${pieceCode}" x1="15%" y1="10%" x2="85%" y2="90%">
                <stop offset="0%" stop-color="#faecc8" />
                <stop offset="22%" stop-color="#dfb974" />
                <stop offset="58%" stop-color="#9a6e2e" />
                <stop offset="85%" stop-color="#5a3810" />
                <stop offset="100%" stop-color="#281604" />
            </linearGradient>

            <!-- Outer Bevel Top-Left Highlight Arc -->
            <linearGradient id="outer-highlight-${pieceCode}" x1="10%" y1="10%" x2="90%" y2="90%">
                <stop offset="0%" stop-color="#fff8ea" stop-opacity="0.95" />
                <stop offset="45%" stop-color="#e0b25e" stop-opacity="0.7" />
                <stop offset="80%" stop-color="#4a2c0a" stop-opacity="0.3" />
                <stop offset="100%" stop-color="#1f1003" stop-opacity="0.1" />
            </linearGradient>

            <!-- Meander Band Background Groove -->
            <radialGradient id="band-bg-${pieceCode}" cx="38%" cy="32%" r="65%">
                ${isRed ? `
                <stop offset="0%" stop-color="#5c0d0d" />
                <stop offset="70%" stop-color="#3b0505" />
                <stop offset="100%" stop-color="#1f0202" />
                ` : `
                <stop offset="0%" stop-color="#1e2025" />
                <stop offset="70%" stop-color="#111215" />
                <stop offset="100%" stop-color="#070809" />
                `}
            </radialGradient>

            <!-- Golden Meander (回纹) Etching Gradient -->
            <linearGradient id="gold-meander-${pieceCode}" x1="20%" y1="10%" x2="80%" y2="90%">
                <stop offset="0%" stop-color="#fff1d0" />
                <stop offset="35%" stop-color="#ebb965" />
                <stop offset="75%" stop-color="#af7826" />
                <stop offset="100%" stop-color="#643b09" />
            </linearGradient>

            <!-- Concentric Golden Boundary Rings -->
            <linearGradient id="gold-ring-${pieceCode}" x1="15%" y1="15%" x2="85%" y2="85%">
                <stop offset="0%" stop-color="#fff6da" stop-opacity="0.95" />
                <stop offset="30%" stop-color="#e9bb67" stop-opacity="0.9" />
                <stop offset="70%" stop-color="#a87123" stop-opacity="0.8" />
                <stop offset="100%" stop-color="#543008" stop-opacity="0.7" />
            </linearGradient>

            <!-- Deep Imperial Lacquer Core (Cinnabar Red / Obsidian Black) -->
            <radialGradient id="core-lacquer-${pieceCode}" cx="36%" cy="32%" r="68%">
                ${isRed ? `
                <stop offset="0%" stop-color="#c92a2a" />
                <stop offset="32%" stop-color="#9a1717" />
                <stop offset="68%" stop-color="#670b0b" />
                <stop offset="90%" stop-color="#420404" />
                <stop offset="100%" stop-color="#240101" />
                ` : `
                <stop offset="0%" stop-color="#3a3d46" />
                <stop offset="30%" stop-color="#24262d" />
                <stop offset="65%" stop-color="#14151a" />
                <stop offset="90%" stop-color="#0a0b0d" />
                <stop offset="100%" stop-color="#030405" />
                `}
            </radialGradient>

            <!-- High-Contrast Radiant Gold Calligraphy Inlay (Crisp & brilliant on dark lacquer) -->
            <linearGradient id="gold-text-${pieceCode}" x1="15%" y1="0%" x2="85%" y2="100%">
                <stop offset="0%" stop-color="#ffffff" />
                <stop offset="18%" stop-color="#fff5c8" />
                <stop offset="50%" stop-color="#fed668" />
                <stop offset="82%" stop-color="#f5b330" />
                <stop offset="100%" stop-color="#e09212" />
            </linearGradient>
        </defs>`;
    }

    /**
     * Common 3D token body (outer metallic bevel, meander band, lacquer core).
     */
    static getTokenBody(pieceCode, isRed) {
        return `
        <!-- Outer Metallic Bronze/Gold Beveled Rim Base -->
        <circle cx="50" cy="50" r="47.5" fill="url(#outer-bevel-${pieceCode})" class="piece-bevel-rim"/>
        <!-- Specular Highlight Arc on Outer Bevel -->
        <circle cx="50" cy="50" r="46.6" fill="none" stroke="url(#outer-highlight-${pieceCode})" stroke-width="1.4" opacity="0.95"/>
        <!-- Outer Rim Drop Contour -->
        <circle cx="50" cy="50" r="47.4" fill="none" stroke="#120800" stroke-width="0.6" opacity="0.55"/>

        <!-- Decorative Meander (回纹) Band Groove -->
        <circle cx="50" cy="50" r="44.2" fill="url(#band-bg-${pieceCode})" class="piece-meander-bg"/>
        <!-- Outer Meander Boundary Gold Ring -->
        <circle cx="50" cy="50" r="44.0" fill="none" stroke="url(#gold-ring-${pieceCode})" stroke-width="0.9" opacity="0.9"/>

        <!-- Continuous Traditional Chinese Cloud & Thunder Key Fret (回纹 / 云雷纹) -->
        <path d="${MEANDER_PATH_D}" fill="none" stroke="url(#gold-meander-${pieceCode})" stroke-width="0.82" stroke-linejoin="miter" stroke-miterlimit="2" opacity="0.92" class="piece-meander-path"/>

        <!-- Inner Meander Boundary Gold Ring -->
        <circle cx="50" cy="50" r="39.2" fill="none" stroke="url(#gold-ring-${pieceCode})" stroke-width="1.1" opacity="0.95"/>
        <!-- Recessed Shadow Groove inside Ring -->
        <circle cx="50" cy="50" r="38.5" fill="none" stroke="#000000" stroke-width="0.9" opacity="0.45"/>

        <!-- Central Deep Lacquered Disc -->
        <circle cx="50" cy="50" r="38.2" fill="url(#core-lacquer-${pieceCode})" class="piece-lacquer-core"/>
        <!-- Subtle Specular Arc Highlight on Core Top-Left -->
        <path d="M22 34 A38.2 38.2 0 0 1 66 16" fill="none" stroke="#ffffff" stroke-width="1.2" opacity="0.18" stroke-linecap="round"/>
        <!-- Subtle Shadow Arc on Core Bottom-Right -->
        <path d="M78 66 A38.2 38.2 0 0 1 34 84" fill="none" stroke="#000000" stroke-width="1.4" opacity="0.32" stroke-linecap="round"/>
        `;
    }

    static _svgCache = new Map();

    static getSVG(pieceCode, style = 'characters') {
        const cacheKey = `${pieceCode}_${style}`;
        if (PieceRenderer._svgCache.has(cacheKey)) {
            return PieceRenderer._svgCache.get(cacheKey);
        }

        const isRed = pieceCode === pieceCode.toUpperCase();
        const typeUpper = pieceCode.toUpperCase();
        const colorClass = isRed ? 'piece-red' : 'piece-black';
        const defs = PieceRenderer.getDefs(pieceCode, isRed);
        const tokenBody = PieceRenderer.getTokenBody(pieceCode, isRed);

        let svgContent = '';
        // Mode 1: English Letter Abbreviations (GEN, ADV, ELE, HRS, CHR, CAN, SLD)
        if (style === 'english_letters') {
            const label = PIECE_LETTERS_EN[pieceCode] || typeUpper;
            const fontSize = label.length > 2 ? '22' : '28';
            svgContent = `
            <svg class="piece-svg ${colorClass}" viewBox="0 0 100 100" width="100%" height="100%" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
                ${defs}
                ${tokenBody}
                <!-- Deep Carved Drop Shadow -->
                <text x="50" y="59.8" text-anchor="middle"
                      fill="#120600" opacity="0.85" stroke="#120600" stroke-width="2.6" stroke-linejoin="round"
                      font-size="${fontSize}" font-weight="900" font-family="'Inter', -apple-system, sans-serif" letter-spacing="1">${label}</text>
                <!-- Metallic Contour & Intermediate Bevel -->
                <text x="50" y="59.2" text-anchor="middle"
                      fill="url(#gold-text-${pieceCode})" stroke="url(#gold-text-bevel-${pieceCode})" stroke-width="1.0" stroke-linejoin="round"
                      font-size="${fontSize}" font-weight="900" font-family="'Inter', -apple-system, sans-serif" letter-spacing="1">${label}</text>
                <!-- Embossed Gold Letters Face -->
                <text x="50" y="59" text-anchor="middle"
                      fill="url(#gold-text-${pieceCode})"
                      font-size="${fontSize}" font-weight="900" font-family="'Inter', -apple-system, sans-serif" letter-spacing="1">${label}</text>
            </svg>`;
        } else if (style === 'pictograms') {
            // Mode 2: Universal Vector Pictograms
            const iconSvg = PIECE_ICONS[typeUpper] || '';
            svgContent = `
            <svg class="piece-svg ${colorClass}" viewBox="0 0 100 100" width="100%" height="100%" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
                ${defs}
                ${tokenBody}
                <!-- 3D Shadow Layer for Icon -->
                <g transform="translate(10, 10.8) scale(1.333)" style="color: #120600; opacity: 0.85; stroke: #120600; stroke-width: 2.2; stroke-linejoin: round; fill: #120600;">
                    ${iconSvg}
                </g>
                <!-- Embossed Gold Icon Face -->
                <g class="piece-symbol" transform="translate(10, 10) scale(1.333)" fill="url(#gold-text-${pieceCode})" stroke="url(#gold-text-bevel-${pieceCode})" stroke-width="0.6" style="color: url(#gold-text-${pieceCode}); --bg-eye: #201004;">
                    ${iconSvg}
                </g>
            </svg>`;
        } else {
            // Default - Traditional Chinese Calligraphy with Embossed Gold Inlay
            const char = PIECE_NAMES_ZH[pieceCode] || '';
            const fontStack = `'Kaiti SC', 'STKaiti', 'KaiTi', 'BiauKai', 'PingFang SC', 'PingFang TC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans TC', 'Noto Sans SC', sans-serif`;

            svgContent = `
            <svg class="piece-svg ${colorClass}" viewBox="0 0 100 100" width="100%" height="100%" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
                ${defs}
                ${tokenBody}

                <!-- Layer 1: Clean Carved Bottom Shadow for 3D Inset Depth -->
                <text x="50" y="51.6" dominant-baseline="central" text-anchor="middle"
                      class="piece-char-shadow"
                      fill="#000000" opacity="0.65"
                      font-size="53" font-weight="700"
                      font-family="${fontStack}">${char}</text>

                <!-- Layer 2: Razor-Sharp Gold Calligraphy Character with Dark Inset Contour -->
                <text x="50" y="50" dominant-baseline="central" text-anchor="middle"
                      class="piece-char-face"
                      fill="url(#gold-text-${pieceCode})"
                      stroke="#1a0801" stroke-width="1.3" stroke-linejoin="round"
                      style="paint-order: stroke fill;"
                      font-size="53" font-weight="700"
                      font-family="${fontStack}">${char}</text>
            </svg>`;
        }

        PieceRenderer._svgCache.set(cacheKey, svgContent);
        return svgContent;
    }
}

// Global & CommonJS exports
if (typeof window !== 'undefined') {
    window.PieceRenderer = PieceRenderer;
    window.PIECE_NAMES_ZH = PIECE_NAMES_ZH;
    window.PIECE_NAMES_EN = PIECE_NAMES_EN;
    window.PIECE_LETTERS_EN = PIECE_LETTERS_EN;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PieceRenderer, PIECE_NAMES_ZH, PIECE_NAMES_EN, PIECE_LETTERS_EN };
}
