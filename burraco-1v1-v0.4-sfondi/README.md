# Burraco 1 vs 1 — v0.4

Burraco online 1 contro 1, mobile-first, con stanze private Socket.IO.

## Novità v0.4

- 2 sfondi reali del campo da gioco inclusi nel progetto:
  - telo beige con le due lattine di Coca-Cola;
  - telo blu a fiori.
- Chi crea la stanza sceglie lo sfondo iniziale.
- Durante la partita il pulsante `🎨` apre il selettore del campo.
- Se uno dei due cambia sfondo, il nuovo campo viene sincronizzato e mostrato a entrambi.
- Pulsante `🚪` per uscire dalla partita con conferma.
- Se si abbandona una partita in corso, l'altro giocatore vince per abbandono.
- Rimane il soundboard `🎙️ Frasi` con i 10 audio personalizzati sincronizzati tra i due telefoni.

## Avvio locale

```bash
npm install
npm start
```

Apri `http://localhost:3000`.

## Render

Carica il contenuto di questa cartella nella root del repository GitHub (quindi `package.json`, `server.js`, `render.yaml` e `public/` devono essere direttamente nella pagina principale del repository).

Impostazioni Render:

- Root Directory: vuota
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Se il Web Service è già collegato al repository, basta fare commit/push dei file aggiornati: con Auto Deploy attivo Render pubblicherà la nuova versione.

## Cartelle importanti

- `public/audio/` — registrazioni personalizzate.
- `public/backgrounds/` — i due sfondi del tavolo.
