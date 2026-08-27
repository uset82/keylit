# KEYLIT

Learn piano. **The next key is already glowing.** You play it. Your agent hears you on this page — not in a chat that cannot see your hands.

## Judges

1. Open the live HTTPS URL in **ChatGPT’s in-app browser** (or Chrome 149+ with `chrome://flags/#enable-webmcp-testing`).
2. Arm audio. Then try:
   - `Teach me piano`
   - `Happy Birthday`
   - `Show the next keys`
3. Tools register with `document.modelContext.registerTool`. License is MIT.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Arm audio. Click **teach me**. Press the cyan key. That is the product.

**Teacher:** `start-lesson`, `set-next-keys`, `get-lesson-state`, `show-next-keys`, `demo-next`

**After you can play:** `harmonize-held`, `answer-human`, `follow-human`
