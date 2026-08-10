# Burraco 1 vs 1 — v0.2 mobile

Gioco online privato di Burraco 1 contro 1, progettato soprattutto per smartphone.

## Novità v0.2
- Combinazioni sul tavolo: seleziona almeno 3 carte e premi **Gioca**.
- Puoi aggiungere carte alle tue combinazioni: seleziona la combinazione, poi le carte, quindi **Aggiungi**.
- Validazione server-side di gruppi e scale.
- Riconoscimento Burraco da 7+ carte, pulito/sporco.
- Tutto il monte scarti è visibile e scorrevole.
- Joker grafico senza la scritta JOKER.
- Ordinamento per seme/valore persistente: anche le nuove carte pescate vengono inserite nel posto corretto.
- Interfaccia mobile-first.
- Musica di sottofondo generata via Web Audio API.
- Effetti sonori per pesca, raccolta scarti, giocata, scarto, turno, errore, Burraco, pozzetto e fine partita.
- Pulsante audio 🔊/🔇.
- Presa del pozzetto e chiusura base dopo aver preso il pozzetto e completato almeno un Burraco.

## Avvio locale
```bash
npm install
npm start
```
Poi apri `http://localhost:3000`.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Se nel repository questi file si trovano dentro la cartella `burraco-1v1-render-ready`, imposta quella cartella come **Root Directory** su Render.
