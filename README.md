# 楚河漢界 · 现代中国象棋 (Xiangqi Modern 2-Player Offline)

A modern, fresh-look Chinese Chess (Xiangqi / 中国象棋) web application built specifically for **offline 2-player hotseat / pass-and-play** on the same screen (desktop, laptop, iPad, or mobile phone).

Inspired by modern tactical chess channels (like [小雨中国象棋](https://www.youtube.com/@%E5%B0%8F%E9%9B%A8%E4%B8%AD%E5%9B%BD%E8%B1%A1%E6%A3%8B-666)), this application reinvents traditional 1990s skeuomorphic wooden chess software with a sleek, minimalist aesthetic, fluid vector pieces, and physical sound synthesis.

---

## ✨ Features

- **100% Offline & Zero Dependencies**: 
  - Pure HTML5, modern CSS, and vanilla ES6 JavaScript.
  - No build step, no Node.js or npm required, no server needed.
  - Works anywhere: simply double-click `index.html` in your browser.
- **Authentic Chinese Chessmen & Board (Modeled after Xiangqi.com)**:
  - **Chessmen (Pieces)**: Large, prominent 3D tokens with metallic bronze beveled rims, traditional Chinese Cloud & Thunder Key Fret (回纹 / 云雷纹) border, and deep cinnabar/obsidian lacquer cores.
  - **Light/Refined Calligraphy Font**: Slender, elegant Traditional Chinese brush calligraphy (`帥, 仕, 相, 俥, 傌, 炮, 兵` and `將, 士, 象, 車, 馬, 砲, 卒`) with refined golden embossed depth and subtle drop shadow (no chunky bold text).
  - **Board Indexing**: Column index numbers `1`–`9` (Black side) and `9`–`1` (Red side) printed above and below each grid line intersection.
  - **Prominent Centered Layout**: Centered, expanded board scaling with a native **⛶ Fullscreen** theater mode.
  - **River Divider**: Classical calligraphy **`楚 河`** (Chu River) and **`漢 界`** (Han Border).
- **Tactical Attack & Takeout Animations**:
  - **Cannon (炮/砲) Artillery**: Fires an artillery fireball projectile over the intervening screen piece that detonates on the target in a blazing shockwave explosion with a deep cannon boom!
  - **Chariot (俥/車) Sonic Charge**: High-speed charge streak across the rank/file with a double razor-sharp steel slash flash!
  - **Horse (傌/馬) Gallop & Stomp**: Galloping leap with rhythmic clip-clop hoof stomp shockwave!
  - **Soldier (兵/卒) Thrust**: Rapid spearhead pierce with crimson spark burst!
- **Imperial Check ("將軍!") & Checkmate ("絕殺!") Seals**:
  - **Check ("將軍!")**: Pulsing imperial cinnabar seal with gold rim stamped above the board.
  - **Checkmate ("絕殺!")**: Grand imperial wax seal slamming down onto the board with screen rumble, victory fanfare, and a resonant Chinese temple gong!
  - River boundary restrictions for Elephants (相/象).
  - Blocking mechanics: "塞象眼" (blocked elephant eye) and "蹩马腿" (hobbled horse leg).
  - Cannon jumping rule (requires exactly 1 screen piece to capture).
  - Check (将军), Checkmate (绝杀), and Stalemate (困毙 - in Xiangqi, stalemate is a loss for the side with no legal moves).
- **Game Controls & Clocks**:
  - **Clocks**: Unlimited (Casual), 3-min Blitz, 5-min Rapid, 10-min Standard.
  - **Undo Move (悔棋)**: Rollback moves step-by-step.
  - **Move History Log**: Records every move in both Chinese notation (e.g., `炮二平五`, `马８进７`) and International algebraic notation (e.g., `C2=5`, `H8+7`).

---

## 🚀 How to Run

1. Open the project folder:
   ```bash
   /Users/cp/Documents/AntiGravity/
   ```
2. Double-click **`index.html`** to open directly in Google Chrome, Safari, Edge, or Firefox.
3. Or serve it locally with Python:
   ```bash
   python3 -m http.server 8080
   # Open http://localhost:8080 in your browser
   ```

---

## 📁 File Structure

```
AntiGravity/
├── index.html          # Main application page
├── style.css           # Modern theme tokens, glassy panels, and board styles
├── js/
│   ├── sound.js        # Offline Web Audio API sound synthesis
│   ├── pieces.js       # SVG renderers (Calligraphy & Pictogram icons)
│   ├── rules.js        # Complete Xiangqi rules & notation engine
│   └── app.js          # Hotseat UI controller, clocks, and interactions
└── README.md           # Documentation
```
