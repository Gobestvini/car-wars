# PLAY transition — 2026-10-09

The race is reset and rendered when PLAY starts the menu exit. The canvas becomes visible underneath the fading menu immediately. Rendering continues during the 520 ms transition while simulation and input remain paused; the HUD appears at completion. This also repaints the default WebGL buffer instead of relying on a previous warmup frame.

Validation: production build passed; loading-screen tests passed (4/4); diff whitespace check passed. In-app browser confirmed `data-screen=launching`, canvas visibility `visible`, and menu opacity 0.992083 immediately after PLAY, then the rendered race after the transition. Captured `transition.png` during a second launch and `gameplay.png` after the first launch.
