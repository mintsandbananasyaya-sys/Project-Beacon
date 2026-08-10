# Beacon Bot

Bare-bones Discord bot for Project: Beacon. Right now it does one thing: connects and stays online. No slash commands or message handlers yet — those come later, along with the website OAuth integration.

## Setup

1. **Create the application**
   Go to the [Discord Developer Portal](https://discord.com/developers/applications) → New Application → name it (e.g. "Beacon").

2. **Create the bot user**
   In your application, go to the **Bot** tab → Add Bot → copy the token (click "Reset Token" if you need to see it).

3. **Invite it to your server**
   Go to **OAuth2 → URL Generator**, check the `bot` scope, pick permissions (none are required yet since there are no commands), open the generated URL, and add it to your server.

4. **Install dependencies**
   ```
   npm install
   ```

5. **Add your token**
   Copy `.env.example` to `.env` and paste your bot token in:
   ```
   cp .env.example .env
   ```

6. **Run it**
   ```
   npm start
   ```
   You should see `[Beacon] Online as <bot name>#0000` in the console, and the bot will show as online in Discord with a "Watching the signal" status.

## Next steps (not built yet)

- Slash commands
- Website OAuth2 login integration
