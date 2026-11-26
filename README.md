# Capitala

A Romanian property-trading board game for phones. You buy up Bucharest one neighbourhood at a time.

- **Online with friends:** create a room and send the link or the 4-letter code. You can add bots to fill seats. If someone disconnects, the others can let a bot play their turns until they come back.
- **On one phone:** play against bots, or pass the phone between friends. The game is saved after every move and also works offline.

It is a static site with no build step: `index.html`, `css/` and `js/`. Online play uses Firebase Realtime Database.

## Code layout

| File | What it does |
| --- | --- |
| `js/data.js` | Board, colour groups, cards and tokens |
| `js/engine.js` | Game rules as pure functions (`apply(state, seat, action)`) |
| `js/bot.js` | Bot players |
| `js/net.js` | Firebase rooms. Every move is a transaction, so two phones can't overwrite each other |
| `js/local.js` | Games played on one phone |
| `js/ui.js`, `js/board.js` | The game screen |
| `js/app.js` | Menus and lobby |

## Tests

```sh
node tests/sim.mjs 300   # plays 300 random bot games and checks the rules after every move
```

## Firebase rules (recommended)

`database.rules.json` limits the database to game rooms and checks the shape of what gets written. Paste it into Firebase console → Realtime Database → Rules, or run `firebase deploy --only database`.
